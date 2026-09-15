/**
 * Des traces à la **connaissance du réseau** : c'est ici qu'un fichier collecté
 * cesse d'être un fichier et devient ce que l'on sait d'un SEGMENT DE CHEMIN.
 *
 * Sections du cahier des charges « traces GPX » couvertes ici :
 *
 *  - **6. Un GPX de randonnée est un ITINÉRAIRE, pas un chemin.** Il emprunte
 *    plusieurs segments déjà connus. `resolveItinerary` le rééchantillonne, le
 *    projette sur le réseau et le rend sous la forme « cet itinéraire emprunte
 *    les segments 112, 113, 245, 983, 984 », les portions sans correspondance
 *    restant visibles dans `gaps` : ce sont elles, la matière des chemins
 *    manquants.
 *  - **11 et 21. Rien n'écrase rien.** Les géométries coexistent par couche
 *    avec leur provenance ; `bestGeometry` en *choisit* une pour l'affichage et
 *    **explique pourquoi**, sans en supprimer aucune.
 *  - **12. Confiance d'un segment.** `segmentConfidence` agrège ce que l'on
 *    sait : couches présentes, sources DISTINCTES, traces distinctes, passages
 *    réels, fraîcheur de la dernière preuve — et le dit en français.
 *  - **13. Chemins probablement existants.** `potentialExistingTrails` repère
 *    les corridors attestés par plusieurs sources indépendantes qu'aucun
 *    segment de la base ne décrit.
 *  - **14. Corrections de géométrie.** `potentialGeometryCorrections` détecte
 *    un décalage **systématique** entre une géométrie de référence et le
 *    faisceau observé.
 *  - **30. Fiche d'un segment.** `segmentKnowledge` répond, pour un chemin :
 *    d'où vient sa géométrie, qui l'atteste, quels itinéraires l'empruntent,
 *    quelle confiance on lui accorde, quand il a été validé, et — quand
 *    l'application est utilisée — comment il est réellement parcouru.
 *
 * Trois règles gouvernent tout le fichier :
 *
 * 1. **Un GPX est une observation, pas la vérité** (section 24). Aucune
 *    fonction d'ici ne décrète un fait : elle augmente une confiance, elle
 *    propose une correction, elle signale un chemin *probable*. Les sorties des
 *    sections 13 et 14 sont des PROPOSITIONS — rien n'est appliqué ici, et
 *    jamais rien n'est renvoyé vers la source externe d'origine.
 * 2. **L'inconnu n'est jamais flatteur.** Une dispersion inconnue vaut la
 *    tolérance maximale et non zéro, une confiance communautaire absente vaut
 *    « pas solide », un champ d'usage absent vaut `null` et jamais `0` :
 *    « pas encore de données » n'est pas « personne n'y passe » (section 43 du
 *    cahier des charges « moteur cartographique »).
 * 3. **Le score ne monte pas seul.** Aucune accumulation de sources externes
 *    ne porte la confiance d'un segment à 100 : seuls les passages réels de nos
 *    utilisateurs franchissent `KNOWLEDGE_EXTERNAL_SCORE_CAP` (section 25).
 *
 * Module pur : aucun accès réseau, disque ou DOM, aucun aléa, aucune horloge
 * implicite (l'instant de référence est toujours un paramètre dont le défaut
 * explicite est `Date.now()`), aucune mutation des entrées. Tous les tableaux
 * rendus sont triés explicitement : deux exécutions donnent le même résultat,
 * octet pour octet.
 */
import {
  METERS_PER_DEG_LAT,
  clampBBox,
  distanceToPolylineM,
  formatDistance,
  inBBox,
  isValidLatLng,
  polylineLengthM,
  type LngLat,
} from "../geo";
import type { BBox, LatLng } from "../types";
import {
  bearingBetweenAlong,
  cumulativeDistances,
  pointAtAlong,
  projectOnPolyline,
  sliceAlong,
} from "../navigation/geometry";
import { ACTIVITY_MODES, type ActivityMode, type PathSegment, type PathSource } from "../navigation/types";
import type { FrequentationLevel } from "../network/types";
import { STATISTICS_MIN_OBSERVATIONS, percentile } from "../network/statistics";
import { DAY_MS } from "../time";
import {
  CORRIDOR_MIN_SOURCES,
  SAME_PATH_TOLERANCE_M,
  type GeometryChoice,
  type GeometryLayer,
  type ItineraryLeg,
  type NormalizedTrace,
  type PotentialExistingTrail,
  type PotentialGeometryCorrection,
  type ResolvedItinerary,
  type SegmentAttestation,
  type SegmentConfidence,
  type TraceCorridor,
} from "./types";

/* ------------------------------------------------------------------ */
/* Réglages — rattachement d'un itinéraire (section 6)                 */
/* ------------------------------------------------------------------ */

/**
 * Pas de rééchantillonnage (m) d'un itinéraire avant projection.
 *
 * 20 m est plus fin que la tolérance de rattachement (`KNOWLEDGE_MAX_SNAP_M`) :
 * une jonction n'est jamais franchie « entre deux échantillons ». Plus fin
 * encore ne ferait que multiplier les projections sans déplacer une borne de
 * tronçon, la géométrie des segments étant elle-même métrique.
 */
export const KNOWLEDGE_SAMPLE_STEP_M = 20;

/**
 * Écart (m) au-delà duquel un échantillon n'appartient plus au segment.
 * Aligné sur `SAME_PATH_TOLERANCE_M` : ce qui n'est pas « le même passage »
 * pour la comparaison de traces ne peut pas être « le même chemin » ici.
 */
export const KNOWLEDGE_MAX_SNAP_M = SAME_PATH_TOLERANCE_M;

/**
 * Marge (m) dont un segment concurrent doit faire mieux pour que l'itinéraire
 * quitte le segment courant.
 *
 * Sans cette hystérésis, deux chemins parallèles distants de quelques mètres
 * (sentier et piste, variante balisée) se disputeraient chaque échantillon et
 * produiraient « 112, 113, 112, 113, 112 » — un aller-retour parasite qui
 * n'existe que dans le bruit du relevé. 8 m est l'ordre de grandeur de ce bruit.
 */
export const KNOWLEDGE_SWITCH_MARGIN_M = 8;

/**
 * Longueur (m) minimale d'un tronçon retenu. En dessous, on n'a pas « emprunté »
 * le segment : on l'a effleuré à une jonction.
 */
export const KNOWLEDGE_MIN_LEG_M = 30;

/**
 * Longueur (m) minimale d'un trou publié dans `gaps`. Les micro-trous (perte de
 * rattachement d'un ou deux échantillons au passage d'un carrefour) comptent
 * bien dans `unmatchedM`, mais ne méritent pas d'être présentés comme un chemin
 * manquant.
 */
export const KNOWLEDGE_MIN_GAP_M = 40;

/**
 * Nombre maximal d'échantillons d'un itinéraire. Un GPX de 300 km existe ; le
 * pas est alors élargi plutôt que de projeter des dizaines de milliers de
 * points sur tout un massif.
 */
export const KNOWLEDGE_MAX_SAMPLES = 5000;

/** Identifiant de repli quand l'appelant n'en fournit aucun (jamais vide). */
export const KNOWLEDGE_DEFAULT_TRACE_ID = "trace-inconnue";

/* ------------------------------------------------------------------ */
/* Réglages — confiance d'un segment (section 12)                      */
/* ------------------------------------------------------------------ */

/** Couches, de la plus structurante à la plus brute (ordre de restitution). */
export const KNOWLEDGE_LAYER_ORDER: readonly GeometryLayer[] = [
  "official",
  "osm",
  "community",
  "imported_gpx",
  "observed",
];

/**
 * Points apportés par la présence d'un segment dans chaque couche (section 12).
 *
 * Une source officielle (gestionnaire du terrain) pèse plus qu'OpenStreetMap,
 * qui pèse plus qu'une ligne reconstruite depuis nos passages — laquelle pèse
 * plus qu'une trace importée isolée, qui n'est qu'une randonnée d'une personne
 * un jour donné. `observed` (passages bruts) ferme la marche : c'est une
 * matière première, pas une attestation.
 */
export const KNOWLEDGE_LAYER_WEIGHTS: Readonly<Record<GeometryLayer, number>> = {
  official: 22,
  osm: 18,
  community: 14,
  imported_gpx: 8,
  observed: 6,
};

/** Libellé de chaque couche dans les explications rendues à l'utilisateur. */
export const KNOWLEDGE_LAYER_LABELS: Readonly<Record<GeometryLayer, string>> = {
  official: "présent dans une source officielle",
  osm: "présent dans OpenStreetMap",
  community: "ligne centrale reconstruite depuis les passages",
  imported_gpx: "décrit par des traces importées",
  observed: "observé par des passages bruts",
};

/** Preuves distinctes dans une couche au-delà desquelles elle donne tout son poids. */
export const KNOWLEDGE_LAYER_EVIDENCE_FULL = 2;

/**
 * Part du poids d'une couche accordée à une preuve unique. Une seule
 * attestation vaut mieux que rien, mais pas autant que deux preuves
 * indépendantes : l'écart restant se gagne par la confirmation.
 */
export const KNOWLEDGE_LAYER_SINGLE_SHARE = 0.6;

/** Sources distinctes au-delà desquelles l'indépendance est maximale. */
export const KNOWLEDGE_SOURCES_FULL = 4;

/** Points maximaux apportés par l'indépendance des sources. */
export const KNOWLEDGE_SOURCES_POINTS = 16;

/** Traces importées distinctes au-delà desquelles ce critère est maximal. */
export const KNOWLEDGE_TRACES_FULL = 5;

/** Points maximaux apportés par le nombre de traces importées distinctes. */
export const KNOWLEDGE_TRACES_POINTS = 8;

/** Points maximaux apportés par la fraîcheur de la dernière preuve. */
export const KNOWLEDGE_FRESHNESS_POINTS = 10;

/**
 * Demi-vie (jours) de la fraîcheur d'une preuve. Un an : en montagne, un chemin
 * attesté l'été dernier reste très probablement là ; une attestation de 2016 ne
 * dit plus grand-chose de l'état du terrain (section 24).
 */
export const KNOWLEDGE_FRESHNESS_HALF_LIFE_DAYS = 365;

/** Passages au-delà desquels ce critère d'usage est maximal. */
export const KNOWLEDGE_PASSAGES_FULL = 20;

/** Points maximaux apportés par les passages réels. */
export const KNOWLEDGE_PASSAGES_POINTS = 22;

/** Utilisateurs distincts au-delà desquels ce critère est maximal. */
export const KNOWLEDGE_USERS_FULL = 5;

/** Points maximaux apportés par la diversité des utilisateurs. */
export const KNOWLEDGE_USERS_POINTS = 8;

/**
 * Plafond du score atteignable **sans aucun passage de nos utilisateurs**
 * (section 25). Cent sources externes concordantes restent cent observations
 * d'autrui : la certitude vient de gens qui y sont réellement passés avec nous.
 */
export const KNOWLEDGE_EXTERNAL_SCORE_CAP = 80;

/** Clé d'une attestation sans source ni trace identifiée : elle ne compte qu'une fois. */
export const KNOWLEDGE_ANONYMOUS_EVIDENCE_KEY = "anonyme";

/** Phrase rendue quand rien n'atteste le segment. */
export const KNOWLEDGE_NO_EVIDENCE_REASON = "aucune source ne documente ce chemin";

/** Phrase expliquant pourquoi le score plafonne faute d'usage réel (section 25). */
export const KNOWLEDGE_EXTERNAL_CAP_REASON =
  "aucun passage de nos utilisateurs : la confiance reste plafonnée";

/* ------------------------------------------------------------------ */
/* Réglages — choix de la géométrie affichée (section 21)              */
/* ------------------------------------------------------------------ */

/** Ordre de préférence des couches (le plus petit l'emporte). */
export const KNOWLEDGE_GEOMETRY_PRIORITY: Readonly<Record<GeometryLayer, number>> = {
  community: 0,
  official: 1,
  osm: 2,
  imported_gpx: 3,
  observed: 5,
};

/**
 * Confiance minimale d'une ligne communautaire pour passer devant les sources
 * externes. En dessous, elle reste disponible mais recule derrière elles : une
 * ligne reconstruite sur trois passages n'est pas encore une référence.
 */
export const KNOWLEDGE_COMMUNITY_MIN_CONFIDENCE = 0.6;

/** Rang d'une ligne communautaire jugée fragile : derrière les traces importées. */
export const KNOWLEDGE_WEAK_COMMUNITY_PRIORITY = 4;

/** Une géométrie de moins de deux points ne décrit aucun chemin. */
export const KNOWLEDGE_MIN_GEOMETRY_POINTS = 2;

/** Pourquoi telle couche l'emporte, en français. */
export const KNOWLEDGE_GEOMETRY_REASONS: Readonly<Record<GeometryLayer, string>> = {
  community: "ligne centrale reconstruite depuis les passages réels",
  official: "géométrie d'un gestionnaire du terrain",
  osm: "réseau vectoriel OpenStreetMap",
  imported_gpx: "trace importée à licence vérifiée",
  observed: "passages bruts, faute de mieux",
};

/** Complément ajouté quand aucune ligne communautaire fiable n'était disponible. */
export const KNOWLEDGE_NO_COMMUNITY_SUFFIX = "aucune ligne communautaire fiable disponible";

/* ------------------------------------------------------------------ */
/* Réglages — chemins probablement existants (section 13)              */
/* ------------------------------------------------------------------ */

/** Pas (m) d'échantillonnage d'un corridor pour le confronter au réseau. */
export const KNOWLEDGE_TRAIL_SAMPLE_M = 25;

/** Distance (m) au-delà de laquelle aucun chemin connu ne couvre l'échantillon. */
export const KNOWLEDGE_TRAIL_CLEARANCE_M = SAME_PATH_TOLERANCE_M;

/** Part du corridor devant être hors réseau pour parler d'un chemin manquant. */
export const KNOWLEDGE_TRAIL_MIN_NEW_SHARE = 0.6;

/**
 * Longueur (m) minimale d'un chemin proposé. En dessous, on décrit un raccourci
 * de carrefour ou un contournement de flaque, pas un chemin à cartographier.
 */
export const KNOWLEDGE_TRAIL_MIN_LENGTH_M = 150;

/** Longueur (m) au-delà de laquelle ce critère est maximal. */
export const KNOWLEDGE_TRAIL_LENGTH_FULL_M = 1000;

/** Passages au-delà desquels ce critère est maximal. */
export const KNOWLEDGE_TRAIL_PASSAGES_FULL = 10;

/** Répartition des 100 points d'un chemin probable (somme = 100). */
export const KNOWLEDGE_TRAIL_SCORE_WEIGHTS = {
  sources: 30,
  novelty: 20,
  passages: 15,
  traces: 15,
  dispersion: 12,
  length: 8,
} as const;

/** Préfixe des identifiants de propositions (aucune collision avec un segment). */
export const KNOWLEDGE_TRAIL_ID_PREFIX = "chemin-probable:";

/* ------------------------------------------------------------------ */
/* Réglages — corrections de géométrie (section 14)                    */
/* ------------------------------------------------------------------ */

/** Pas (m) d'échantillonnage du segment pour mesurer son décalage. */
export const KNOWLEDGE_CORRECTION_SAMPLE_M = 20;

/**
 * Écart médian signé (m) en dessous duquel il n'y a rien à corriger : c'est la
 * précision ordinaire d'un relevé GNSS sous couvert forestier.
 */
export const KNOWLEDGE_CORRECTION_MIN_OFFSET_M = 8;

/** Écart (m) au-delà duquel le faisceau ne décrit plus le même chemin. */
export const KNOWLEDGE_CORRECTION_MAX_OFFSET_M = 60;

/** Échantillons mesurés en dessous desquels le constat n'est pas systématique. */
export const KNOWLEDGE_CORRECTION_MIN_SAMPLES = 5;

/** Part du segment devant être couverte par le faisceau observé. */
export const KNOWLEDGE_CORRECTION_MIN_OVERLAP = 0.6;

/**
 * Part des échantillons devant décaler **du même côté**. C'est le cœur de la
 * section 14 : un faisceau qui déborde autant à gauche qu'à droite est du
 * bruit, pas un décalage.
 */
export const KNOWLEDGE_CORRECTION_MIN_SIGN_SHARE = 0.7;

/** Écart (m) au-delà duquel ce critère de score est maximal. */
export const KNOWLEDGE_CORRECTION_OFFSET_FULL_M = 25;

/** Répartition des 100 points d'une correction proposée (somme = 100). */
export const KNOWLEDGE_CORRECTION_SCORE_WEIGHTS = {
  offset: 30,
  consistency: 25,
  sources: 25,
  evidence: 10,
  tightness: 10,
} as const;

/** Rappel joint à chaque proposition : rien n'est appliqué, rien n'est renvoyé. */
export const KNOWLEDGE_CORRECTION_PROPOSAL_NOTICE =
  "proposition à valider : la géométrie de la source n'est jamais modifiée";

/* ------------------------------------------------------------------ */
/* Réglages — fiche de segment (section 30)                            */
/* ------------------------------------------------------------------ */

/**
 * Couche correspondant à la provenance d'un segment du réseau. Le libellé
 * `seed` (amorçage) n'engage aucun gestionnaire : il est rangé avec les traces
 * importées, jamais avec l'officiel (règle « les droits d'abord »).
 */
export const KNOWLEDGE_SOURCE_LAYERS: Readonly<Record<PathSource, GeometryLayer>> = {
  osm: "osm",
  ign: "official",
  seed: "imported_gpx",
  gpx: "imported_gpx",
  local: "community",
};

/**
 * Passages en dessous desquels aucune conclusion d'usage n'est publiée. Aligné
 * sur `STATISTICS_MIN_OBSERVATIONS` : une même donnée ne peut pas être jugée
 * exploitable ici et insuffisante dans l'agrégateur.
 */
export const KNOWLEDGE_USAGE_MIN_PASSAGES = STATISTICS_MIN_OBSERVATIONS;

/** Phrase affichée tant que l'usage est inconnu : jamais « personne n'y passe ». */
export const KNOWLEDGE_NO_USAGE_LABEL = "pas encore de données d'usage";

/* ------------------------------------------------------------------ */
/* Outils internes                                                     */
/* ------------------------------------------------------------------ */

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Cosinus plancher : évite une maille infinie au voisinage des pôles. */
const MIN_COS_LAT = 0.01;

const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/** Arrondi stable (évite « -0 » et les artefacts flottants en sortie JSON). */
function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Fraction saturée `value / full`, dans [0, 1], sans division par zéro. */
function saturate(value: number, full: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(full) || full <= 0) return 1;
  return Math.min(1, value / full);
}

/** Réglage strictement positif demandé, ou le défaut (jamais zéro par accident). */
function positiveOr(requested: number | undefined, fallback: number): number {
  return requested !== undefined && Number.isFinite(requested) && requested > 0 ? requested : fallback;
}

/** Réglage positif ou nul demandé (`0` est un choix explicite et il est respecté). */
function nonNegativeOr(requested: number | undefined, fallback: number): number {
  return requested !== undefined && Number.isFinite(requested) && requested >= 0 ? requested : fallback;
}

/** Comptage entier positif ou nul, tout le reste valant zéro. */
function countOr(value: number | undefined | null, fallback = 0): number {
  return value !== undefined && value !== null && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Chaîne exploitable (non vide) ou `null` : une chaîne vide n'identifie rien. */
function textOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Comparaison de chaînes indépendante de la locale (tri strictement stable). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Comparaison avec les valeurs absentes en dernier. */
function compareNullableText(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareText(a, b);
}

/** Point exploitable d'une géométrie `[lng, lat]`, ou `null` si illisible. */
function toPoint(coordinate: LngLat | null | undefined): LatLng | null {
  if (coordinate === null || coordinate === undefined) return null;
  const point = { lat: coordinate[1], lng: coordinate[0] };
  return isValidLatLng(point) ? point : null;
}

/**
 * Géométrie réduite à ses points exploitables. Les relevés illisibles sont
 * écartés (ils ne peuvent être ni projetés ni mesurés) ; rien n'est interpolé
 * pour les remplacer.
 */
function usableLine(line: readonly LngLat[] | null | undefined): LngLat[] {
  const out: LngLat[] = [];
  if (line === null || line === undefined) return out;
  for (const coordinate of line) {
    const point = toPoint(coordinate);
    if (point !== null) out.push([point.lng, point.lat]);
  }
  return out;
}

/** Emprise d'une géométrie, ou `null` si elle ne contient aucun point exploitable. */
function lineBBox(line: readonly LngLat[]): BBox | null {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const coordinate of line) {
    const point = toPoint(coordinate);
    if (point === null) continue;
    seen = true;
    if (point.lng < west) west = point.lng;
    if (point.lng > east) east = point.lng;
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
  }
  return seen ? clampBBox({ west, south, east, north }) : null;
}

/** Emprise élargie de `padM` mètres (conversion à la latitude médiane). */
function padBBox(box: BBox, padM: number): BBox {
  const pad = Math.max(0, padM);
  const midLat = (box.south + box.north) / 2;
  const dLat = pad / METERS_PER_DEG_LAT;
  const dLng = pad / (METERS_PER_DEG_LAT * Math.max(MIN_COS_LAT, Math.cos(toRad(midLat))));
  return clampBBox({
    west: box.west - dLng,
    south: box.south - dLat,
    east: box.east + dLng,
    north: box.north + dLat,
  });
}

/** Deux emprises se recouvrent-elles (bornes incluses) ? */
function bboxOverlaps(a: BBox, b: BBox): boolean {
  return a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
}

/**
 * Âge d'une preuve, en français : « aujourd'hui », « hier », « il y a 12 jours »,
 * « il y a 4 mois », « il y a 3 ans ». Un horodatage postérieur à l'instant de
 * référence (dérive d'horloge) vaut « aujourd'hui » plutôt qu'un futur absurde.
 */
function describeAge(at: number, now: number): string {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return "date inconnue";
  const days = Math.floor(Math.max(0, now - at) / DAY_MS);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} jours`;
  if (days < 365) {
    const months = Math.max(1, Math.floor(days / 30));
    return months === 1 ? "il y a 1 mois" : `il y a ${months} mois`;
  }
  const years = Math.max(1, Math.floor(days / 365));
  return years === 1 ? "il y a 1 an" : `il y a ${years} ans`;
}

/** Décroissance exponentielle de la fraîcheur, dans [0, 1]. */
function freshness(at: number | null, now: number, halfLifeDays: number): number {
  if (at === null || !Number.isFinite(at) || !Number.isFinite(now)) return 0;
  const half = Number.isFinite(halfLifeDays) && halfLifeDays > 0 ? halfLifeDays : KNOWLEDGE_FRESHNESS_HALF_LIFE_DAYS;
  const ageDays = (now - at) / DAY_MS;
  if (ageDays <= 0) return 1;
  return clamp01(Math.pow(2, -ageDays / half));
}

/** Accord singulier / pluriel sans bibliothèque : « 1 source », « 3 sources ». */
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

/** Pourcentage entier affichable, borné à [0, 100]. */
function percentText(share: number): string {
  return `${Math.round(clamp01(share) * 100)} %`;
}

/** Une explication et le nombre de points qu'elle vaut (tri par contribution). */
interface ScoredReason {
  points: number;
  rank: number;
  text: string;
}

/** Explications triées par contribution décroissante, puis par ordre de déclaration. */
function orderReasons(reasons: readonly ScoredReason[]): string[] {
  const sorted = [...reasons].sort((a, b) => b.points - a.points || a.rank - b.rank);
  return sorted.map((reason) => reason.text);
}

/* ------------------------------------------------------------------ */
/* 1. Rattachement d'un itinéraire au réseau (section 6)               */
/* ------------------------------------------------------------------ */

/** Réglages du rattachement ; tout est optionnel, les défauts sont les constantes ci-dessus. */
export interface ResolveOptions {
  /** Identifiant de la trace, repris tel quel dans le résultat. */
  traceId?: string;
  /** Pas de rééchantillonnage (m). Défaut : `KNOWLEDGE_SAMPLE_STEP_M`. */
  sampleM?: number;
  /** Écart maximal (m) entre un échantillon et un segment. Défaut : `KNOWLEDGE_MAX_SNAP_M`. */
  maxSnapM?: number;
  /** Marge (m) exigée pour changer de segment. Défaut : `KNOWLEDGE_SWITCH_MARGIN_M`. */
  switchMarginM?: number;
  /** Longueur (m) minimale d'un tronçon retenu. Défaut : `KNOWLEDGE_MIN_LEG_M`. */
  minLegM?: number;
  /** Longueur (m) minimale d'un trou publié. Défaut : `KNOWLEDGE_MIN_GAP_M`. */
  minGapM?: number;
}

/** Segment candidat, préparé une fois pour toutes les projections. */
interface SegmentCandidate {
  id: string;
  line: LngLat[];
  cumulative: number[];
  lengthM: number;
  bbox: BBox;
}

/** Suite d'échantillons consécutifs rattachés au même segment (ou à aucun). */
interface AssignmentRun {
  candidate: number;
  from: number;
  to: number;
}

/** Compresse les affectations par échantillon en suites homogènes. */
function compressRuns(assignment: readonly number[]): AssignmentRun[] {
  const runs: AssignmentRun[] = [];
  for (let i = 0; i < assignment.length; i++) {
    const last = runs.length === 0 ? null : runs[runs.length - 1];
    if (last !== null && last.candidate === assignment[i]) last.to = i;
    else runs.push({ candidate: assignment[i], from: i, to: i });
  }
  return runs;
}

/** Candidats retenus par emprise, préparés et triés par identifiant (déterminisme). */
function prepareCandidates(segments: readonly PathSegment[], area: BBox | null, padM: number): SegmentCandidate[] {
  const out: SegmentCandidate[] = [];
  const search = area === null ? null : padBBox(area, padM);
  for (const segment of segments) {
    const id = textOrNull(segment.id);
    if (id === null) continue;
    const line = usableLine(segment.coordinates);
    if (line.length < KNOWLEDGE_MIN_GEOMETRY_POINTS) continue;
    const bbox = lineBBox(line);
    if (bbox === null) continue;
    // Filtre d'emprise : sans lui, chaque échantillon serait projeté sur tout le
    // réseau du massif. C'est le seul garde-fou de coût de cette fonction.
    if (search !== null && !bboxOverlaps(search, bbox)) continue;
    const cumulative = cumulativeDistances(line);
    const lengthM = cumulative[cumulative.length - 1];
    if (!Number.isFinite(lengthM) || lengthM <= 0) continue;
    out.push({ id, line, cumulative, lengthM, bbox: padBBox(bbox, padM) });
  }
  out.sort((a, b) => compareText(a.id, b.id));
  return out;
}

/**
 * Résout un itinéraire importé en suite de segments du réseau (section 6).
 *
 * Un GPX de randonnée n'est pas un chemin : c'est un *parcours* qui emprunte
 * plusieurs chemins. La trace est rééchantillonnée à pas régulier, chaque
 * échantillon est projeté sur les segments voisins (filtrés par emprise), et
 * les affectations consécutives sont regroupées en `ItineraryLeg`. Le résultat
 * se lit « cet itinéraire emprunte les segments 112, 113, 245, 983, 984 ».
 *
 * Trois précautions :
 *
 *  - **hystérésis** : on ne quitte le segment courant que si un concurrent fait
 *    mieux de `switchMarginM` ; sans elle, deux chemins parallèles produiraient
 *    un aller-retour parasite entre deux segments voisins ;
 *  - **absorption** : un trou court entre deux tronçons du même segment est
 *    comblé, un tronçon court coincé entre deux tronçons d'un même autre
 *    segment est absorbé, et ce qui reste sous `minLegM` est déclaré non
 *    rattaché ;
 *  - **coupures** : les arêtes fictives d'une trace interrompue (`breaks`) ne
 *    sont jamais rattachées — la ligne droite qui enjambe une coupure n'a
 *    jamais été parcourue.
 *
 * `matchedM + unmatchedM` vaut exactement la longueur exploitable de la trace :
 * `gaps` n'en retient que les trous significatifs, mais `unmatchedM` compte
 * toute la distance sans correspondance. Une trace vide, d'un seul point ou de
 * points identiques rend un résultat vide et valide, jamais une exception.
 */
export function resolveItinerary(
  trace: NormalizedTrace,
  segments: readonly PathSegment[],
  opts: ResolveOptions = {},
): ResolvedItinerary {
  const traceId = textOrNull(opts.traceId) ?? KNOWLEDGE_DEFAULT_TRACE_ID;
  const maxSnapM = positiveOr(opts.maxSnapM, KNOWLEDGE_MAX_SNAP_M);
  const switchMarginM = nonNegativeOr(opts.switchMarginM, KNOWLEDGE_SWITCH_MARGIN_M);
  const minLegM = nonNegativeOr(opts.minLegM, KNOWLEDGE_MIN_LEG_M);
  const minGapM = nonNegativeOr(opts.minGapM, KNOWLEDGE_MIN_GAP_M);
  const empty: ResolvedItinerary = { traceId, legs: [], matchedM: 0, unmatchedM: 0, matchedRatio: 0, gaps: [] };

  const line = usableLine(trace.coordinates);
  if (line.length < 2) return empty;
  const cumulative = cumulativeDistances(line);
  const totalM = cumulative[cumulative.length - 1];
  if (!Number.isFinite(totalM) || totalM <= 0) return empty;

  // Pas d'échantillonnage : jamais plus fin que le budget d'échantillons.
  const requestedStep = positiveOr(opts.sampleM, KNOWLEDGE_SAMPLE_STEP_M);
  const stepM = Math.max(requestedStep, totalM / KNOWLEDGE_MAX_SAMPLES);
  const count = Math.max(1, Math.ceil(totalM / stepM));
  const bounds: number[] = [];
  for (let i = 0; i <= count; i++) bounds.push((i / count) * totalM);

  // Arêtes fictives : une coupure porte l'indice du premier point de la reprise.
  // Les indices ne sont exploitables que si aucun point n'a été écarté.
  const fictitious: { from: number; to: number }[] = [];
  if (line.length === trace.coordinates.length) {
    for (const index of trace.breaks ?? []) {
      if (!Number.isFinite(index)) continue;
      const b = Math.floor(index);
      if (b >= 1 && b < line.length) fictitious.push({ from: cumulative[b - 1], to: cumulative[b] });
    }
  }
  const onFictitiousEdge = (along: number): boolean => {
    for (const span of fictitious) if (along > span.from && along < span.to) return true;
    return false;
  };

  const candidates = prepareCandidates(segments, lineBBox(line), maxSnapM);
  const samples: LatLng[] = [];
  for (let i = 0; i < count; i++) samples.push(pointAtAlong(line, cumulative, (bounds[i] + bounds[i + 1]) / 2));

  // Affectation avec hystérésis : le segment courant garde la main tant qu'il
  // reste dans la tolérance et qu'aucun concurrent ne fait nettement mieux.
  const assignment: number[] = [];
  let current = -1;
  for (let i = 0; i < samples.length; i++) {
    if (onFictitiousEdge((bounds[i] + bounds[i + 1]) / 2)) {
      assignment.push(-1);
      continue;
    }
    const sample = samples[i];
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (let c = 0; c < candidates.length; c++) {
      const candidate = candidates[c];
      if (!inBBox(sample, candidate.bbox)) continue;
      const projection = projectOnPolyline(sample, candidate.line, candidate.cumulative);
      if (projection === null) continue;
      const distance = projection.distanceM;
      if (c === current) currentDistance = distance;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = c;
      }
    }
    if (current >= 0 && currentDistance <= maxSnapM && currentDistance <= bestDistance + switchMarginM) {
      assignment.push(current);
      continue;
    }
    const chosen = bestDistance <= maxSnapM ? bestIndex : -1;
    // Le segment courant reste en mémoire pendant un trou : au retour, la trace
    // se raccroche au même chemin plutôt qu'à un voisin devenu marginalement
    // plus proche.
    if (chosen >= 0) current = chosen;
    assignment.push(chosen);
  }

  const runLengthM = (run: AssignmentRun): number => bounds[run.to + 1] - bounds[run.from];
  const fill = (run: AssignmentRun, candidate: number): void => {
    for (let i = run.from; i <= run.to; i++) assignment[i] = candidate;
  };

  // Passe 1 : un trou court entre deux tronçons du même segment est comblé.
  let runs = compressRuns(assignment);
  for (let i = 1; i < runs.length - 1; i++) {
    const run = runs[i];
    if (run.candidate !== -1 || runLengthM(run) >= minGapM) continue;
    if (runs[i - 1].candidate >= 0 && runs[i - 1].candidate === runs[i + 1].candidate) fill(run, runs[i - 1].candidate);
  }
  // Passe 2 : un tronçon court coincé entre deux tronçons d'un même autre
  // segment est un aller-retour parasite : il est absorbé.
  runs = compressRuns(assignment);
  for (let i = 1; i < runs.length - 1; i++) {
    const run = runs[i];
    if (run.candidate < 0 || runLengthM(run) >= minLegM) continue;
    if (runs[i - 1].candidate >= 0 && runs[i - 1].candidate === runs[i + 1].candidate) fill(run, runs[i - 1].candidate);
  }
  // Passe 3 : ce qui reste trop court n'a pas été « emprunté ».
  runs = compressRuns(assignment);
  for (const run of runs) {
    if (run.candidate >= 0 && runLengthM(run) < minLegM) fill(run, -1);
  }

  const legs: ItineraryLeg[] = [];
  const gaps: ResolvedItinerary["gaps"] = [];
  let matchedM = 0;
  let unmatchedM = 0;
  for (const run of compressRuns(assignment)) {
    const lengthM = runLengthM(run);
    if (run.candidate < 0) {
      unmatchedM += lengthM;
      if (lengthM >= minGapM) {
        const fromM = bounds[run.from];
        const toM = bounds[run.to + 1];
        gaps.push({
          fromM: round(fromM, 1),
          toM: round(toM, 1),
          coordinates: sliceAlong(line, cumulative, fromM, toM),
        });
      }
      continue;
    }
    const candidate = candidates[run.candidate];
    const deviations: number[] = [];
    let minAlong = Number.POSITIVE_INFINITY;
    let maxAlong = Number.NEGATIVE_INFINITY;
    let firstAlong = 0;
    let lastAlong = 0;
    for (let i = run.from; i <= run.to; i++) {
      const projection = projectOnPolyline(samples[i], candidate.line, candidate.cumulative);
      if (projection === null) continue;
      deviations.push(projection.distanceM);
      if (projection.along < minAlong) minAlong = projection.along;
      if (projection.along > maxAlong) maxAlong = projection.along;
      if (i === run.from) firstAlong = projection.along;
      lastAlong = projection.along;
    }
    if (deviations.length === 0) {
      unmatchedM += lengthM;
      continue;
    }
    const span = maxAlong > minAlong ? maxAlong - minAlong : 0;
    matchedM += lengthM;
    legs.push({
      segmentId: candidate.id,
      reversed: lastAlong < firstAlong,
      distanceM: round(lengthM, 1),
      coverage: round(clamp01(span / candidate.lengthM), 4),
      deviationM: round(percentile(deviations, 0.5), 1),
    });
  }

  return {
    traceId,
    legs,
    matchedM: round(matchedM, 1),
    unmatchedM: round(unmatchedM, 1),
    matchedRatio: round(clamp01(matchedM / totalM), 4),
    gaps,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Confiance accordée à un segment (section 12)                     */
/* ------------------------------------------------------------------ */

/**
 * Ce que l'usage réel nous apprend d'un segment. Tous les champs sont
 * optionnels : un champ absent vaut « pas encore de données », jamais « zéro ».
 */
export interface SegmentUsageSummary {
  /** Passages de nos utilisateurs. */
  passages?: number;
  /** Utilisateurs distincts les ayant produits. */
  uniqueUsers?: number;
  /** Dernier passage (ms epoch). */
  lastPassageAt?: number | null;
  /** Temps de parcours moyen (ms). */
  averageDurationMs?: number | null;
  /** Répartition des passages par activité. */
  activities?: Partial<Record<ActivityMode, number>> | null;
  /** Indice de fréquentation déjà calculé par l'agrégateur. */
  frequentation?: FrequentationLevel | null;
}

/** Poids d'une couche, `0` si la couche est inconnue du contrat. */
function layerWeight(layer: GeometryLayer): number {
  const weight = KNOWLEDGE_LAYER_WEIGHTS[layer];
  return Number.isFinite(weight) && weight > 0 ? weight : 0;
}

/**
 * Confiance d'un segment, 0..100, expliquée en français (section 12).
 *
 * Le score croît avec la présence dans OpenStreetMap, la présence dans une
 * source officielle, le nombre de sources **distinctes** (et non d'attestations :
 * deux attestations de la même source ne comptent qu'une fois), le nombre de
 * traces importées distinctes, les passages réels de nos utilisateurs et la
 * fraîcheur de la dernière preuve.
 *
 * Une attestation sans `sourceId` ne prouve aucune indépendance : elle établit
 * la présence dans sa couche, mais n'incrémente pas `uniqueSources` — on ne
 * suppose pas distinctes deux origines que l'on ne sait pas nommer.
 *
 * Le total des apports externes est plafonné à `KNOWLEDGE_EXTERNAL_SCORE_CAP` :
 * aucune accumulation de sources ne porte un segment à 100. Seuls les passages
 * réels franchissent ce plafond (section 25) — parce qu'eux seuls prouvent que
 * le chemin existe *aujourd'hui* et qu'on peut y passer.
 */
export function segmentConfidence(
  attestations: readonly SegmentAttestation[],
  usage: SegmentUsageSummary = {},
  now: number = Date.now(),
): SegmentConfidence {
  const reference = Number.isFinite(now) ? now : Date.now();
  const layerEvidence = new Map<GeometryLayer, Set<string>>();
  const sources = new Set<string>();
  const traces = new Set<string>();
  let lastEvidenceAt: number | null = null;

  for (const attestation of attestations ?? []) {
    if (layerWeight(attestation.layer) <= 0) continue;
    const sourceId = textOrNull(attestation.sourceId);
    const traceId = textOrNull(attestation.traceId);
    if (sourceId !== null) sources.add(sourceId);
    if (traceId !== null) traces.add(traceId);
    // Clé de dédoublonnage : la même source répétée ne compte qu'une fois dans
    // sa couche, faute de quoi dix exports d'un même catalogue vaudraient dix
    // confirmations indépendantes.
    const key =
      sourceId !== null ? `s:${sourceId}` : traceId !== null ? `t:${traceId}` : KNOWLEDGE_ANONYMOUS_EVIDENCE_KEY;
    const bucket = layerEvidence.get(attestation.layer);
    if (bucket === undefined) layerEvidence.set(attestation.layer, new Set([key]));
    else bucket.add(key);
    const at = attestation.at;
    if (at !== null && Number.isFinite(at) && (lastEvidenceAt === null || at > lastEvidenceAt)) lastEvidenceAt = at;
  }

  const passages = countOr(usage.passages);
  const uniqueUsers = countOr(usage.uniqueUsers);
  const lastPassageAt = usage.lastPassageAt;
  if (
    lastPassageAt !== null &&
    lastPassageAt !== undefined &&
    Number.isFinite(lastPassageAt) &&
    (lastEvidenceAt === null || lastPassageAt > lastEvidenceAt)
  ) {
    lastEvidenceAt = lastPassageAt;
  }

  const reasons: ScoredReason[] = [];
  const byLayer: Partial<Record<GeometryLayer, number>> = {};
  let layersScore = 0;
  for (let i = 0; i < KNOWLEDGE_LAYER_ORDER.length; i++) {
    const layer = KNOWLEDGE_LAYER_ORDER[i];
    const evidence = layerEvidence.get(layer);
    if (evidence === undefined || evidence.size === 0) continue;
    const full = Math.max(2, KNOWLEDGE_LAYER_EVIDENCE_FULL);
    const share =
      KNOWLEDGE_LAYER_SINGLE_SHARE +
      (1 - KNOWLEDGE_LAYER_SINGLE_SHARE) * clamp01((evidence.size - 1) / (full - 1));
    const points = layerWeight(layer) * share;
    byLayer[layer] = round(points, 1);
    layersScore += points;
    reasons.push({ points, rank: i, text: KNOWLEDGE_LAYER_LABELS[layer] });
  }

  const sourcesPoints = KNOWLEDGE_SOURCES_POINTS * saturate(sources.size, KNOWLEDGE_SOURCES_FULL);
  if (sources.size > 0) {
    reasons.push({
      points: sourcesPoints,
      rank: 10,
      text:
        sources.size === 1
          ? "attesté par une seule source"
          : `attesté par ${sources.size} sources indépendantes`,
    });
  }
  const tracesPoints = KNOWLEDGE_TRACES_POINTS * saturate(traces.size, KNOWLEDGE_TRACES_FULL);
  if (traces.size > 0) {
    reasons.push({
      points: tracesPoints,
      rank: 11,
      text: `${plural(traces.size, "trace importée distincte", "traces importées distinctes")}`,
    });
  }
  const freshnessPoints =
    KNOWLEDGE_FRESHNESS_POINTS * freshness(lastEvidenceAt, reference, KNOWLEDGE_FRESHNESS_HALF_LIFE_DAYS);
  if (lastEvidenceAt !== null) {
    reasons.push({
      points: freshnessPoints,
      rank: 12,
      text: `dernière observation : ${describeAge(lastEvidenceAt, reference)}`,
    });
  }

  const externalScore = Math.min(
    KNOWLEDGE_EXTERNAL_SCORE_CAP,
    layersScore + sourcesPoints + tracesPoints + freshnessPoints,
  );
  const passagesPoints = KNOWLEDGE_PASSAGES_POINTS * saturate(passages, KNOWLEDGE_PASSAGES_FULL);
  if (passages > 0) {
    reasons.push({
      points: passagesPoints,
      rank: 13,
      text: `${plural(passages, "passage de nos utilisateurs", "passages de nos utilisateurs")}`,
    });
  }
  const usersPoints = KNOWLEDGE_USERS_POINTS * saturate(uniqueUsers, KNOWLEDGE_USERS_FULL);
  if (uniqueUsers > 0) {
    reasons.push({
      points: usersPoints,
      rank: 14,
      text: `${plural(uniqueUsers, "utilisateur distinct", "utilisateurs distincts")}`,
    });
  }
  // Le plafond n'est explicité que lorsqu'il mord réellement : sans usage réel,
  // la confiance ne peut plus monter, et il faut le dire.
  if (passages === 0 && layersScore + sourcesPoints + tracesPoints + freshnessPoints > KNOWLEDGE_EXTERNAL_SCORE_CAP) {
    reasons.push({ points: 0, rank: 15, text: KNOWLEDGE_EXTERNAL_CAP_REASON });
  }

  const score = Math.min(100, externalScore + passagesPoints + usersPoints);
  return {
    score: round(score, 1),
    byLayer,
    uniqueSources: sources.size,
    traces: traces.size,
    passages,
    lastEvidenceAt,
    reasons: reasons.length === 0 ? [KNOWLEDGE_NO_EVIDENCE_REASON] : orderReasons(reasons),
  };
}

/* ------------------------------------------------------------------ */
/* 3. Choix de la géométrie affichée (section 21)                      */
/* ------------------------------------------------------------------ */

/** Candidat évalué, avec son rang effectif et ses départages. */
interface RankedGeometry {
  rank: number;
  confidence: number;
  layer: GeometryLayer;
  coordinates: LngLat[];
  sourceId: string | null;
  index: number;
  weak: boolean;
}

/** Nombre décimal en français (« 0,82 »). */
function decimalText(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

/**
 * Choisit la meilleure géométrie disponible et **explique pourquoi** (section 21).
 *
 * L'ordre de préférence est `community` (ligne centrale reconstruite depuis les
 * passages réels) quand elle est solide, puis `official`, `osm`, `imported_gpx`.
 * Une ligne communautaire dont la confiance n'atteint pas
 * `KNOWLEDGE_COMMUNITY_MIN_CONFIDENCE` — ou dont la confiance est simplement
 * inconnue, car l'inconnu n'est jamais flatteur — recule derrière les sources
 * externes : elle reste disponible, elle ne fait plus autorité.
 *
 * Sont écartées : les géométries de moins de `KNOWLEDGE_MIN_GEOMETRY_POINTS`
 * points, celles qui contiennent une coordonnée illisible (on ne répare pas une
 * géométrie en silence) et celles de longueur nulle (des points superposés ne
 * décrivent aucun chemin). Aucun candidat retenu → `null`, jamais un objet
 * vide. Rien n'est supprimé ni modifié : les autres couches continuent
 * d'exister avec leur provenance (section 11).
 */
export function bestGeometry(
  candidates: readonly {
    layer: GeometryLayer;
    coordinates: LngLat[];
    sourceId: string | null;
    confidence?: number;
  }[],
): GeometryChoice | null {
  const ranked: RankedGeometry[] = [];
  let communityRejected = false;
  for (let index = 0; index < (candidates ?? []).length; index++) {
    const candidate = candidates[index];
    const priority = KNOWLEDGE_GEOMETRY_PRIORITY[candidate.layer];
    if (!Number.isFinite(priority)) continue;
    const coordinates = candidate.coordinates ?? [];
    const line = usableLine(coordinates);
    const isCommunity = candidate.layer === "community";
    // Géométrie douteuse : trop courte, illisible en partie, ou réduite à un point.
    if (
      line.length < KNOWLEDGE_MIN_GEOMETRY_POINTS ||
      line.length !== coordinates.length ||
      polylineLengthM(line) <= 0
    ) {
      if (isCommunity) communityRejected = true;
      continue;
    }
    const declared = candidate.confidence;
    const confidence = declared !== undefined && Number.isFinite(declared) ? clamp01(declared) : 0;
    const weak = isCommunity && confidence < KNOWLEDGE_COMMUNITY_MIN_CONFIDENCE;
    if (weak) communityRejected = true;
    ranked.push({
      rank: weak ? KNOWLEDGE_WEAK_COMMUNITY_PRIORITY : priority,
      confidence,
      layer: candidate.layer,
      coordinates: line,
      sourceId: textOrNull(candidate.sourceId),
      index,
      weak,
    });
  }
  if (ranked.length === 0) return null;

  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.confidence - a.confidence ||
      b.coordinates.length - a.coordinates.length ||
      compareNullableText(a.sourceId, b.sourceId) ||
      a.index - b.index,
  );
  const winner = ranked[0];

  const parts: string[] = [KNOWLEDGE_GEOMETRY_REASONS[winner.layer]];
  if (winner.layer === "community") {
    parts.push(
      winner.weak
        ? `confiance ${decimalText(winner.confidence)} sous le seuil de ${decimalText(KNOWLEDGE_COMMUNITY_MIN_CONFIDENCE)}, retenue faute de mieux`
        : `confiance ${decimalText(winner.confidence)}`,
    );
  } else if (communityRejected) {
    parts.push(KNOWLEDGE_NO_COMMUNITY_SUFFIX);
  }
  return {
    layer: winner.layer,
    coordinates: winner.coordinates.map((c): LngLat => [c[0], c[1]]),
    sourceId: winner.sourceId,
    reason: parts.join(" ; "),
  };
}

/* ------------------------------------------------------------------ */
/* 4. Chemins probablement existants (section 13)                      */
/* ------------------------------------------------------------------ */

/** Réglages de la détection de chemins manquants. */
export interface KnowledgeTrailOptions {
  /** Sources distinctes exigées. Défaut : `CORRIDOR_MIN_SOURCES`. */
  minSources?: number;
  /** Longueur (m) minimale du corridor. Défaut : `KNOWLEDGE_TRAIL_MIN_LENGTH_M`. */
  minLengthM?: number;
  /** Distance (m) au-delà de laquelle aucun chemin connu ne couvre l'échantillon. */
  clearanceM?: number;
  /** Part minimale du corridor hors réseau. Défaut : `KNOWLEDGE_TRAIL_MIN_NEW_SHARE`. */
  minNewShare?: number;
  /** Pas d'échantillonnage (m). Défaut : `KNOWLEDGE_TRAIL_SAMPLE_M`. */
  sampleM?: number;
  /** Passages de nos utilisateurs, par identifiant de corridor. */
  passagesByCorridor?: Readonly<Record<string, number>>;
}

/** Traces distinctes d'un corridor (un même identifiant répété ne compte qu'une fois). */
function distinctTraces(traceIds: readonly string[] | null | undefined): number {
  const set = new Set<string>();
  for (const id of traceIds ?? []) {
    const clean = textOrNull(id);
    if (clean !== null) set.add(clean);
  }
  return set.size;
}

/**
 * Dispersion exploitable d'un faisceau. Une dispersion inconnue vaut le pire
 * cas et non zéro : on ne prétend pas qu'un faisceau est resserré parce qu'on
 * ignore s'il l'est.
 */
function usableDispersion(dispersionM: number, worstCaseM: number): number {
  return Number.isFinite(dispersionM) && dispersionM >= 0 ? dispersionM : worstCaseM;
}

/**
 * Corridors attestés par plusieurs sources indépendantes qu'aucun chemin de la
 * base ne décrit (section 13).
 *
 * Le corridor est échantillonné et confronté au réseau : au-delà de
 * `clearanceM`, aucun segment connu ne le couvre. Quand la part hors réseau
 * dépasse `minNewShare`, la proposition est faite — avec son score et ses
 * raisons, jamais un chemin créé d'office. Plusieurs sources DISTINCTES sont
 * exigées : une même trace republiée par trois plateformes reste une seule
 * observation (section 10).
 *
 * Tri déterministe : score décroissant, puis longueur décroissante, puis
 * identifiant.
 */
export function potentialExistingTrails(
  corridors: readonly TraceCorridor[],
  network: readonly PathSegment[],
  opts: KnowledgeTrailOptions = {},
): PotentialExistingTrail[] {
  const minSources = Math.max(1, Math.floor(positiveOr(opts.minSources, CORRIDOR_MIN_SOURCES)));
  const minLengthM = nonNegativeOr(opts.minLengthM, KNOWLEDGE_TRAIL_MIN_LENGTH_M);
  const clearanceM = positiveOr(opts.clearanceM, KNOWLEDGE_TRAIL_CLEARANCE_M);
  const minNewShare = clamp01(nonNegativeOr(opts.minNewShare, KNOWLEDGE_TRAIL_MIN_NEW_SHARE));
  const sampleM = positiveOr(opts.sampleM, KNOWLEDGE_TRAIL_SAMPLE_M);
  const passagesByCorridor = opts.passagesByCorridor ?? {};

  const out: PotentialExistingTrail[] = [];
  for (let index = 0; index < (corridors ?? []).length; index++) {
    const corridor = corridors[index];
    const id = textOrNull(corridor.id) ?? `${index}`;
    const uniqueSources = countOr(corridor.uniqueSources);
    if (uniqueSources < minSources) continue;
    const line = usableLine(corridor.coordinates);
    if (line.length < KNOWLEDGE_MIN_GEOMETRY_POINTS) continue;
    const cumulative = cumulativeDistances(line);
    const lengthM = cumulative[cumulative.length - 1];
    if (!Number.isFinite(lengthM) || lengthM < minLengthM || lengthM <= 0) continue;

    const area = lineBBox(line);
    const candidates = prepareCandidates(network, area, clearanceM);
    const count = Math.max(1, Math.min(KNOWLEDGE_MAX_SAMPLES, Math.ceil(lengthM / sampleM)));
    let newSamples = 0;
    for (let i = 0; i < count; i++) {
      const sample = pointAtAlong(line, cumulative, ((i + 0.5) / count) * lengthM);
      let nearest = Number.POSITIVE_INFINITY;
      for (const candidate of candidates) {
        if (!inBBox(sample, candidate.bbox)) continue;
        const distance = distanceToPolylineM(sample, candidate.line);
        if (distance < nearest) nearest = distance;
      }
      if (nearest > clearanceM) newSamples += 1;
    }
    const newShare = newSamples / count;
    if (newShare < minNewShare) continue;

    const traces = distinctTraces(corridor.traceIds);
    const declaredPassages = passagesByCorridor[id];
    const passages = countOr(declaredPassages);
    const dispersionM = usableDispersion(corridor.dispersionM, clearanceM);

    const reasons: ScoredReason[] = [];
    const sourcesPoints = KNOWLEDGE_TRAIL_SCORE_WEIGHTS.sources * saturate(uniqueSources, KNOWLEDGE_SOURCES_FULL);
    reasons.push({
      points: sourcesPoints,
      rank: 0,
      text: `${plural(uniqueSources, "source indépendante atteste", "sources indépendantes attestent")} ce passage`,
    });
    const noveltyPoints = KNOWLEDGE_TRAIL_SCORE_WEIGHTS.novelty * clamp01(newShare);
    reasons.push({
      points: noveltyPoints,
      rank: 1,
      text: `aucun chemin connu sur ${percentText(newShare)} du corridor`,
    });
    const passagesPoints = KNOWLEDGE_TRAIL_SCORE_WEIGHTS.passages * saturate(passages, KNOWLEDGE_TRAIL_PASSAGES_FULL);
    if (passages > 0) {
      reasons.push({
        points: passagesPoints,
        rank: 2,
        text: `${plural(passages, "passage de nos utilisateurs", "passages de nos utilisateurs")}`,
      });
    }
    const tracesPoints = KNOWLEDGE_TRAIL_SCORE_WEIGHTS.traces * saturate(traces, KNOWLEDGE_TRACES_FULL);
    if (traces > 0) {
      reasons.push({
        points: tracesPoints,
        rank: 3,
        text: `${plural(traces, "trace importée distincte", "traces importées distinctes")}`,
      });
    }
    const dispersionPoints =
      KNOWLEDGE_TRAIL_SCORE_WEIGHTS.dispersion * clamp01(1 - dispersionM / clearanceM);
    reasons.push({
      points: dispersionPoints,
      rank: 4,
      text: `faisceau à ${round(dispersionM, 1)} m de dispersion`,
    });
    const lengthPoints = KNOWLEDGE_TRAIL_SCORE_WEIGHTS.length * saturate(lengthM, KNOWLEDGE_TRAIL_LENGTH_FULL_M);
    reasons.push({ points: lengthPoints, rank: 5, text: `${formatDistance(lengthM)} de chemin` });

    const score =
      sourcesPoints + noveltyPoints + passagesPoints + tracesPoints + dispersionPoints + lengthPoints;
    out.push({
      id: `${KNOWLEDGE_TRAIL_ID_PREFIX}${id}`,
      coordinates: line,
      lengthM: round(lengthM, 1),
      traces,
      uniqueSources,
      passages,
      dispersionM: round(dispersionM, 1),
      score: round(Math.min(100, score), 1),
      reasons: orderReasons(reasons),
    });
  }
  out.sort((a, b) => b.score - a.score || b.lengthM - a.lengthM || compareText(a.id, b.id));
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. Corrections de géométrie proposées (section 14)                  */
/* ------------------------------------------------------------------ */

/** Réglages de la détection d'un décalage systématique. */
export interface GeometryCorrectionOptions {
  /** Sources distinctes exigées. Défaut : `CORRIDOR_MIN_SOURCES`. */
  minSources?: number;
  /** Écart médian signé (m) minimal. Défaut : `KNOWLEDGE_CORRECTION_MIN_OFFSET_M`. */
  minOffsetM?: number;
  /** Écart (m) au-delà duquel le faisceau décrit un autre chemin. */
  maxOffsetM?: number;
  /** Échantillons mesurés minimaux. Défaut : `KNOWLEDGE_CORRECTION_MIN_SAMPLES`. */
  minSamples?: number;
  /** Part du segment devant être couverte. Défaut : `KNOWLEDGE_CORRECTION_MIN_OVERLAP`. */
  minOverlap?: number;
  /** Part des écarts devant aller du même côté. Défaut : `KNOWLEDGE_CORRECTION_MIN_SIGN_SHARE`. */
  minSignShare?: number;
  /** Pas d'échantillonnage (m). Défaut : `KNOWLEDGE_CORRECTION_SAMPLE_M`. */
  sampleM?: number;
}

/**
 * Écart latéral **signé** (m) entre un point du segment et le faisceau observé.
 * Positif quand le faisceau passe à gauche du sens de description du segment.
 * C'est le produit vectoriel de la direction du segment par le vecteur qui mène
 * au faisceau : un décalage à gauche et un décalage à droite de même ampleur
 * s'annulent, ce qu'une distance absolue ne ferait jamais.
 */
function signedOffsetM(point: LatLng, target: LatLng, headingDeg: number): number {
  const mPerDegLng = METERS_PER_DEG_LAT * Math.max(MIN_COS_LAT, Math.cos(toRad(point.lat)));
  const east = (target.lng - point.lng) * mPerDegLng;
  const north = (target.lat - point.lat) * METERS_PER_DEG_LAT;
  const heading = toRad(headingDeg);
  const ux = Math.sin(heading);
  const uy = Math.cos(heading);
  return ux * north - uy * east;
}

/**
 * Segments dont la géométrie de référence s'écarte **systématiquement** du
 * faisceau observé (section 14).
 *
 * L'écart retenu est la **médiane signée** des écarts latéraux mesurés le long
 * du segment : un faisceau qui déborde autant à gauche qu'à droite a une
 * médiane proche de zéro et ne produit rien. S'y ajoutent trois garde-fous :
 * un écart minimal (en dessous, c'est la précision ordinaire d'un GNSS sous
 * couvert), une part d'écarts du même côté (`minSignShare` : « systématiquement »
 * n'est pas « en moyenne »), et le refus de conclure quand la dispersion du
 * faisceau dépasse l'écart constaté — un nuage large de 30 m ne démontre pas un
 * décalage de 12 m.
 *
 * Ce sont des PROPOSITIONS : rien n'est appliqué ici, rien n'écrase la
 * géométrie existante (section 11), et aucune correction n'est jamais renvoyée
 * à la source externe d'origine. Tri : score décroissant, puis écart absolu
 * décroissant, puis identifiant de segment.
 */
export function potentialGeometryCorrections(
  input: readonly { segment: PathSegment; corridor: TraceCorridor }[],
  opts: GeometryCorrectionOptions = {},
): PotentialGeometryCorrection[] {
  const minSources = Math.max(1, Math.floor(positiveOr(opts.minSources, CORRIDOR_MIN_SOURCES)));
  const minOffsetM = nonNegativeOr(opts.minOffsetM, KNOWLEDGE_CORRECTION_MIN_OFFSET_M);
  const maxOffsetM = positiveOr(opts.maxOffsetM, KNOWLEDGE_CORRECTION_MAX_OFFSET_M);
  const minSamples = Math.max(1, Math.floor(positiveOr(opts.minSamples, KNOWLEDGE_CORRECTION_MIN_SAMPLES)));
  const minOverlap = clamp01(nonNegativeOr(opts.minOverlap, KNOWLEDGE_CORRECTION_MIN_OVERLAP));
  const minSignShare = clamp01(nonNegativeOr(opts.minSignShare, KNOWLEDGE_CORRECTION_MIN_SIGN_SHARE));
  const sampleM = positiveOr(opts.sampleM, KNOWLEDGE_CORRECTION_SAMPLE_M);

  const out: PotentialGeometryCorrection[] = [];
  for (const entry of input ?? []) {
    const segmentId = textOrNull(entry.segment.id);
    if (segmentId === null) continue;
    const uniqueSources = countOr(entry.corridor.uniqueSources);
    if (uniqueSources < minSources) continue;

    const segLine = usableLine(entry.segment.coordinates);
    const corLine = usableLine(entry.corridor.coordinates);
    if (segLine.length < KNOWLEDGE_MIN_GEOMETRY_POINTS || corLine.length < KNOWLEDGE_MIN_GEOMETRY_POINTS) continue;
    const segCum = cumulativeDistances(segLine);
    const segLengthM = segCum[segCum.length - 1];
    if (!Number.isFinite(segLengthM) || segLengthM <= 0) continue;
    const corCum = cumulativeDistances(corLine);

    const count = Math.max(2, Math.min(KNOWLEDGE_MAX_SAMPLES, Math.ceil(segLengthM / sampleM) + 1));
    const offsets: number[] = [];
    for (let i = 0; i < count; i++) {
      const along = (i / (count - 1)) * segLengthM;
      const point = pointAtAlong(segLine, segCum, along);
      const projection = projectOnPolyline(point, corLine, corCum);
      if (projection === null || projection.distanceM > maxOffsetM) continue;
      // Cap local du segment, mesuré sur un pas complet de part et d'autre : le
      // cap d'une arête isolée serait trop bruité pour orienter un signe.
      const heading = bearingBetweenAlong(
        segLine,
        segCum,
        Math.max(0, along - sampleM / 2),
        Math.min(segLengthM, along + sampleM / 2),
      );
      offsets.push(signedOffsetM(point, projection.snapped, heading));
    }
    if (offsets.length < minSamples || offsets.length / count < minOverlap) continue;

    const offsetM = percentile(offsets, 0.5);
    const absOffsetM = Math.abs(offsetM);
    if (absOffsetM < minOffsetM || absOffsetM <= 0) continue;

    const sign = offsetM > 0 ? 1 : -1;
    let sameSide = 0;
    let maxAbs = 0;
    for (const offset of offsets) {
      if (offset * sign > 0) sameSide += 1;
      if (Math.abs(offset) > maxAbs) maxAbs = Math.abs(offset);
    }
    const signShare = sameSide / offsets.length;
    if (signShare < minSignShare) continue;

    const dispersionM = usableDispersion(entry.corridor.dispersionM, maxOffsetM);
    // Un faisceau plus large que le décalage qu'il prétend démontrer ne
    // démontre rien : c'est du bruit centré sur la géométrie de référence.
    if (dispersionM > absOffsetM) continue;

    const evidence = distinctTraces(entry.corridor.traceIds);
    const layer = KNOWLEDGE_SOURCE_LAYERS[entry.segment.source] ?? "imported_gpx";
    const side = offsetM > 0 ? "à gauche" : "à droite";

    const reasons: ScoredReason[] = [];
    const offsetPoints =
      KNOWLEDGE_CORRECTION_SCORE_WEIGHTS.offset * saturate(absOffsetM, KNOWLEDGE_CORRECTION_OFFSET_FULL_M);
    reasons.push({
      points: offsetPoints,
      rank: 0,
      text: `le faisceau observé passe à ${round(absOffsetM, 1)} m ${side} du tracé de référence`,
    });
    const consistencyPoints =
      KNOWLEDGE_CORRECTION_SCORE_WEIGHTS.consistency *
      (minSignShare >= 1 ? (signShare >= 1 ? 1 : 0) : clamp01((signShare - minSignShare) / (1 - minSignShare)));
    reasons.push({
      points: consistencyPoints,
      rank: 1,
      text: `${percentText(signShare)} des écarts du même côté`,
    });
    const sourcesPoints = KNOWLEDGE_CORRECTION_SCORE_WEIGHTS.sources * saturate(uniqueSources, KNOWLEDGE_SOURCES_FULL);
    reasons.push({
      points: sourcesPoints,
      rank: 2,
      text: `${plural(uniqueSources, "source indépendante", "sources indépendantes")}`,
    });
    const evidencePoints = KNOWLEDGE_CORRECTION_SCORE_WEIGHTS.evidence * saturate(evidence, KNOWLEDGE_TRACES_FULL);
    if (evidence > 0) {
      reasons.push({
        points: evidencePoints,
        rank: 3,
        text: `${plural(evidence, "trace importée distincte", "traces importées distinctes")}`,
      });
    }
    const tightnessPoints =
      KNOWLEDGE_CORRECTION_SCORE_WEIGHTS.tightness * clamp01(1 - dispersionM / absOffsetM);
    reasons.push({
      points: tightnessPoints,
      rank: 4,
      text: `dispersion de ${round(dispersionM, 1)} m pour ${round(absOffsetM, 1)} m d'écart`,
    });
    reasons.push({ points: 0, rank: 5, text: KNOWLEDGE_CORRECTION_PROPOSAL_NOTICE });

    const score = offsetPoints + consistencyPoints + sourcesPoints + evidencePoints + tightnessPoints;
    out.push({
      segmentId,
      layer,
      coordinates: corLine,
      offsetM: round(offsetM, 1),
      maxOffsetM: round(maxAbs, 1),
      evidence,
      uniqueSources,
      score: round(Math.min(100, score), 1),
      reasons: orderReasons(reasons),
    });
  }
  out.sort(
    (a, b) => b.score - a.score || Math.abs(b.offsetM) - Math.abs(a.offsetM) || compareText(a.segmentId, b.segmentId),
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* 6. Fiche de connaissance d'un segment (section 30)                  */
/* ------------------------------------------------------------------ */

/** Une source attestant le segment, et ce qu'elle en dit. */
export interface SegmentKnowledgeSource {
  /** `null` quand l'attestation ne nomme aucune source : elle ne prouve rien d'autre. */
  sourceId: string | null;
  layer: GeometryLayer;
  /** Attestations reçues de cette source dans cette couche. */
  attestations: number;
  /** Dernière attestation (ms epoch), `null` si aucune n'était datée. */
  lastAt: number | null;
}

/** Itinéraire empruntant le segment. */
export interface SegmentKnowledgeItinerary {
  id: string;
  name: string | null;
}

/**
 * Ce que l'usage nous apprend, tel qu'il est publiable. Un champ inconnu vaut
 * `null` et jamais `0` : « pas encore de données » n'est pas « personne n'y
 * passe » (section 43 du cahier des charges « moteur cartographique »).
 */
export interface SegmentKnowledgeUsage {
  /** Passages enregistrés ; `null` tant qu'on n'a rien mesuré. */
  passages: number | null;
  uniqueUsers: number | null;
  /** Temps de parcours moyen (ms). */
  averageDurationMs: number | null;
  /** Répartition par activité, dans l'ordre d'affichage des activités. */
  activities: Partial<Record<ActivityMode, number>> | null;
  frequentation: FrequentationLevel | null;
  lastPassageAt: number | null;
  /** Vrai tant que les passages ne permettent aucune conclusion. */
  insufficientData: boolean;
}

/**
 * Fiche d'un segment (section 30) : d'où vient sa géométrie, qui l'atteste,
 * quels itinéraires l'empruntent, quelle confiance on lui accorde, quand il a
 * été validé, et comment il est réellement parcouru.
 */
export interface SegmentKnowledgeCard {
  segmentId: string;
  name: string | null;
  /** Géométrie de référence affichée, avec la couche dont elle provient. */
  geometry: { layer: GeometryLayer; coordinates: LngLat[]; lengthM: number; points: number };
  /** Sources distinctes, de la couche la plus structurante à la plus brute. */
  sources: SegmentKnowledgeSource[];
  /** Itinéraires importés qui l'empruntent (section 6). */
  itineraries: SegmentKnowledgeItinerary[];
  confidence: SegmentConfidence;
  /** Dernière validation humaine (ms epoch), `null` si jamais validé. */
  lastValidatedAt: number | null;
  usage: SegmentKnowledgeUsage;
  /** Phrase prête à afficher, qui ne conclut jamais au-delà des données. */
  summary: string;
}

/** Entrée de `segmentKnowledge` : tout ce qui est connu du segment. */
export interface SegmentKnowledgeInput {
  segment: PathSegment;
  attestations: readonly SegmentAttestation[];
  itineraries: readonly { id: string; name: string | null }[];
  usage?: SegmentUsageSummary;
  lastValidatedAt?: number | null;
}

/** Rang d'affichage d'une couche (couche inconnue rejetée en fin de liste). */
function layerRank(layer: GeometryLayer): number {
  const rank = KNOWLEDGE_LAYER_ORDER.indexOf(layer);
  return rank < 0 ? KNOWLEDGE_LAYER_ORDER.length : rank;
}

/** Sources distinctes, avec leur nombre d'attestations et leur dernière date. */
function collectSources(attestations: readonly SegmentAttestation[]): SegmentKnowledgeSource[] {
  const groups = new Map<string, SegmentKnowledgeSource>();
  for (const attestation of attestations ?? []) {
    if (layerWeight(attestation.layer) <= 0) continue;
    const sourceId = textOrNull(attestation.sourceId);
    const key = `${attestation.layer}|${sourceId ?? ""}`;
    const at = attestation.at;
    const dated = at !== null && Number.isFinite(at) ? at : null;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { sourceId, layer: attestation.layer, attestations: 1, lastAt: dated });
      continue;
    }
    existing.attestations += 1;
    if (dated !== null && (existing.lastAt === null || dated > existing.lastAt)) existing.lastAt = dated;
  }
  const out = [...groups.values()];
  out.sort(
    (a, b) => layerRank(a.layer) - layerRank(b.layer) || compareNullableText(a.sourceId, b.sourceId),
  );
  return out;
}

/** Itinéraires dédoublonnés et triés (nom, puis identifiant). */
function collectItineraries(
  itineraries: readonly { id: string; name: string | null }[],
): SegmentKnowledgeItinerary[] {
  const seen = new Map<string, SegmentKnowledgeItinerary>();
  for (const itinerary of itineraries ?? []) {
    const id = textOrNull(itinerary.id);
    if (id === null || seen.has(id)) continue;
    seen.set(id, { id, name: textOrNull(itinerary.name) });
  }
  const out = [...seen.values()];
  out.sort((a, b) => compareNullableText(a.name, b.name) || compareText(a.id, b.id));
  return out;
}

/** Répartition par activité remise dans l'ordre d'affichage, valeurs positives seules. */
function normaliseActivities(
  activities: Partial<Record<ActivityMode, number>> | null | undefined,
): Partial<Record<ActivityMode, number>> | null {
  if (activities === null || activities === undefined) return null;
  const out: Partial<Record<ActivityMode, number>> = {};
  let seen = false;
  for (const mode of ACTIVITY_MODES) {
    const value = activities[mode];
    if (value === undefined || !Number.isFinite(value) || value <= 0) continue;
    out[mode] = value;
    seen = true;
  }
  return seen ? out : null;
}

/**
 * Fiche complète d'un segment (section 30).
 *
 * Tout ce qui relève de l'usage est publié à une condition : en savoir assez.
 * Sous `KNOWLEDGE_USAGE_MIN_PASSAGES` passages, le temps moyen, les activités
 * et la fréquentation restent `null` — non parce qu'ils vaudraient zéro, mais
 * parce qu'ils décriraient une ou deux sorties précises, ce qui serait à la
 * fois faux statistiquement et indiscret (section 34 du cahier des charges
 * « moteur cartographique »). Les comptages, eux, restent exacts.
 *
 * Un segment sans aucune donnée d'usage rend une fiche valide : `usage` entier
 * à `null`, `insufficientData: true`, et un résumé qui dit « pas encore de
 * données d'usage » plutôt que « personne n'y passe ».
 */
export function segmentKnowledge(input: SegmentKnowledgeInput, now: number = Date.now()): SegmentKnowledgeCard {
  const reference = Number.isFinite(now) ? now : Date.now();
  const segment = input.segment;
  const usage = input.usage ?? {};
  const attestations = input.attestations ?? [];

  const coordinates = usableLine(segment.coordinates);
  const declaredLengthM = segment.lengthM;
  const lengthM =
    coordinates.length >= KNOWLEDGE_MIN_GEOMETRY_POINTS
      ? round(polylineLengthM(coordinates), 1)
      : Number.isFinite(declaredLengthM) && declaredLengthM > 0
        ? round(declaredLengthM, 1)
        : 0;

  const confidence = segmentConfidence(attestations, usage, reference);
  const sources = collectSources(attestations);
  const itineraries = collectItineraries(input.itineraries);

  // Usage : `undefined` signifie « pas encore de données » et devient `null`.
  const declaredPassages = usage.passages;
  const passages =
    declaredPassages !== undefined && Number.isFinite(declaredPassages) && declaredPassages >= 0
      ? Math.floor(declaredPassages)
      : null;
  const declaredUsers = usage.uniqueUsers;
  const uniqueUsers =
    declaredUsers !== undefined && Number.isFinite(declaredUsers) && declaredUsers >= 0
      ? Math.floor(declaredUsers)
      : null;
  const declaredLastPassageAt = usage.lastPassageAt;
  const lastPassageAt =
    declaredLastPassageAt !== undefined &&
    declaredLastPassageAt !== null &&
    Number.isFinite(declaredLastPassageAt)
      ? declaredLastPassageAt
      : null;
  const insufficientData = passages === null || passages < KNOWLEDGE_USAGE_MIN_PASSAGES;
  const declaredDuration = usage.averageDurationMs;
  const averageDurationMs =
    !insufficientData && declaredDuration !== undefined && declaredDuration !== null && Number.isFinite(declaredDuration) && declaredDuration > 0
      ? Math.round(declaredDuration)
      : null;
  const activities = insufficientData ? null : normaliseActivities(usage.activities);
  const declaredFrequentation = usage.frequentation;
  const frequentation =
    !insufficientData && declaredFrequentation !== undefined && declaredFrequentation !== null && declaredFrequentation !== "unknown"
      ? declaredFrequentation
      : null;

  const declaredValidatedAt = input.lastValidatedAt;
  const lastValidatedAt =
    declaredValidatedAt !== undefined && declaredValidatedAt !== null && Number.isFinite(declaredValidatedAt)
      ? declaredValidatedAt
      : null;

  const parts: string[] = [`confiance ${round(confidence.score, 0)}/100`];
  parts.push(
    confidence.uniqueSources === 0
      ? KNOWLEDGE_NO_EVIDENCE_REASON
      : confidence.uniqueSources === 1
        ? "attesté par une seule source"
        : `attesté par ${confidence.uniqueSources} sources indépendantes`,
  );
  if (itineraries.length > 0) {
    parts.push(`emprunté par ${plural(itineraries.length, "itinéraire", "itinéraires")}`);
  }
  parts.push(
    insufficientData || passages === null
      ? KNOWLEDGE_NO_USAGE_LABEL
      : `${plural(passages, "passage de nos utilisateurs", "passages de nos utilisateurs")}`,
  );
  if (lastValidatedAt !== null) parts.push(`validé ${describeAge(lastValidatedAt, reference)}`);

  return {
    segmentId: segment.id,
    name: textOrNull(segment.name),
    geometry: {
      layer: KNOWLEDGE_SOURCE_LAYERS[segment.source] ?? "imported_gpx",
      coordinates,
      lengthM,
      points: coordinates.length,
    },
    sources,
    itineraries,
    confidence,
    lastValidatedAt,
    usage: {
      passages,
      uniqueUsers,
      averageDurationMs,
      activities,
      frequentation,
      lastPassageAt,
      insufficientData,
    },
    summary: `${parts.join(" ; ")}.`,
  };
}
