/**
 * Qualité d'une trace importée : noter une observation sans la confondre avec
 * la vérité.
 *
 * Sections du cahier des charges « traces GPX » couvertes ici :
 *
 *  - **9. Contrôle qualité d'une trace.** `gpxQuality` regarde tout ce que la
 *    section énumère : nombre de points, espacement (médiane *et* régularité),
 *    présence d'altitude, présence d'horodatage, continuité, sauts GPS,
 *    doublons, géométrie aberrante, date, et cohérence avec le terrain et les
 *    autres sources — ces deux derniers indices étant calculés ailleurs et
 *    reçus par `GpxQualityContext`.
 *  - **24. Un GPX est une OBSERVATION, pas la vérité.** Rien ici ne décrète
 *    qu'un chemin existe : le score dit seulement *à quel point on peut
 *    s'appuyer sur ce relevé*. C'est pourquoi l'absence de corroboration
 *    extérieure ne pénalise pas (une trace peut décrire un chemin absent de la
 *    carte, c'est même tout l'intérêt de la collecte, section 13), alors que la
 *    corroboration, elle, fait monter la confiance.
 *
 * Deux détections méritent l'attention du lecteur, parce qu'elles séparent une
 * belle trace d'une trace vraie :
 *
 * 1. **Le tracé à la main.** Un relevé réel est irrégulier : on ralentit, on
 *    s'arrête, le signal se dégrade sous le couvert. Un itinéraire *dessiné sur
 *    une carte* a des points d'un espacement mécaniquement régulier, ou très
 *    peu de points pour sa longueur, et jamais d'altitude ni d'horodatage.
 *    C'est une trace « propre » qui n'a pourtant rien observé du terrain : elle
 *    est signalée (`hand_drawn`) et plafonnée (`GPX_QUALITY_SCORE_CAPS`), jamais
 *    récompensée pour sa propreté. Le doute joue contre elle : une trace trop
 *    dépouillée pour qu'on puisse trancher est signalée plutôt que créditée.
 * 2. **La vitesse implausible.** Elle n'est cherchée que sur une trace
 *    *horodatée*. Une trace sans temps n'est pas suspecte pour autant : la
 *    plupart des plateformes publient des GPX dépouillés de leurs horodatages.
 *    Chercher une vitesse là où il n'y a pas de temps reviendrait à inventer un
 *    défaut.
 *
 * Module pur : aucun accès réseau, disque ou DOM, aucun aléa, aucune horloge
 * implicite (l'instant courant est toujours le paramètre `now`, dont le défaut
 * explicite est `Date.now()`). Sorties déterministes, y compris l'ordre des
 * drapeaux (`GPX_FLAG_ORDER`). Coût : linéaire sur le nombre de points, plus
 * un tri pour les percentiles et un balayage à grille borné pour le
 * recouvrement de la trace sur elle-même — jamais de comparaison deux à deux.
 */
import { METERS_PER_DEG_LAT, haversineM, isValidLatLng, type LngLat } from "../geo";
import type { LatLng } from "../types";
import { cumulativeDistances, pointAtAlong } from "../navigation/geometry";
import { percentile } from "../network/statistics";
import { DAY_MS } from "../time";
import {
  MIN_USABLE_QUALITY_SCORE,
  SAME_PATH_TOLERANCE_M,
  type CleaningFlag,
  type GpxQualityFlag,
  type GpxQualityLevel,
  type GpxQualityReport,
  type NormalizedTrace,
} from "./types";

/* ------------------------------------------------------------------ */
/* 1. Réglages (seuils documentés, pas des nombres perdus)             */
/* ------------------------------------------------------------------ */

/**
 * Nombre de points en dessous duquel une trace ne décrit plus une géométrie.
 *
 * Huit points, c'est déjà très peu : trois points relient deux sommets par des
 * droites qui ne suivent aucun sentier. En dessous, on ne tient pas un relevé
 * mais un croquis, et aucun rattachement au réseau n'a de sens.
 */
export const GPX_MIN_POINTS = 8;

/**
 * Longueur (m) en dessous de laquelle une trace n'a aucune étendue : tous ses
 * points tiennent dans un mouchoir de poche (export bloqué, récepteur figé au
 * départ). Elle est traitée comme une trace sans géométrie exploitable.
 */
export const GPX_MIN_TRACE_LENGTH_M = 25;

/** Espacement médian (m) jusqu'auquel la densité est jugée parfaite. */
export const GPX_GOOD_SPACING_M = 15;

/**
 * Espacement médian (m) à partir duquel la trace est signalée `sparse` :
 * au-delà, les virages et les lacets disparaissent entre deux points.
 */
export const GPX_SPARSE_SPACING_M = 40;

/** Espacement médian (m) au-delà duquel la densité ne vaut plus rien. */
export const GPX_MAX_SPACING_M = 120;

/**
 * Nombre d'espacements en dessous duquel la régularité n'est pas jugeable :
 * sur cinq intervalles, « régulier » et « au hasard » se ressemblent.
 */
export const GPX_REGULARITY_MIN_SPACINGS = 8;

/**
 * Dispersion relative des espacements — (p75 − p25) / médiane — attendue d'un
 * relevé réel. En dessous du minimum, l'espacement est trop mécanique pour
 * venir d'un récepteur ; au-dessus du maximum, l'échantillonnage part dans tous
 * les sens.
 */
export const GPX_NATURAL_SPREAD_MIN = 0.15;
/** Voir `GPX_NATURAL_SPREAD_MIN`. */
export const GPX_NATURAL_SPREAD_MAX = 1.5;

/** Dispersion relative à partir de laquelle l'espacement est dit irrégulier. */
export const GPX_IRREGULAR_SPREAD = 2.5;

/** Dispersion relative au-delà de laquelle le critère d'espacement vaut zéro. */
export const GPX_IRREGULAR_SPREAD_MAX = 4;

/**
 * Dispersion relative en dessous de laquelle l'espacement est *trop* régulier
 * pour un relevé : premier indice de tracé à la main. Un récepteur, même réglé
 * sur un pas fixe, produit toujours un peu de dispersion (pauses, pertes de
 * signal, variations d'allure).
 */
export const GPX_HAND_DRAWN_SPREAD_MAX = 0.12;

/**
 * Espacement médian (m) à partir duquel une trace *dépourvue d'altitude et
 * d'horodatage* est tenue pour dessinée plutôt que relevée : à 60 m entre deux
 * points, il n'y a plus d'observation du terrain, seulement une intention.
 */
export const GPX_HAND_DRAWN_SPACING_M = 60;

/** Nombre minimal d'altitudes exploitables pour parler de profil altimétrique. */
export const GPX_MIN_ELEVATION_POINTS = 2;

/** Bornes (m) d'une altitude crédible sur Terre : au-delà, c'est du remplissage. */
export const GPX_MIN_PLAUSIBLE_ELEVATION_M = -500;
/** Voir `GPX_MIN_PLAUSIBLE_ELEVATION_M`. */
export const GPX_MAX_PLAUSIBLE_ELEVATION_M = 9000;

/** Nombre minimal d'horodatages exploitables pour dater une trace. */
export const GPX_MIN_TIMED_POINTS = 2;

/**
 * Date la plus ancienne qu'un horodatage de trace puisse crédiblement porter.
 * Avant 1995, personne n'enregistrait de randonnée au GPS : un horodatage
 * antérieur est une valeur de remplissage (l'époque Unix, typiquement), pas une
 * date. Une telle trace est traitée comme non horodatée.
 */
export const GPX_EARLIEST_PLAUSIBLE_TIME = Date.UTC(1995, 0, 1);

/**
 * Avance tolérée sur l'instant courant (dérive d'horloge d'un récepteur).
 * Au-delà, l'horodatage n'est plus une date : il est écarté.
 */
export const GPX_FUTURE_TOLERANCE_MS = DAY_MS;

/**
 * Part de points écartés pour désordre temporel qui annule complètement le
 * crédit accordé à l'horodatage : 10 % de points dans le désordre, c'est une
 * horloge qui saute, pas une trace datée.
 */
export const GPX_TIME_DISORDER_RATIO_FULL = 0.1;

/** Distance (m) en dessous de laquelle un intervalle n'est jamais une coupure. */
export const GPX_GAP_M = 60;

/**
 * Facteur appliqué à l'espacement médian pour reconnaître une coupure : une
 * interruption se juge par rapport à l'échantillonnage *de la trace*. Sur un
 * relevé à 10 m, un saut de 300 m est un trou ; sur un itinéraire à 500 m par
 * point, c'est le pas normal.
 */
export const GPX_GAP_SPACING_FACTOR = 10;

/** Dépassement (m) au-delà du seuil de coupure qui annule la continuité. */
export const GPX_GAP_PENALTY_FULL_M = 1000;

/** Pénalité de continuité par interruption déclarée (trace en plusieurs morceaux). */
export const GPX_BREAK_PENALTY = 0.15;

/** Pénalité cumulée maximale due aux interruptions déclarées. */
export const GPX_BREAK_PENALTY_MAX = 0.6;

/** Part de points aberrants écartés à partir de laquelle on signale `spikes`. */
export const GPX_SPIKE_FLAG_RATIO = 0.01;

/** Part de points aberrants qui annule complètement le critère de propreté. */
export const GPX_ABERRANT_RATIO_FULL = 0.05;

/** Part de doublons écartés à partir de laquelle on signale `duplicates`. */
export const GPX_DUPLICATE_FLAG_RATIO = 0.05;

/** Part de doublons qui annule complètement la part « doublons » du critère. */
export const GPX_DUPLICATE_RATIO_FULL = 0.25;

/**
 * Part du critère de propreté portée par les points aberrants (sauts GPS,
 * coordonnées impossibles, île nulle) ; le reste est porté par les doublons.
 * Un saut de position fausse la géométrie, un doublon ne fait que l'alourdir.
 */
export const GPX_CLEANLINESS_SPIKE_SHARE = 0.6;

/** Âge (jours) jusqu'auquel une trace est tenue pour pleinement actuelle (2 ans). */
export const GPX_RECENT_DAYS = 730;

/** Âge (jours) à partir duquel une trace est signalée `stale` (7 ans). */
export const GPX_STALE_DAYS = 2555;

/** Âge (jours) au-delà duquel la fraîcheur ne vaut plus rien (15 ans). */
export const GPX_OBSOLETE_DAYS = 5475;

/**
 * Percentile de vitesse examiné : un unique point aberrant ne doit pas
 * condamner une trace, un cinquième des intervalles au-dessus du plausible, si.
 */
export const GPX_SPEED_PERCENTILE = 0.95;

/** Nombre minimal d'intervalles horodatés avant de juger une vitesse. */
export const GPX_SPEED_MIN_SAMPLES = 3;

/**
 * Vitesse instantanée (m/s) au-delà de laquelle un déplacement sur un chemin
 * n'est plus crédible : 12 m/s valent 43 km/h, au-dessus de toute descente VTT
 * soutenue et très loin de la marche ou du trail.
 */
export const GPX_MAX_PLAUSIBLE_SPEED_MS = 12;

/**
 * Vitesse *moyenne* (m/s) au-delà de laquelle la sortie entière est
 * implausible : 8 m/s valent 28,8 km/h de moyenne, du début à la fin, pauses
 * comprises — c'est un véhicule, ou des horodatages faux.
 */
export const GPX_MAX_PLAUSIBLE_AVERAGE_SPEED_MS = 8;

/** Pas (m) d'échantillonnage pour détecter le recouvrement de la trace sur elle-même. */
export const GPX_OVERLAP_SAMPLE_M = 25;

/**
 * Écart curviligne (m) minimal entre deux échantillons pour qu'une proximité
 * compte comme un recouvrement. En dessous, on ne mesure que la continuité
 * normale de la trace.
 */
export const GPX_OVERLAP_MIN_SEPARATION_M = 150;

/** Longueur (m) en dessous de laquelle le recouvrement n'est pas cherché. */
export const GPX_OVERLAP_MIN_LENGTH_M = 200;

/** Nombre maximal d'échantillons : borne le coût sur une très longue trace. */
export const GPX_OVERLAP_MAX_SAMPLES = 4000;

/** Part d'échantillons recouverts à partir de laquelle on signale `self_overlap`. */
export const GPX_SELF_OVERLAP_RATIO = 0.3;

/** Garde-fou du cosinus de latitude (grille) : évite une division par zéro aux pôles. */
export const GPX_MIN_COS_LAT = 0.01;

/**
 * Score d'une trace sans géométrie mesurable (aucun point exploitable, ou tous
 * les points au même endroit). Il n'y a rien à noter : le rapport ne doit pas
 * laisser croire à une trace « médiocre mais existante ». Zéro, et le niveau
 * `unusable` qui va avec.
 */
export const GPX_NO_GEOMETRY_SCORE = 0;

/**
 * Valeur d'un critère qu'on ne sait pas juger : ni bonus, ni pénalité.
 *
 * Ce n'est pas un défaut permissif au sens des droits (là, l'inconnu bloque et
 * c'est `licence.ts` qui tranche) : c'est l'aveu honnête qu'un indice manque.
 * Pénaliser l'absence reviendrait à condamner une trace pour une information
 * que personne ne lui a demandée ; la créditer reviendrait à inventer une
 * corroboration. On reste au milieu.
 */
export const GPX_NEUTRAL_UNKNOWN = 0.5;

/** Critères notés indépendamment puis combinés en un score unique. */
export type GpxQualityCriterion =
  | "density"
  | "spacing"
  | "elevation"
  | "time"
  | "continuity"
  | "cleanliness"
  | "freshness"
  | "agreement";

/** Ordre de parcours des critères : rend la composition du score reproductible. */
export const GPX_QUALITY_CRITERIA: readonly GpxQualityCriterion[] = [
  "density",
  "spacing",
  "elevation",
  "time",
  "continuity",
  "cleanliness",
  "freshness",
  "agreement",
];

/**
 * Poids des critères ; leur somme vaut 1.
 *
 * La densité et la continuité dominent parce qu'elles décrivent la *géométrie*,
 * seule chose qu'un GPX apporte réellement au réseau. La cohérence avec le
 * terrain et les autres sources pèse autant que la densité : une trace
 * corroborée par des sources indépendantes vaut mieux qu'une trace isolée, si
 * belle soit-elle. L'altitude et l'horodatage comptent peu : leur absence est
 * fréquente et n'invalide pas un relevé.
 */
export const GPX_QUALITY_WEIGHTS: Readonly<Record<GpxQualityCriterion, number>> = {
  density: 0.18,
  spacing: 0.1,
  elevation: 0.08,
  time: 0.08,
  continuity: 0.14,
  cleanliness: 0.12,
  freshness: 0.1,
  agreement: 0.2,
};

/**
 * Poids des trois indices de cohérence, renormalisés sur ceux qui sont fournis.
 * L'accord entre traces indépendantes prime : c'est la seule preuve qui ne
 * dépende pas d'une carte de référence (section 10).
 */
export const GPX_AGREEMENT_WEIGHTS = {
  corridorAgreement: 0.4,
  matchedRatio: 0.35,
  sourceReliability: 0.25,
} as const;

/**
 * Paliers de niveau, du plus haut au plus bas : le premier atteint gagne.
 * Le palier `fair` est calé sur `MIN_USABLE_QUALITY_SCORE` (contrat partagé) :
 * `fair` et au-dessus sont exploitables, `poor` et `unusable` ne le sont pas.
 */
export const GPX_QUALITY_THRESHOLDS: readonly {
  readonly minScore: number;
  readonly level: GpxQualityLevel;
}[] = [
  { minScore: 85, level: "excellent" },
  { minScore: 65, level: "good" },
  { minScore: MIN_USABLE_QUALITY_SCORE, level: "fair" },
  { minScore: 20, level: "poor" },
  { minScore: 0, level: "unusable" },
];

/**
 * Plafonds de score par défaut constaté : un défaut de *nature* ne se rattrape
 * pas par une belle géométrie.
 *
 *  - `hand_drawn` reste sous le niveau « bonne » : un itinéraire dessiné est
 *    une intention respectable, pas une observation du terrain.
 *  - `implausible_speed` et `too_few_points` passent sous
 *    `MIN_USABLE_QUALITY_SCORE` : le fichier est corrompu ou vide de géométrie.
 */
export const GPX_QUALITY_SCORE_CAPS: Readonly<Partial<Record<GpxQualityFlag, number>>> = {
  hand_drawn: 55,
  implausible_speed: 30,
  too_few_points: 25,
};

/**
 * Défauts rédhibitoires : leur seule présence rend la trace inexploitable,
 * quel que soit le score.
 */
export const GPX_BLOCKING_FLAGS: readonly GpxQualityFlag[] = ["too_few_points", "implausible_speed"];

/**
 * Défauts signalés *sans* perte de points. Un aller-retour ou une boucle qui
 * repasse sur elle-même n'est pas une mauvaise trace : c'est une trace qu'il
 * faudra découper avant de la rattacher au réseau (section 6). Le signal est
 * porté par le drapeau, pas par le score.
 */
export const GPX_INFORMATIVE_FLAGS: readonly GpxQualityFlag[] = ["self_overlap"];

/** Ordre de restitution des drapeaux, du plus disqualifiant au plus anodin. */
export const GPX_FLAG_ORDER: readonly GpxQualityFlag[] = [
  "too_few_points",
  "implausible_speed",
  "hand_drawn",
  "gaps",
  "sparse",
  "irregular_spacing",
  "spikes",
  "duplicates",
  "no_elevation",
  "no_time",
  "stale",
  "self_overlap",
];

/** Explication en français de chaque défaut, pour la bibliothèque du back-office. */
export const GPX_FLAG_REASONS: Readonly<Record<GpxQualityFlag, string>> = {
  too_few_points: "trop peu de points, ou aucune étendue, pour décrire une géométrie",
  sparse: "points trop espacés : géométrie grossière",
  irregular_spacing: "espacement très irrégulier",
  no_elevation: "aucune altitude exploitable",
  no_time: "aucun horodatage exploitable",
  gaps: "trace interrompue",
  spikes: "sauts GPS écartés au nettoyage",
  duplicates: "points en double",
  self_overlap: "repasse longuement sur elle-même : à découper avant rattachement",
  hand_drawn: "espacement mécanique, sans altitude ni horodatage : dessinée sur une carte plutôt que relevée sur le terrain",
  implausible_speed: "vitesses incompatibles avec un déplacement sur un chemin",
  stale: "trace ancienne : le terrain a pu changer",
};

/** Intitulé affichable de chaque niveau. */
export const GPX_QUALITY_LEVEL_LABELS: Readonly<Record<GpxQualityLevel, string>> = {
  excellent: "Excellente",
  good: "Bonne",
  fair: "Moyenne",
  poor: "Médiocre",
  unusable: "Inexploitable",
};

/** Séparateur de milliers du résumé : espace fine insécable (typographie française). */
export const GPX_THOUSANDS_SEPARATOR = " ";

/** Mention ajoutée au commentaire quand la trace n'entre pas dans le réseau. */
export const GPX_UNUSABLE_NOTICE = "Trace écartée de l'enrichissement du réseau.";

/** Mention employée quand aucun défaut coûteux n'a été relevé. */
export const GPX_NO_DEFECT_LABEL = "aucun défaut notable";

/** Avertissement ajouté au résumé d'une trace tenue pour dessinée à la main. */
export const GPX_HAND_DRAWN_SUMMARY = "tracé probablement dessiné à la main";

/** Mention employée dans le résumé quand la trace ne porte aucune date crédible. */
export const GPX_UNDATED_SUMMARY = "sans horodatage";

/* ------------------------------------------------------------------ */
/* 2. Contexte externe (cohérence terrain et inter-sources)            */
/* ------------------------------------------------------------------ */

/**
 * Indices de cohérence calculés ailleurs et transmis à l'analyse :
 * rattachement au réseau connu (`resolveItinerary`), accord avec les autres
 * traces du même corridor (`buildCorridors`), fiabilité constatée de la source
 * (registre `data_sources`).
 *
 * Tout y est facultatif, et leur absence ne coûte rien : une trace qui décrit
 * un chemin absent de la carte n'est pas fautive, c'est précisément ce qu'on
 * cherche (section 13).
 */
export interface GpxQualityContext {
  /** Source d'origine, pour sa fiabilité constatée (0..100). */
  source?: { reliabilityScore?: number } | null;
  /** Part de la trace rattachée à un chemin déjà connu, 0..1. */
  matchedRatio?: number | null;
  /** Accord avec les autres traces du même corridor, 0..1. */
  corridorAgreement?: number | null;
}

/* ------------------------------------------------------------------ */
/* 3. Outils internes                                                  */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => (!Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v);

/** Arrondi stable (évite « -0 » et les artefacts flottants en sortie JSON). */
function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Rampe décroissante : 1 jusqu'à `from`, 0 à partir de `to`, linéaire entre. */
function decreasingRamp(value: number, from: number, to: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= from) return 1;
  if (to <= from || value >= to) return 0;
  return (to - value) / (to - from);
}

/** Lecture défensive d'un compteur de nettoyage (champ absent, nul ou illisible). */
function removedCount(
  removed: Partial<Record<CleaningFlag, number>> | null | undefined,
  flag: CleaningFlag,
): number {
  if (removed === null || removed === undefined) return 0;
  const v = removed[flag];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Nombre exploitable, ou `null` si la valeur n'en est pas un. */
function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* 4. Préparation : points exploitables et tableaux alignés            */
/* ------------------------------------------------------------------ */

/**
 * Trace ramenée à ce qui est réellement exploitable : coordonnées valides, et
 * tableaux d'altitudes et d'horodatages *alignés* dessus.
 *
 * Un tableau annexe dont la longueur ne correspond pas aux coordonnées est
 * écarté en bloc : mal aligné, il attribuerait l'altitude d'un point à un
 * autre, ce qui est pire que de ne rien savoir.
 */
interface CleanTrace {
  line: LngLat[];
  elevations: number[] | null;
  times: number[] | null;
  /** Indices (dans `line`) qui suivent une coupure déclarée par la normalisation. */
  breakAt: Set<number>;
}

function cleanTrace(trace: NormalizedTrace): CleanTrace {
  const coords = Array.isArray(trace.coordinates) ? trace.coordinates : [];
  const rawEle = Array.isArray(trace.elevations) && trace.elevations.length === coords.length ? trace.elevations : null;
  const rawTime = Array.isArray(trace.times) && trace.times.length === coords.length ? trace.times : null;

  const declaredBreaks = new Set<number>();
  if (Array.isArray(trace.breaks)) {
    for (const b of trace.breaks) if (Number.isInteger(b) && b > 0) declaredBreaks.add(b);
  }

  const line: LngLat[] = [];
  const elevations: number[] = [];
  const times: number[] = [];
  const breakAt = new Set<number>();
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    if (!Array.isArray(c) || c.length < 2) continue;
    const p: LatLng = { lng: c[0], lat: c[1] };
    if (!isValidLatLng(p)) continue;
    if (declaredBreaks.has(i)) breakAt.add(line.length);
    line.push([p.lng, p.lat]);
    elevations.push(rawEle === null ? Number.NaN : rawEle[i]);
    times.push(rawTime === null ? Number.NaN : rawTime[i]);
  }
  return {
    line,
    elevations: rawEle === null ? null : elevations,
    times: rawTime === null ? null : times,
    breakAt,
  };
}

/**
 * Le fichier porte-t-il un profil altimétrique exploitable ?
 *
 * Une altitude constante (le fameux remplissage à zéro des outils de tracé)
 * n'est pas une mesure : elle est refusée. De même pour des valeurs hors de
 * toute plage terrestre.
 */
function hasUsableElevation(elevations: number[] | null): boolean {
  if (elevations === null) return false;
  const distinct = new Set<number>();
  let usable = 0;
  for (const e of elevations) {
    if (!Number.isFinite(e)) continue;
    if (e < GPX_MIN_PLAUSIBLE_ELEVATION_M || e > GPX_MAX_PLAUSIBLE_ELEVATION_M) continue;
    usable += 1;
    distinct.add(e);
  }
  return usable >= GPX_MIN_ELEVATION_POINTS && distinct.size >= 2;
}

/**
 * Bornes temporelles d'une trace réellement datée, ou `null`.
 *
 * Refusé : moins de deux horodatages, une durée nulle ou négative, une date
 * antérieure à `GPX_EARLIEST_PLAUSIBLE_TIME` (remplissage à l'époque Unix) ou
 * postérieure à l'instant courant au-delà de la tolérance d'horloge. Des
 * horodatages hors de toute plage crédible ne sont pas des horodatages : la
 * trace est alors traitée comme non datée, ce qui est plus honnête que de lui
 * inventer un âge.
 */
function traceTimeline(times: number[] | null, now: number): { startAt: number; endAt: number } | null {
  if (times === null) return null;
  const finite: number[] = [];
  for (const t of times) if (Number.isFinite(t)) finite.push(t);
  if (finite.length < GPX_MIN_TIMED_POINTS) return null;
  const startAt = finite[0];
  const endAt = finite[finite.length - 1];
  if (!(endAt > startAt)) return null;
  if (startAt < GPX_EARLIEST_PLAUSIBLE_TIME) return null;
  const horizon = (Number.isFinite(now) ? now : Date.now()) + GPX_FUTURE_TOLERANCE_MS;
  if (startAt > horizon || endAt > horizon) return null;
  return { startAt, endAt };
}

/* ------------------------------------------------------------------ */
/* 5. Recouvrement de la trace sur elle-même (section 9)               */
/* ------------------------------------------------------------------ */

/**
 * Part de la trace qui repasse à moins de `SAME_PATH_TOLERANCE_M` d'une autre
 * de ses portions, éloignée d'au moins `GPX_OVERLAP_MIN_SEPARATION_M` le long
 * du parcours (sans quoi on ne mesurerait que la continuité normale).
 *
 * Échantillonnage régulier puis grille au pas de la tolérance : chaque
 * échantillon ne regarde que ses neuf cellules voisines, ce qui reste
 * quasi linéaire là où une comparaison deux à deux serait quadratique. Le
 * nombre d'échantillons est borné par `GPX_OVERLAP_MAX_SAMPLES`.
 */
function selfOverlapRatio(line: readonly LngLat[], cumulative: readonly number[]): number {
  if (line.length < 2 || cumulative.length !== line.length) return 0;
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total < GPX_OVERLAP_MIN_LENGTH_M) return 0;

  const step = Math.max(GPX_OVERLAP_SAMPLE_M, total / GPX_OVERLAP_MAX_SAMPLES);
  const alongs: number[] = [];
  const points: LatLng[] = [];
  for (let along = 0; along <= total; along += step) {
    alongs.push(along);
    points.push(pointAtAlong(line, cumulative, along));
  }
  if (points.length < 2) return 0;

  // Grille uniforme : la latitude de référence fixe la taille des cellules,
  // pour que le pavage ne dépende pas de l'ordre de parcours.
  const cos = Math.max(GPX_MIN_COS_LAT, Math.cos((points[0].lat * Math.PI) / 180));
  const degLat = SAME_PATH_TOLERANCE_M / METERS_PER_DEG_LAT;
  const degLng = SAME_PATH_TOLERANCE_M / (METERS_PER_DEG_LAT * cos);

  const grid = new Map<string, number[]>();
  const cellOf = (i: number): string =>
    `${Math.floor(points[i].lat / degLat)}:${Math.floor(points[i].lng / degLng)}`;
  for (let i = 0; i < points.length; i++) {
    const key = cellOf(i);
    const cell = grid.get(key);
    if (cell === undefined) grid.set(key, [i]);
    else cell.push(i);
  }

  let overlapping = 0;
  for (let i = 0; i < points.length; i++) {
    const cy = Math.floor(points[i].lat / degLat);
    const cx = Math.floor(points[i].lng / degLng);
    let found = false;
    for (let dy = -1; dy <= 1 && !found; dy++) {
      for (let dx = -1; dx <= 1 && !found; dx++) {
        const cell = grid.get(`${cy + dy}:${cx + dx}`);
        if (cell === undefined) continue;
        for (const j of cell) {
          if (Math.abs(alongs[j] - alongs[i]) < GPX_OVERLAP_MIN_SEPARATION_M) continue;
          if (haversineM(points[i], points[j]) <= SAME_PATH_TOLERANCE_M) {
            found = true;
            break;
          }
        }
      }
    }
    if (found) overlapping += 1;
  }
  return overlapping / points.length;
}

/* ------------------------------------------------------------------ */
/* 6. Cohérence externe (sections 9, 10, 13)                           */
/* ------------------------------------------------------------------ */

/**
 * Note de cohérence 0..1 à partir des indices fournis.
 *
 * `matchedRatio` et `corridorAgreement` sont des *bonus* : ils partent de
 * `GPX_NEUTRAL_UNKNOWN` et montent jusqu'à 1. Une trace mal rattachée au réseau
 * connu n'est donc pas punie — elle décrit peut-être simplement un chemin que
 * la carte ignore (section 13). La fiabilité de la source, elle, est une
 * propriété mesurée du registre : elle joue sur toute l'échelle.
 * Aucun indice fourni → `GPX_NEUTRAL_UNKNOWN`.
 */
function agreementScore(context: GpxQualityContext | undefined): number {
  const parts: { weight: number; value: number }[] = [];

  const corridor = finiteOrNull(context?.corridorAgreement);
  if (corridor !== null) {
    parts.push({
      weight: GPX_AGREEMENT_WEIGHTS.corridorAgreement,
      value: GPX_NEUTRAL_UNKNOWN + (1 - GPX_NEUTRAL_UNKNOWN) * clamp01(corridor),
    });
  }
  const matched = finiteOrNull(context?.matchedRatio);
  if (matched !== null) {
    parts.push({
      weight: GPX_AGREEMENT_WEIGHTS.matchedRatio,
      value: GPX_NEUTRAL_UNKNOWN + (1 - GPX_NEUTRAL_UNKNOWN) * clamp01(matched),
    });
  }
  const reliability = finiteOrNull(context?.source?.reliabilityScore);
  if (reliability !== null) {
    parts.push({ weight: GPX_AGREEMENT_WEIGHTS.sourceReliability, value: clamp01(reliability / 100) });
  }

  if (parts.length === 0) return GPX_NEUTRAL_UNKNOWN;
  let weight = 0;
  let sum = 0;
  for (const p of parts) {
    weight += p.weight;
    sum += p.weight * p.value;
  }
  return weight > 0 ? clamp01(sum / weight) : GPX_NEUTRAL_UNKNOWN;
}

/* ------------------------------------------------------------------ */
/* 7. Niveau et restitution                                            */
/* ------------------------------------------------------------------ */

/**
 * Niveau correspondant à un score (paliers `GPX_QUALITY_THRESHOLDS`).
 * Un score illisible vaut `unusable` : on ne devine pas une qualité.
 */
export function gpxQualityLevel(score: number): GpxQualityLevel {
  if (!Number.isFinite(score)) return "unusable";
  for (const tier of GPX_QUALITY_THRESHOLDS) {
    if (score >= tier.minScore) return tier.level;
  }
  return "unusable";
}

/** Drapeaux dédoublonnés, filtrés des valeurs inconnues, dans l'ordre de gravité. */
function orderedFlags(flags: readonly GpxQualityFlag[] | null | undefined): GpxQualityFlag[] {
  if (!Array.isArray(flags)) return [];
  const seen = new Set<GpxQualityFlag>();
  for (const f of flags) if (GPX_FLAG_ORDER.includes(f)) seen.add(f);
  return GPX_FLAG_ORDER.filter((f) => seen.has(f));
}

/** Nombre formaté à la française (« 1 240 »), espace fine insécable. */
function formatCount(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, GPX_THOUSANDS_SEPARATOR);
}

/**
 * Résumé affichable dans la bibliothèque du back-office :
 * « 1 240 points, espacement médian 8 m, altitude présente, trace de 2019 ».
 *
 * L'année est lue en UTC pour que le même fichier produise la même phrase quel
 * que soit le fuseau du serveur. La mention de tracé à la main est ajoutée
 * quand elle s'applique : c'est l'information la plus utile au modérateur.
 */
function buildSummary(
  points: number,
  medianSpacingM: number,
  hasElevation: boolean,
  startAt: number | null,
  handDrawn: boolean,
): string {
  const parts: string[] = [];
  parts.push(points === 0 ? "aucun point" : `${formatCount(points)} point${points > 1 ? "s" : ""}`);
  if (points >= 2) parts.push(`espacement médian ${Math.round(medianSpacingM)} m`);
  parts.push(hasElevation ? "altitude présente" : "sans altitude");
  parts.push(startAt === null ? GPX_UNDATED_SUMMARY : `trace de ${new Date(startAt).getUTCFullYear()}`);
  if (handDrawn) parts.push(GPX_HAND_DRAWN_SUMMARY);
  return parts.join(", ");
}

/* ------------------------------------------------------------------ */
/* 8. Analyse complète d'une trace (section 9)                         */
/* ------------------------------------------------------------------ */

/**
 * Note une trace normalisée : géométrie, échantillonnage, altitude,
 * horodatage, continuité, propreté, âge, et cohérence avec le terrain et les
 * autres sources (via `context`).
 *
 * Le score n'est pas un verdict sur l'existence du chemin — un GPX reste une
 * observation (section 24) — mais une mesure de ce qu'on peut lui faire dire.
 * Deux garde-fous encadrent le chiffre : les plafonds
 * `GPX_QUALITY_SCORE_CAPS`, qui empêchent une belle géométrie de racheter un
 * défaut de nature (tracé à la main, fichier corrompu), et
 * `GPX_BLOCKING_FLAGS`, qui rend la trace inexploitable quel que soit le score.
 *
 * Robuste par construction : trace vide, point unique, coordonnées identiques,
 * tableaux annexes absents ou mal alignés, compteurs de nettoyage manquants —
 * aucun de ces cas ne jette, et aucune valeur non finie ne sort d'ici.
 *
 * @param trace Trace normalisée par l'étage d'ingestion.
 * @param context Indices de cohérence calculés ailleurs (facultatifs).
 * @param now Instant de référence (ms epoch). Défaut : `Date.now()`.
 */
export function gpxQuality(
  trace: NormalizedTrace,
  context?: GpxQualityContext,
  now: number = Date.now(),
): GpxQualityReport {
  const reference = Number.isFinite(now) ? now : Date.now();
  const { line, elevations, times, breakAt } = cleanTrace(trace);
  const points = line.length;
  const flags = new Set<GpxQualityFlag>();

  /* --- Géométrie et échantillonnage --------------------------------- */

  const cumulative = cumulativeDistances(line);
  const lengthM = points >= 2 ? cumulative[cumulative.length - 1] : 0;

  const allSpacings: number[] = [];
  const samplingSpacings: number[] = [];
  for (let i = 1; i < points; i++) {
    const d = cumulative[i] - cumulative[i - 1];
    if (!Number.isFinite(d)) continue;
    allSpacings.push(d);
    // Un intervalle qui enjambe une coupure déclarée n'est pas un pas
    // d'échantillonnage : il fausserait la lecture de la régularité.
    if (!breakAt.has(i)) samplingSpacings.push(d);
  }
  const spacingSample = samplingSpacings.length > 0 ? samplingSpacings : allSpacings;
  const medianSpacingM = spacingSample.length > 0 ? percentile(spacingSample, 0.5) : 0;
  const maxGapM = allSpacings.length > 0 ? Math.max(...allSpacings) : 0;

  const degenerate = points < 2 || lengthM < GPX_MIN_TRACE_LENGTH_M;
  if (points < GPX_MIN_POINTS || degenerate) flags.add("too_few_points");

  // Densité : un espacement médian court décrit les lacets, un espacement long
  // les gomme. Une trace sans étendue ne décrit rien du tout.
  const density = degenerate ? 0 : decreasingRamp(medianSpacingM, GPX_GOOD_SPACING_M, GPX_MAX_SPACING_M);
  if (!degenerate && medianSpacingM >= GPX_SPARSE_SPACING_M) flags.add("sparse");

  // Régularité : dispersion relative des espacements (écart interquartile
  // rapporté à la médiane). Trop faible = mécanique, trop forte = erratique.
  let spacingSpread: number | null = null;
  if (spacingSample.length >= GPX_REGULARITY_MIN_SPACINGS && medianSpacingM > 0) {
    const p25 = percentile(spacingSample, 0.25);
    const p75 = percentile(spacingSample, 0.75);
    spacingSpread = (p75 - p25) / medianSpacingM;
  }
  let spacingScore = GPX_NEUTRAL_UNKNOWN;
  if (spacingSpread !== null) {
    if (spacingSpread < GPX_NATURAL_SPREAD_MIN) spacingScore = clamp01(spacingSpread / GPX_NATURAL_SPREAD_MIN);
    else if (spacingSpread <= GPX_NATURAL_SPREAD_MAX) spacingScore = 1;
    else spacingScore = decreasingRamp(spacingSpread, GPX_NATURAL_SPREAD_MAX, GPX_IRREGULAR_SPREAD_MAX);
    if (spacingSpread >= GPX_IRREGULAR_SPREAD) flags.add("irregular_spacing");
  }

  /* --- Altitude et horodatage --------------------------------------- */

  const hasElevation = hasUsableElevation(elevations);
  if (!hasElevation) flags.add("no_elevation");

  const timeline = traceTimeline(times, reference);
  const hasTime = timeline !== null;
  if (!hasTime) flags.add("no_time");

  const cleaned =
    removedCount(trace.removed, "spike") +
    removedCount(trace.removed, "duplicate") +
    removedCount(trace.removed, "out_of_bounds") +
    removedCount(trace.removed, "null_island") +
    removedCount(trace.removed, "time_disorder");
  const totalObserved = points + cleaned;
  const disorderRatio = totalObserved > 0 ? removedCount(trace.removed, "time_disorder") / totalObserved : 0;
  const timeScore = hasTime ? clamp01(1 - disorderRatio / GPX_TIME_DISORDER_RATIO_FULL) : 0;

  /* --- Tracé à la main (section 9) ---------------------------------- */

  // Un relevé réel porte presque toujours au moins l'un des deux : une altitude
  // ou un horodatage. Leur absence *conjointe*, doublée d'un échantillonnage
  // mécanique ou beaucoup trop lâche, désigne un itinéraire dessiné sur une
  // carte. Le doute joue contre la trace : on la signale plutôt que de la
  // créditer d'une propreté qui n'a rien observé.
  const mechanicalSpacing = spacingSpread !== null && spacingSpread <= GPX_HAND_DRAWN_SPREAD_MAX;
  const tooCoarseForARecording = !degenerate && medianSpacingM >= GPX_HAND_DRAWN_SPACING_M;
  const handDrawn = !hasElevation && !hasTime && (mechanicalSpacing || tooCoarseForARecording);
  if (handDrawn) flags.add("hand_drawn");

  /* --- Continuité --------------------------------------------------- */

  const gapThresholdM = Math.max(GPX_GAP_M, medianSpacingM * GPX_GAP_SPACING_FACTOR);
  const declaredSegments = Number.isFinite(trace.segments) ? Math.max(1, Math.floor(trace.segments)) : 1;
  const breakCount = Math.max(breakAt.size, declaredSegments - 1);
  const hasWideGap = maxGapM > gapThresholdM;
  if (hasWideGap || breakCount > 0) flags.add("gaps");

  const gapPenalty = hasWideGap ? clamp01((maxGapM - gapThresholdM) / GPX_GAP_PENALTY_FULL_M) : 0;
  const breakPenalty = Math.min(GPX_BREAK_PENALTY_MAX, breakCount * GPX_BREAK_PENALTY);
  const continuity = degenerate ? 0 : clamp01(1 - gapPenalty - breakPenalty);

  /* --- Propreté du fichier ------------------------------------------ */

  // Coordonnée impossible et « île nulle » sont de la même famille que le saut
  // GPS : des points aberrants que la normalisation a dû écarter.
  const aberrant =
    removedCount(trace.removed, "spike") +
    removedCount(trace.removed, "out_of_bounds") +
    removedCount(trace.removed, "null_island");
  const duplicates = removedCount(trace.removed, "duplicate");
  const aberrantRatio = totalObserved > 0 ? aberrant / totalObserved : 0;
  const duplicateRatio = totalObserved > 0 ? duplicates / totalObserved : 0;
  if (aberrantRatio >= GPX_SPIKE_FLAG_RATIO && aberrant > 0) flags.add("spikes");
  if (duplicateRatio >= GPX_DUPLICATE_FLAG_RATIO && duplicates > 0) flags.add("duplicates");
  const cleanliness = clamp01(
    1 -
      GPX_CLEANLINESS_SPIKE_SHARE * clamp01(aberrantRatio / GPX_ABERRANT_RATIO_FULL) -
      (1 - GPX_CLEANLINESS_SPIKE_SHARE) * clamp01(duplicateRatio / GPX_DUPLICATE_RATIO_FULL),
  );

  /* --- Âge ---------------------------------------------------------- */

  const ageDays = timeline === null ? null : Math.max(0, (reference - timeline.startAt) / DAY_MS);
  if (ageDays !== null && ageDays >= GPX_STALE_DAYS) flags.add("stale");
  const freshness =
    ageDays === null ? GPX_NEUTRAL_UNKNOWN : decreasingRamp(ageDays, GPX_RECENT_DAYS, GPX_OBSOLETE_DAYS);

  /* --- Vitesse (seulement si la trace est horodatée) ---------------- */

  if (timeline !== null && times !== null && points >= 2) {
    const speeds: number[] = [];
    for (let i = 1; i < points; i++) {
      const t0 = times[i - 1];
      const t1 = times[i];
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
      const dtS = (t1 - t0) / 1000;
      if (!(dtS > 0)) continue;
      const d = cumulative[i] - cumulative[i - 1];
      if (!Number.isFinite(d) || d < 0) continue;
      speeds.push(d / dtS);
    }
    const durationS = (timeline.endAt - timeline.startAt) / 1000;
    const averageMs = durationS > 0 ? lengthM / durationS : 0;
    const peak = speeds.length >= GPX_SPEED_MIN_SAMPLES ? percentile(speeds, GPX_SPEED_PERCENTILE) : 0;
    if (peak > GPX_MAX_PLAUSIBLE_SPEED_MS || averageMs > GPX_MAX_PLAUSIBLE_AVERAGE_SPEED_MS) {
      flags.add("implausible_speed");
    }
  }

  /* --- Recouvrement sur elle-même ----------------------------------- */

  if (selfOverlapRatio(line, cumulative) >= GPX_SELF_OVERLAP_RATIO) flags.add("self_overlap");

  /* --- Score -------------------------------------------------------- */

  const criteria: Record<GpxQualityCriterion, number> = {
    density: clamp01(density),
    spacing: clamp01(spacingScore),
    elevation: hasElevation ? 1 : 0,
    time: clamp01(timeScore),
    continuity: clamp01(continuity),
    cleanliness: clamp01(cleanliness),
    freshness: clamp01(freshness),
    agreement: clamp01(agreementScore(context)),
  };
  let score = 0;
  for (const key of GPX_QUALITY_CRITERIA) score += GPX_QUALITY_WEIGHTS[key] * criteria[key];
  score *= 100;
  for (const flag of flags) {
    const cap = GPX_QUALITY_SCORE_CAPS[flag];
    if (cap !== undefined && score > cap) score = cap;
  }
  // Une trace sans géométrie mesurable ne se note pas : les rares critères
  // encore lisibles (propreté du fichier, date) ne doivent pas lui composer un
  // score de façade.
  if (degenerate) score = GPX_NO_GEOMETRY_SCORE;
  score = round(Math.min(100, Math.max(0, score)), 1);

  const ordered = orderedFlags([...flags]);
  const blocked = ordered.some((f) => GPX_BLOCKING_FLAGS.includes(f));

  return {
    score,
    level: gpxQualityLevel(score),
    points,
    medianSpacingM: round(medianSpacingM, 1),
    maxGapM: round(maxGapM, 1),
    hasElevation,
    hasTime,
    ageDays: ageDays === null ? null : round(ageDays, 1),
    flags: ordered,
    usable: !blocked && score >= MIN_USABLE_QUALITY_SCORE,
    summary: buildSummary(points, medianSpacingM, hasElevation, timeline === null ? null : timeline.startAt, handDrawn),
  };
}

/* ------------------------------------------------------------------ */
/* 9. Explication et tri                                               */
/* ------------------------------------------------------------------ */

/**
 * Phrase expliquant ce qui a fait perdre des points, pour la bibliothèque du
 * back-office : « Bonne (72/100) : aucune altitude, trace interrompue. »
 *
 * Les défauts purement informatifs (`GPX_INFORMATIVE_FLAGS`) sont rejetés dans
 * une clause « À noter », parce qu'ils n'ont rien coûté au score : un
 * aller-retour n'est pas une faute, c'est une trace à découper.
 */
export function describeGpxQuality(report: GpxQualityReport): string {
  const score = Number.isFinite(report.score) ? Math.round(report.score) : 0;
  const label = GPX_QUALITY_LEVEL_LABELS[report.level] ?? GPX_QUALITY_LEVEL_LABELS[gpxQualityLevel(report.score)];
  const flags = orderedFlags(report.flags);
  const costly = flags.filter((f) => !GPX_INFORMATIVE_FLAGS.includes(f));
  const notes = flags.filter((f) => GPX_INFORMATIVE_FLAGS.includes(f));

  const body = costly.length === 0 ? GPX_NO_DEFECT_LABEL : costly.map((f) => GPX_FLAG_REASONS[f]).join(", ");
  let out = `${label} (${score}/100) : ${body}.`;
  if (notes.length > 0) out += ` À noter : ${notes.map((f) => GPX_FLAG_REASONS[f]).join(", ")}.`;
  if (!report.usable) out += ` ${GPX_UNUSABLE_NOTICE}`;
  return out;
}

/** Valeur numérique exploitable, ou la valeur de repli fournie. */
function orderValue(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Comparaison lexicographique simple, sans dépendre de la locale d'exécution. */
function compareText(a: string, b: string): number {
  const x = typeof a === "string" ? a : "";
  const y = typeof b === "string" ? b : "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Comparateur de tri : meilleure trace d'abord, utilisable tel quel dans un
 * `sort`.
 *
 * L'exploitabilité prime sur le score (une trace écartée ne remonte jamais
 * au-dessus d'une trace retenue), puis viennent le score, la densité de points,
 * la finesse d'échantillonnage, la continuité, la richesse (altitude,
 * horodatage) et la fraîcheur. Les derniers critères — nombre de drapeaux,
 * drapeaux, résumé — n'ont aucun sens produit : ils sont là pour que l'ordre
 * soit *total* et donc reproductible, deux rapports par ailleurs identiques ne
 * devant jamais dépendre de l'ordre d'entrée. Les valeurs illisibles (score
 * `NaN`, âge absent) sont reléguées en fin de tri plutôt que de perturber la
 * comparaison.
 */
export function compareQuality(a: GpxQualityReport, b: GpxQualityReport): number {
  const order =
    (a.usable === b.usable ? 0 : a.usable ? -1 : 1) ||
    orderValue(b.score, Number.NEGATIVE_INFINITY) - orderValue(a.score, Number.NEGATIVE_INFINITY) ||
    orderValue(b.points, Number.NEGATIVE_INFINITY) - orderValue(a.points, Number.NEGATIVE_INFINITY) ||
    orderValue(a.medianSpacingM, Number.POSITIVE_INFINITY) - orderValue(b.medianSpacingM, Number.POSITIVE_INFINITY) ||
    orderValue(a.maxGapM, Number.POSITIVE_INFINITY) - orderValue(b.maxGapM, Number.POSITIVE_INFINITY) ||
    (a.hasElevation === b.hasElevation ? 0 : a.hasElevation ? -1 : 1) ||
    (a.hasTime === b.hasTime ? 0 : a.hasTime ? -1 : 1) ||
    orderValue(a.ageDays, Number.POSITIVE_INFINITY) - orderValue(b.ageDays, Number.POSITIVE_INFINITY) ||
    orderedFlags(a.flags).length - orderedFlags(b.flags).length ||
    compareText(orderedFlags(a.flags).join("|"), orderedFlags(b.flags).join("|")) ||
    compareText(a.summary, b.summary);
  // Un écart infini ou illisible ne doit jamais ressortir tel quel d'un
  // comparateur : seul le signe compte.
  return order < 0 ? -1 : order > 0 ? 1 : 0;
}
