/**
 * « Randonnées autour de vous » : le calcul pur de l'écran d'accueil.
 *
 * L'utilisateur ouvre l'application, se voit sur la carte, et trouve
 * immédiatement sous la barre « Où va-t-on ? » les randonnées les plus proches
 * de lui. C'est ce qui remplace les raccourcis « Domicile / Travail » de Waze :
 * on ne cherche pas une randonnée, elle vient à vous (sections 34 et 35).
 *
 * Sections du cahier des charges couvertes ici :
 *
 *  - **13. Classer la liste.** `rankNearby` applique les cinq critères
 *    (`closest`, `popular`, `easiest`, `shortest`, `quietest`) avec un ordre
 *    *total* : le départage final par approche puis par identifiant rend le
 *    résultat indépendant de l'ordre d'arrivée des itinéraires.
 *  - **18. Rayon adaptatif.** `selectRadius` part du plus petit rayon et
 *    n'élargit que si les résultats sont trop rares. Chercher large d'emblée
 *    noierait une vallée dense sous des départs à 40 km.
 *  - **19. Deux distances, jamais confondues.** `describeApproach` et
 *    `describeLength` produisent deux phrases volontairement dissemblables
 *    (« À 4,2 km de vous » / « Randonnée de 9,4 km ») : si un jour le code les
 *    confondait, cela se verrait à l'écran avant de tromper quiconque.
 *  - **20. Dire ce qui est signalé.** `reportHint` résume les signalements
 *    actifs d'un itinéraire en une phrase courte, tirée de la taxonomie et
 *    jamais inventée.
 *  - **21. Le silence n'est pas une absence.** Une fréquentation inconnue
 *    (`null` comme `"unknown"`) ne passe jamais pour « calme » : elle ne prend
 *    jamais la tête du classement `quietest`. Et `nearbyNote` dit que la carte
 *    du secteur reste à enrichir plutôt que de laisser croire qu'il n'y a rien
 *    à y marcher.
 *  - **37. Forme du tracé et point de départ.** `trailShape` distingue boucle,
 *    aller-retour et itinéraire linéaire — la distinction change la lecture de
 *    la distance annoncée. `nearestTrailhead` retient, des deux extrémités, le
 *    départ le plus proche de l'utilisateur.
 *
 * Module pur : aucun accès base, réseau, disque ou DOM, aucun aléa, aucune
 * horloge implicite, aucune mutation des entrées (`rankNearby` renvoie un
 * nouveau tableau). C'est l'appelant qui sait interroger la base : `selectRadius`
 * reçoit son compteur en paramètre et ne l'appelle **qu'une fois par rayon**.
 * Coût : linéaire sur les points d'un tracé, plus un échantillonnage borné
 * (`RETRACE_MAX_SAMPLES`) pour la détection d'aller-retour, et un tri pour le
 * classement — jamais de comparaison deux à deux des itinéraires.
 */
import {
  distanceToPolylineM,
  formatDistance,
  haversineM,
  isValidLatLng,
  polylineLengthM,
  type LngLat,
} from "../geo";
import { cumulativeDistances, pointAtAlong, sliceAlong } from "../navigation/geometry";
import type { FrequentationLevel } from "../network/types";
import { SUBTYPE_BY_ID, isSubtype } from "../taxonomy";
import type { LatLng, ReportSubtype } from "../types";
import {
  LOOP_TOLERANCE_M,
  NEARBY_MIN_RESULTS,
  NEARBY_RADII_M,
  type NearbySort,
  type NearbyTrail,
  type TrailDifficulty,
  type TrailShape,
  type Trailhead,
} from "./types";

/* ------------------------------------------------------------------ */
/* 1. Réglages (seuils documentés, pas des nombres perdus)             */
/* ------------------------------------------------------------------ */

/**
 * Longueur (m) en dessous de laquelle un tracé n'a pas de forme lisible.
 *
 * Deux fois `LOOP_TOLERANCE_M`. En dessous, aucun des deux tests ne prouve
 * quoi que ce soit : les extrémités sont forcément à moins de la tolérance
 * l'une de l'autre quelle que soit la forme (toute géométrie tronquée de 80 m
 * serait « boucle »), et les deux moitiés du tracé sont à moins de
 * `RETRACE_TOLERANCE_M` l'une de l'autre (toute ligne droite de 80 m serait
 * « aller-retour »). Ces tracés sont rendus `linear`, la forme qui ne promet
 * rien à l'utilisateur.
 */
export const SHAPE_MIN_LENGTH_M = 2 * LOOP_TOLERANCE_M;

/**
 * Écart (m) sous lequel le retour est jugé suivre l'aller. Quarante mètres :
 * l'ordre de grandeur de la dérive GPS entre deux passages sur le même sentier,
 * sous le couvert ou en dévers, sans confondre deux sentiers parallèles
 * distincts de part et d'autre d'un vallon.
 */
export const RETRACE_TOLERANCE_M = 40;

/** Pas (m) d'échantillonnage de la première moitié du tracé. */
export const RETRACE_SAMPLE_M = 50;

/** Nombre minimal d'échantillons : un tracé court reste testé sérieusement. */
export const RETRACE_MIN_SAMPLES = 8;

/** Nombre maximal d'échantillons : borne le coût sur un très long tracé. */
export const RETRACE_MAX_SAMPLES = 200;

/**
 * Part des échantillons de l'aller devant être retrouvés sur le retour pour
 * conclure à un aller-retour. 0,8 laisse passer la variante du sommet (on
 * boucle les derniers hectomètres avant de redescendre par le même chemin),
 * qui reste un aller-retour pour le marcheur.
 */
export const RETRACE_MATCH_RATIO = 0.8;

/** Ordre des difficultés, du plus facile au plus exigeant (tri `easiest`). */
export const DIFFICULTY_ORDER: Record<TrailDifficulty, number> = {
  easy: 0,
  moderate: 1,
  hard: 2,
  expert: 3,
};

/** Rang d'une difficulté non reconnue : après toutes les autres. */
export const UNKNOWN_DIFFICULTY_RANK = 4;

/**
 * Rang d'une fréquentation inconnue dans le tri `quietest` : **après** la plus
 * fréquentée. Règle non négociable de la section 21 — « on ne sait pas » n'est
 * pas « personne n'y va ». Mettre un itinéraire sans données en tête d'un
 * classement « les plus calmes » serait inventer une information, et envoyer
 * quelqu'un chercher la solitude là où passe peut-être tout le massif.
 */
export const UNKNOWN_QUIET_RANK = 5;

/** Ordre des niveaux de fréquentation, du plus calme au plus fréquenté. */
export const QUIET_ORDER: Record<FrequentationLevel, number> = {
  very_low: 0,
  low: 1,
  moderate: 2,
  high: 3,
  very_high: 4,
  unknown: UNKNOWN_QUIET_RANK,
};

/** Phrase affichée quand la distance à l'utilisateur n'est pas mesurable. */
export const APPROACH_UNKNOWN_LABEL = "Distance inconnue";

/** Phrase affichée quand la longueur de la randonnée n'est pas mesurable. */
export const LENGTH_UNKNOWN_LABEL = "Longueur inconnue";

/**
 * Fin de phrase des notes de rareté : le secteur est peut-être riche en
 * sentiers, c'est *notre carte* qui est pauvre. La nuance évite de décourager
 * un utilisateur d'une vallée encore peu couverte.
 */
export const NEARBY_ENRICH_SUFFIX = "la carte de ce secteur reste à enrichir.";

/**
 * Accord de « signalé » pour chaque sous-type (section 20) : « Battue
 * signalée », « Chiens de protection signalés », « Éboulement signalé ».
 *
 * Les libellés viennent tels quels de `taxonomy.ts` — rien n'est réécrit ici ;
 * seule l'accord grammatical est ajouté. Le type `Record` complet force à
 * trancher l'accord de tout nouveau sous-type : la compilation le rappellera.
 */
export const REPORT_HINT_AGREEMENT: Record<ReportSubtype, "" | "e" | "s" | "es"> = {
  // Danger
  rockfall: "",
  fallen_tree: "",
  collapsed_path: "",
  dangerous_passage: "",
  flood: "e",
  snow: "",
  ice: "",
  fire: "",
  other_danger: "",
  // Chemin / accessibilité
  path_closed: "",
  path_impassable: "",
  works: "s",
  path_cluttered: "",
  signage_issue: "",
  poor_condition: "",
  obstacle: "",
  access_restriction: "e",
  no_signal: "e",
  // Chasse / activités
  hunting: "e",
  battue: "e",
  zone_occupied: "e",
  forestry_works: "s",
  sport_event: "",
  pastoral_activity: "e",
  // Animaux
  herd: "",
  guard_dogs: "s",
  cattle: "s",
  horses: "s",
  wildlife: "s",
  boars: "s",
  injured_animal: "",
  aggressive_animal: "",
  other_animal: "e",
  // Eau / ressources
  spring: "e",
  fountain: "e",
  water_point: "",
  spring_dry: "e",
  spring_active: "e",
  refuge: "",
  shelter: "",
  // Fréquentation / usagers
  many_hikers: "e",
  riders: "",
  mtb: "",
  vehicles: "s",
  busy_area: "e",
  quiet_area: "e",
};

/* ------------------------------------------------------------------ */
/* 2. Outils internes                                                  */
/* ------------------------------------------------------------------ */

/** Sommet d'une polyligne `[lng, lat]` en `{ lat, lng }`. */
function vertex(line: readonly LngLat[], index: number): LatLng {
  return { lat: line[index][1], lng: line[index][0] };
}

/**
 * Ne garde que les sommets exploitables. Un `NaN` glissé dans une géométrie
 * importée contaminerait toutes les distances : il vaut mieux l'ignorer que
 * produire une approche « NaN m » ou une forme au hasard.
 */
function cleanLine(coordinates: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const c of coordinates) {
    if (isValidLatLng({ lat: c[1], lng: c[0] })) out.push([c[0], c[1]]);
  }
  return out;
}

/** Comparaison croissante où une valeur non mesurable passe toujours après. */
function ascending(a: number, b: number): number {
  const okA = Number.isFinite(a);
  const okB = Number.isFinite(b);
  if (!okA && !okB) return 0;
  if (!okA) return 1;
  if (!okB) return -1;
  return a - b;
}

/** Comparaison décroissante où une valeur non mesurable passe toujours après. */
function descending(a: number | null, b: number | null): number {
  // `null` (« on ne sait pas ») et les valeurs illisibles partent en fin de
  // classement : un itinéraire dont la popularité est inconnue ne doit pas
  // passer pour populaire, ni pour impopulaire.
  const okA = a !== null && Number.isFinite(a);
  const okB = b !== null && Number.isFinite(b);
  if (!okA && !okB) return 0;
  if (!okA) return 1;
  if (!okB) return -1;
  return (b as number) - (a as number);
}

/**
 * Ordre des identifiants par point de code, et non `localeCompare` : le
 * résultat doit être le même sur le téléphone d'un utilisateur, sur le serveur
 * et dans les tests, quelle que soit la locale installée.
 */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* 3. Forme du tracé et point de départ (section 37)                   */
/* ------------------------------------------------------------------ */

/**
 * Le retour suit-il l'aller ?
 *
 * La seconde moitié du tracé est isolée, puis la première moitié est
 * échantillonnée : chaque échantillon est jugé retrouvé si la seconde moitié
 * passe à moins de `RETRACE_TOLERANCE_M`. On mesure la distance *à la
 * polyligne*, et non au point d'abscisse symétrique : on marche rarement au
 * même rythme à la montée et à la descente, et deux relevés du même sentier ne
 * partagent ni le même pas d'échantillonnage ni les mêmes pauses.
 */
function retracesItself(line: readonly LngLat[], totalM: number): boolean {
  const cumulative = cumulativeDistances(line);
  const halfM = totalM / 2;
  const back = sliceAlong(line, cumulative, halfM, totalM);
  if (back.length < 2) return false;

  const samples = Math.min(
    RETRACE_MAX_SAMPLES,
    Math.max(RETRACE_MIN_SAMPLES, Math.round(halfM / RETRACE_SAMPLE_M)),
  );
  let matched = 0;
  for (let i = 0; i < samples; i++) {
    // Échantillons au milieu de leur intervalle : ni le tout premier point du
    // tracé ni le point de demi-tour, qui appartiennent aux deux moitiés et
    // vaudraient un appariement gratuit.
    const along = ((i + 0.5) / samples) * halfM;
    if (distanceToPolylineM(pointAtAlong(line, cumulative, along), back) <= RETRACE_TOLERANCE_M) {
      matched += 1;
    }
  }
  return matched / samples >= RETRACE_MATCH_RATIO;
}

/**
 * Forme d'un itinéraire (section 37) : boucle, aller-retour, ou linéaire.
 *
 * La distinction change la lecture de la distance annoncée. « 12 km » sur un
 * aller-retour, c'est 6 km de montée ; sur une boucle, ce sont 12 km à
 * enchaîner sans jamais repasser au même endroit ; sur un itinéraire linéaire,
 * c'est 12 km **et il faut revenir ou se faire récupérer**.
 *
 * L'ordre des tests compte : un aller-retour referme lui aussi son tracé (on
 * revient à la voiture). Tester la boucle en premier ferait passer tous les
 * aller-retours pour des boucles. Un tracé trop court, vide ou inexploitable
 * est rendu `linear` : c'est la forme qui ne promet rien.
 */
export function trailShape(coordinates: readonly LngLat[]): TrailShape {
  const line = cleanLine(coordinates);
  if (line.length < 2) return "linear";
  const totalM = polylineLengthM(line);
  if (!Number.isFinite(totalM) || totalM < SHAPE_MIN_LENGTH_M) return "linear";
  if (retracesItself(line, totalM)) return "out_and_back";
  const gapM = haversineM(vertex(line, 0), vertex(line, line.length - 1));
  return gapM <= LOOP_TOLERANCE_M ? "loop" : "linear";
}

/**
 * Départ à proposer pour un itinéraire (section 37) : « s'il existe plusieurs
 * points de départ, afficher celui qui est le plus proche ».
 *
 * Un tracé a deux extrémités ; celle qui est à 800 m du village où se trouve
 * l'utilisateur vaut mieux que celle qui est à 14 km par la route de l'autre
 * versant. `distanceM` est l'approche à vol d'oiseau, arrondie au mètre — la
 * précision inférieure n'est que du bruit pour une distance de ce genre.
 *
 * `null` sur une géométrie inexploitable (vide, ou sans un seul sommet valide)
 * et sur une position utilisateur invalide : mieux vaut pas de départ qu'un
 * départ inventé. Un tracé réduit à un seul point garde en revanche un départ :
 * ce point est bel et bien un lieu où se rendre.
 */
export function nearestTrailhead(user: LatLng, coordinates: readonly LngLat[]): Trailhead | null {
  if (!isValidLatLng(user)) return null;
  const line = cleanLine(coordinates);
  if (line.length === 0) return null;

  const start = vertex(line, 0);
  const finish = vertex(line, line.length - 1);
  const startM = haversineM(user, start);
  const finishM = haversineM(user, finish);
  // À égalité stricte, le début du tracé gagne : le sens de lecture de la
  // géométrie tranche, et le résultat reste le même d'un appel à l'autre.
  return finishM < startM
    ? { point: finish, distanceM: Math.round(finishM), end: "finish" }
    : { point: start, distanceM: Math.round(startM), end: "start" };
}

/* ------------------------------------------------------------------ */
/* 4. Rayon adaptatif (section 18)                                     */
/* ------------------------------------------------------------------ */

/** Réglages de la recherche adaptative. */
export interface SelectRadiusOptions {
  /** Rayons successifs (m), croissants. Défaut : `NEARBY_RADII_M`. */
  radii?: readonly number[];
  /** En dessous de ce nombre de résultats, on élargit. Défaut : `NEARBY_MIN_RESULTS`. */
  minResults?: number;
}

/** Rayon retenu par la recherche adaptative, et s'il a fallu l'élargir. */
export interface RadiusSelection {
  radiusM: number;
  widened: boolean;
}

/** Rayons exploitables, croissants et dédoublonnés ; vide → rayons par défaut. */
function sanitizeRadii(radii: readonly number[] | undefined): number[] {
  const source = radii ?? NEARBY_RADII_M;
  const kept: number[] = [];
  for (const r of source) {
    if (Number.isFinite(r) && r > 0 && !kept.includes(r)) kept.push(r);
  }
  kept.sort((a, b) => a - b);
  return kept.length > 0 ? kept : [...NEARBY_RADII_M];
}

/**
 * Rayon de recherche adaptatif (section 18) : on part du plus petit, on
 * n'élargit que si les résultats sont trop rares.
 *
 * `countAt` est fourni par l'appelant — c'est lui qui sait interroger la base.
 * Il est appelé **une fois par rayon essayé, au plus**, et la recherche
 * s'arrête au premier rayon suffisant : sur une vallée dense, une seule
 * requête à 10 km.
 *
 * Le dernier rayon est retenu même s'il ne suffit pas : trois résultats à 50 km
 * valent mieux qu'un écran vide, à condition de le dire (`nearbyNote`). Un
 * comptage non exploitable est traité comme zéro résultat : on élargit plutôt
 * que de conclure sur une valeur qu'on ne comprend pas.
 */
export function selectRadius(
  countAt: (radiusM: number) => number,
  opts: SelectRadiusOptions = {},
): RadiusSelection {
  const radii = sanitizeRadii(opts.radii);
  const minResults =
    opts.minResults !== undefined && Number.isFinite(opts.minResults) && opts.minResults >= 0
      ? Math.floor(opts.minResults)
      : NEARBY_MIN_RESULTS;

  for (let i = 0; i < radii.length; i++) {
    const found = countAt(radii[i]);
    const count = Number.isFinite(found) && found > 0 ? found : 0;
    if (count >= minResults) return { radiusM: radii[i], widened: i > 0 };
  }
  // Aucun rayon ne suffit : on garde le plus large essayé. `widened` ne vaut
  // vrai que si l'on a réellement élargi, c'est-à-dire s'il y avait un rayon
  // plus petit avant celui-ci.
  return { radiusM: radii[radii.length - 1], widened: radii.length > 1 };
}

/* ------------------------------------------------------------------ */
/* 5. Classement de la liste (section 13)                              */
/* ------------------------------------------------------------------ */

/** Rang de difficulté, une valeur non reconnue passant après les autres. */
function difficultyRank(difficulty: TrailDifficulty): number {
  const rank = DIFFICULTY_ORDER[difficulty];
  return Number.isFinite(rank) ? rank : UNKNOWN_DIFFICULTY_RANK;
}

/**
 * Rang de fréquentation pour le tri « les plus calmes ». `null` et `"unknown"`
 * disent la même chose — nous ne savons pas — et reçoivent donc le même rang,
 * le dernier (section 21).
 */
function quietRank(frequentation: FrequentationLevel | null): number {
  if (frequentation === null) return UNKNOWN_QUIET_RANK;
  const rank = QUIET_ORDER[frequentation];
  return Number.isFinite(rank) ? rank : UNKNOWN_QUIET_RANK;
}

type TrailComparator = (a: NearbyTrail, b: NearbyTrail) => number;

/**
 * Critère principal de chaque tri. Le départage commun (approche puis
 * identifiant) est ajouté par `rankNearby` : il n'a pas à être répété ici.
 */
const SORT_COMPARATORS: Record<NearbySort, TrailComparator> = {
  /** Défaut : le départ le plus proche de moi d'abord. */
  closest: (a, b) => ascending(a.approachM, b.approachM),
  /** Les plus parcourus d'abord. */
  popular: (a, b) => descending(a.popularityScore, b.popularityScore),
  /** Difficulté, puis dénivelé, puis longueur : trois façons d'être « facile ». */
  easiest: (a, b) =>
    difficultyRank(a.difficulty) - difficultyRank(b.difficulty) ||
    ascending(a.elevationGainM, b.elevationGainM) ||
    ascending(a.lengthM, b.lengthM),
  /** LONGUEUR de la randonnée, surtout pas l'approche (section 19). */
  shortest: (a, b) => ascending(a.lengthM, b.lengthM),
  /** Fréquentation croissante ; ce qu'on ne sait pas ne passe pas pour calme. */
  quietest: (a, b) => quietRank(a.frequentation) - quietRank(b.frequentation),
};

/**
 * Classe les itinéraires de l'écran d'accueil (section 13).
 *
 * Le tri est **stable et déterministe** : à critère principal égal, c'est
 * l'approche qui départage, puis l'identifiant. Deux conséquences voulues —
 * l'ordre affiché ne dépend jamais de l'ordre dans lequel la base a rendu ses
 * lignes, et deux chargements successifs du même écran donnent exactement la
 * même liste. Une liste qui se réordonne toute seule d'un affichage à l'autre
 * donne l'impression d'une application qui hésite.
 *
 * Le tableau d'entrée n'est jamais modifié ; un nouveau tableau est renvoyé.
 * Aucun itinéraire n'est écarté : filtrer est le travail de l'appelant.
 */
/**
 * Rang de confiance dans la donnée : plus c'est petit, plus on l'affiche haut.
 *
 *   0  navigable    — relevé, détaillé, rattaché au réseau
 *   1  affichable   — relevé mais incomplètement rattaché
 *   2  reste        — démonstration, provenance inconnue, tracé schématique
 *
 * Ce rang PRIME sur le critère de tri demandé : une randonnée de démonstration
 * n'est jamais « la plus proche » devant une vraie, sinon la liste ferait
 * passer le jeu de test pour du terrain (section 29).
 */
function dataRank(trail: NearbyTrail): number {
  if (trail.navigable) return 0;
  if (trail.drawable) return 1;
  return 2;
}

export function rankNearby(trails: readonly NearbyTrail[], sort: NearbySort): NearbyTrail[] {
  const primary = SORT_COMPARATORS[sort] ?? SORT_COMPARATORS.closest;
  const ranked = trails.slice();
  ranked.sort(
    (a, b) => ascending(dataRank(a), dataRank(b)) || primary(a, b) || ascending(a.approachM, b.approachM) || compareIds(a.id, b.id),
  );
  return ranked;
}

/* ------------------------------------------------------------------ */
/* 6. Formulations (sections 19, 20, 21)                               */
/* ------------------------------------------------------------------ */

/**
 * DISTANCE 1 — de vous au départ : « À 4,2 km de vous ».
 *
 * Volontairement dissemblable de `describeLength` : la phrase nomme *vous*, pas
 * la randonnée. Si les deux champs venaient à être inversés quelque part, la
 * carte afficherait « À 9,4 km de vous / Randonnée de 4,2 km » et l'erreur
 * sauterait aux yeux avant d'envoyer quelqu'un au mauvais endroit.
 *
 * Une distance non mesurable ne devient pas « 0 m » : elle se dit inconnue.
 */
export function describeApproach(m: number): string {
  if (!Number.isFinite(m) || m < 0) return APPROACH_UNKNOWN_LABEL;
  return `À ${formatDistance(m)} de vous`;
}

/**
 * DISTANCE 2 — longueur de la randonnée : « Randonnée de 9,4 km ».
 *
 * Une longueur nulle ou négative est traitée comme inconnue : une randonnée de
 * zéro mètre n'existe pas, c'est une géométrie manquante — le dire vaut mieux
 * que d'afficher « Randonnée de 0 m ». Sur un aller-retour, cette longueur
 * compte les deux sens : c'est `trailShape` qui permet à l'écran de le
 * préciser (section 37).
 */
export function describeLength(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return LENGTH_UNKNOWN_LABEL;
  return `Randonnée de ${formatDistance(m)}`;
}

/**
 * Phrase affichée sous la liste quand il y a peu ou pas de résultats, `null`
 * quand tout va bien (section 21).
 *
 * Trois choses à ne jamais laisser croire : qu'il n'y a rien à marcher ici (la
 * carte est incomplète, le massif ne l'est pas), que l'application n'a pas
 * cherché, et que des départs à 50 km sont normalement proches — un
 * élargissement se dit.
 */
export function nearbyNote(count: number, radiusM: number, widened: boolean): string | null {
  const found = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const radius = Number.isFinite(radiusM) && radiusM > 0 ? formatDistance(radiusM) : null;
  const within = radius === null ? "ici" : `dans un rayon de ${radius}`;

  if (found === 0) return `Aucun itinéraire connu ${within} — ${NEARBY_ENRICH_SUFFIX}`;
  if (widened) {
    const upTo = radius === null ? "" : ` à ${radius}`;
    return `Peu d'itinéraires à proximité : la recherche a été élargie${upTo}.`;
  }
  if (found < NEARBY_MIN_RESULTS) {
    const plural = found > 1 ? "s" : "";
    return `Seulement ${found} itinéraire${plural} connu${plural} ${within} — ${NEARBY_ENRICH_SUFFIX}`;
  }
  return null;
}

/** Signalement tel que l'appelant le passe à `reportHint` (déjà filtré actif). */
export interface ReportHintInput {
  subtype?: string | null;
  category: string;
}

/**
 * Alerte courte tirée des signalements actifs d'un itinéraire (section 20) :
 * « Battue signalée », « Chiens de protection signalés », « 2 signalements ».
 *
 * Deux règles :
 *
 *  - **Un seul genre de signalement : on le nomme.** Le libellé vient de la
 *    taxonomie (`SUBTYPE_BY_ID`), jamais d'une formule inventée ici, et reçoit
 *    son accord (`REPORT_HINT_AGREEMENT`). Trois battues sur le même itinéraire
 *    restent « Battue signalée » : c'est l'information utile, pas le décompte.
 *  - **Plusieurs genres : on compte.** Mettre l'un d'eux en avant serait un
 *    arbitrage (le troupeau ou l'arbre tombé ?) que cette phrase de trois mots
 *    ne peut pas porter honnêtement. La carte, elle, les montre tous.
 *
 * Un sous-type inconnu (base plus récente que ce code, ou champ absent) est
 * compté sans être nommé : « 1 signalement ». `null` s'il n'y a rien à dire —
 * et jamais « aucun signalement », qui laisserait croire que l'itinéraire a été
 * vérifié.
 */
export function reportHint(reports: readonly ReportHintInput[]): string | null {
  if (reports.length === 0) return null;

  const kinds = new Set<string>();
  let named: ReportSubtype | null = null;
  for (const report of reports) {
    const subtype =
      typeof report.subtype === "string" && isSubtype(report.subtype) ? report.subtype : null;
    if (subtype === null) {
      // Sans sous-type reconnu, la catégorie sert encore à regrouper.
      kinds.add(`categorie:${report.category}`);
    } else {
      kinds.add(`sous-type:${subtype}`);
      named = subtype;
    }
  }

  if (kinds.size === 1 && named !== null) {
    return `${SUBTYPE_BY_ID[named].label} signalé${REPORT_HINT_AGREEMENT[named]}`;
  }
  return `${reports.length} signalement${reports.length > 1 ? "s" : ""}`;
}
