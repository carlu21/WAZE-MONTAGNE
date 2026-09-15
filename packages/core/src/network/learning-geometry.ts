/**
 * Apprentissage de la géométrie collective : ce que les traces disent du
 * terrain quand la carte se tait, se trompe, ou ne connaît pas encore le
 * chemin que tout le monde emprunte.
 *
 * Sections du cahier des charges « moteur cartographique » couvertes ici :
 *
 *  - **17. Géométrie imprécise** : une carte officielle peut placer un sentier
 *    à quelques mètres de sa position réelle. Quand cent passages sortent tous
 *    du même côté du tracé, ce n'est plus du bruit GPS, c'est une information.
 *    `geometryCandidate` la formule — et rien de plus : la carte officielle
 *    n'est **jamais** corrigée automatiquement, la fonction produit une
 *    *candidature* soumise à validation humaine.
 *  - **18. Reconstruction collective** : `communityCenterline` recale tout un
 *    faisceau de traces sur une abscisse commune et calcule, à chaque pas, la
 *    position centrale *robuste*. Aucune trace n'est « la bonne » ; chacune est
 *    une mesure bruitée du même passage, et seules les observations de
 *    précision suffisante entrent dans le calcul.
 *  - **19. Nouveaux chemins** : `detectPotentialTrails` regroupe les portions
 *    hors réseau qui suivent le même corridor, et n'en fait un chemin potentiel
 *    que lorsque le corridor est *collectif* et *durable*.
 *  - **20. Éviter les faux chemins** : une personne qui se perd, un troupeau de
 *    passages du même jour, un raccourci de trente mètres ne créent jamais un
 *    chemin. Les seuils (passages, utilisateurs distincts, longueur, étalement
 *    dans le temps) sont là pour ça, et ils sont tous des réglages exportés.
 *  - **21. Variantes** : `detectVariants` dit, entre deux mêmes points, quels
 *    itinéraires sont *réellement* empruntés et dans quelles proportions.
 *
 * Module pur et déterministe : aucune horloge implicite (la seule notion de
 * « maintenant » est le paramètre `now` de `detectPotentialTrails`, de défaut
 * explicite `Date.now()`), aucun aléa, aucune mutation des entrées.
 *
 * Coût : toutes les comparaisons géométriques passent par un index de grille
 * (`buildLineIndex`) construit une fois par ligne. Le recalage d'une trace sur
 * la référence est linéaire en nombre de points, et les portions hors réseau ne
 * sont comparées deux à deux qu'après un filtre spatial par cellule — jamais
 * « toutes contre toutes ».
 */
import {
  METERS_PER_DEG_LAT,
  bearing,
  haversineM,
  hashString,
  offsetPoint,
  pointsAlongLine,
  polylineLengthM,
  snapToGrid,
  type LngLat,
} from "../geo";
import { bearingBetweenAlong, cumulativeDistances, pointAtAlong, simplifyPoints } from "../navigation/geometry";
import type { ActivityMode, PathSegment } from "../navigation/types";
import type { LatLng } from "../types";
import { durationStats, freshnessWeight, percentile } from "./statistics";
import {
  K_ANONYMITY_MIN,
  type Centerline,
  type CorridorTrace,
  type GeometryCandidate,
  type OffNetworkRun,
  type PathObservation,
  type PotentialTrail,
  type RouteVariant,
} from "./types";

/* ------------------------------------------------------------------ */
/* 0. Réglages produit (seuils documentés, pas des nombres perdus)     */
/* ------------------------------------------------------------------ */

/** Un jour en millisecondes. */
const DAY = 86_400_000;

/** Pas d'échantillonnage de la ligne centrale (m) : ~1 point tous les 10 m. */
export const DEFAULT_CENTERLINE_STEP_M = 10;

/** Traces distinctes minimales pour qu'une ligne centrale ait un sens. */
export const DEFAULT_MIN_TRACES = 3;

/**
 * Précision GPS (m) au-delà de laquelle un point est écarté (section 18 :
 * « utiliser uniquement les observations avec une précision suffisante »).
 * 20 m correspond au seuil au-delà duquel l'incertitude dépasse la largeur du
 * corridor qu'on cherche à mesurer : le point n'apporte plus d'information.
 */
export const DEFAULT_MAX_ACCURACY_M = 20;

/** Part écartée de chaque côté par la moyenne tronquée (10 %). */
export const DEFAULT_TRIM_QUANTILE = 0.1;

/**
 * Sous ce nombre d'échantillons, tronquer 10 % de chaque côté ne retire plus
 * rien d'utile : on bascule sur la médiane pondérée, strictement plus robuste.
 * Au-delà, la moyenne tronquée lisse mieux (elle utilise toute la masse
 * centrale au lieu d'un seul point).
 */
export const TRIM_MIN_SAMPLES = 8;

/**
 * Précision supposée (m) quand le récepteur ne renseigne pas le champ : ordre
 * de grandeur d'un smartphone à ciel dégagé. Écarter ces points reviendrait à
 * jeter les traces de tous les récepteurs silencieux.
 */
export const UNKNOWN_ACCURACY_M = 15;

/**
 * Plancher de précision (m) pour la pondération : aucun GPS grand public ne
 * fait mieux, et un point annoncé à 1 m ne doit pas écraser tous les autres.
 */
export const ACCURACY_FLOOR_M = 5;

/**
 * Écart latéral (m) au-delà duquel un point n'appartient plus au corridor
 * étudié : il longe autre chose (chemin parallèle, lacet voisin).
 */
export const MAX_LATERAL_M = 50;

/**
 * Trou (m) au-delà duquel on refuse d'interpoler l'écart latéral d'une trace :
 * entre deux points distants de 100 m, la trace a pu contourner un obstacle,
 * inventer sa position intermédiaire serait une extrapolation, pas une mesure.
 */
export const MAX_ALONG_GAP_M = 60;

/** Échantillons minimaux pour publier un point de la ligne centrale. */
export const MIN_SAMPLES_PER_STEP = 2;

/** Tolérance (m) du lissage du squelette quand aucune référence n'est fournie. */
export const SKELETON_TOLERANCE_M = 5;

/** Fenêtre minimale (m) de calcul du cap local : sous 20 m, le cap suit le bruit. */
export const MIN_BEARING_WINDOW_M = 20;

/** Nombre de passages au-delà duquel le volume ne rapporte plus de confiance. */
export const CONFIDENCE_FULL_TRACES = 20;

/** Nombre d'utilisateurs distincts au-delà duquel la diversité est acquise. */
export const GEOMETRY_CONFIDENCE_FULL_USERS = 6;

/** Dispersion latérale (m) qui annule le terme de précision de la confiance. */
export const DISPERSION_REFERENCE_M = 25;

/** Demi-vie (jours) de l'ancienneté interne d'un faisceau. */
export const CENTERLINE_AGE_HALF_LIFE_DAYS = 365;

/** Poids des quatre termes de confiance d'une ligne centrale (somme = 1). */
export const CENTERLINE_CONFIDENCE_WEIGHTS = {
  /** Nombre de passages. */
  volume: 0.35,
  /** Utilisateurs distincts (un faisceau d'une seule personne ne prouve rien). */
  users: 0.35,
  /** Resserrement du faisceau. */
  precision: 0.2,
  /** Fraîcheur relative des passages. */
  recency: 0.1,
} as const;

/**
 * Décalage (m) sous lequel aucune correction n'est proposée : en dessous, on
 * ne distingue pas un tracé faux d'un biais de récepteur ou d'un sentier qui
 * s'élargit. L'exemple du cahier des charges (100 passages, 8 m à droite) est
 * très au-dessus.
 */
export const DEFAULT_MIN_OFFSET_M = 5;

/**
 * Part de la précision GPS typique du faisceau en dessous de laquelle un
 * décalage reste du bruit (section 17).
 *
 * Le seuil absolu ne suffit pas : 6 m d'écart mesurés par des récepteurs qui
 * s'annoncent à 5 m sont une information, les mêmes 6 m mesurés par des
 * récepteurs qui s'annoncent à 18 m n'en sont pas. La moitié de la précision
 * annoncée est l'ordre de grandeur en dessous duquel un biais partagé
 * (multitrajets sous une barre rocheuse, constellation basse) explique tout
 * aussi bien l'écart qu'un tracé faux.
 */
export const CANDIDATE_NOISE_ACCURACY_SHARE = 0.5;

/**
 * Dispersion latérale maximale, en multiple du décalage constaté (section 17).
 *
 * C'est la traduction de « un écart moyen nul avec de fortes amplitudes des
 * deux côtés est du bruit » : si le faisceau s'étale plus d'une fois et demie
 * le décalage qu'on prétend mesurer, le décalage n'est pas *systématique* et
 * la carte ne sera pas corrigée pour si peu.
 */
export const CANDIDATE_MAX_DISPERSION_RATIO = 1.5;

/** Confiance minimale d'un faisceau pour qu'il propose une correction. */
export const MIN_CANDIDATE_CONFIDENCE = 0.55;

/** Largeur (m) du corridor de regroupement des portions hors réseau. */
export const DEFAULT_CORRIDOR_M = 25;

/** Passages minimaux pour qu'un corridor devienne un chemin potentiel. */
export const DEFAULT_MIN_OBSERVATIONS = 8;

/** Utilisateurs distincts minimaux (section 20). */
export const DEFAULT_MIN_TRAIL_USERS = 4;

/** Longueur minimale (m) d'un chemin potentiel : en dessous, c'est un écart. */
export const DEFAULT_MIN_TRAIL_LENGTH_M = 120;

/**
 * Étalement minimal (jours) entre première et dernière observation : un groupe
 * du même jour est une sortie collective, pas un chemin (section 20).
 */
export const DEFAULT_MIN_SPAN_DAYS = 14;

/** Part de longueur (0..1) devant rester dans le corridor pour regrouper deux portions. */
export const CORRIDOR_MIN_OVERLAP = 0.6;

/** Pas (m) d'échantillonnage lors du test de recouvrement de deux portions. */
export const CORRIDOR_SAMPLE_M = 10;

/** Étalement (jours) au-delà duquel la durabilité d'un corridor est acquise. */
export const TRAIL_SPAN_FULL_DAYS = 90;

/** Demi-vie (jours) de la fraîcheur d'un chemin potentiel. */
export const TRAIL_FRESHNESS_HALF_LIFE_DAYS = 365;

/** Poids des deux termes de confiance d'un chemin potentiel (somme = 1). */
export const TRAIL_CONFIDENCE_WEIGHTS = {
  /** Qualité du faisceau (passages, contributeurs, resserrement). */
  beam: 0.7,
  /** Durabilité : étalement des observations dans le temps (section 20). */
  span: 0.3,
} as const;

/** Pas (m) d'échantillonnage de la géométrie servant à l'identifiant stable. */
export const TRAIL_ID_SAMPLE_M = 100;

/**
 * Grille (degrés) d'arrondi des points servant à l'identifiant : 1e-4° ≈ 11 m.
 * Assez fin pour distinguer deux corridors voisins, assez grossier pour qu'une
 * passe enrichie de quelques traces garde le même identifiant — et donc la
 * décision humaine déjà prise sur cette candidature.
 */
export const TRAIL_ID_GRID_DEG = 1e-4;

/** Passages minimaux pour qu'une variante soit publiée. */
export const DEFAULT_MIN_PASSAGES = 5;

/** Utilisateurs distincts minimaux pour qu'une variante soit publiée. */
export const DEFAULT_MIN_VARIANT_USERS = 3;

/** Part d'usage minimale (0..1) pour qu'une variante soit publiée. */
export const DEFAULT_MIN_SHARE = 0.1;

/** Côté (m) des cellules de l'index de grille interne. */
export const GRID_CELL_M = 50;

/**
 * Au-delà de ce nombre de cellules, un segment très long n'est plus indexé
 * cellule par cellule mais versé dans la liste des segments « larges »,
 * toujours examinés. Sans ce garde-fou, un segment d'un kilomètre entre deux
 * sommets remplirait des centaines de cellules.
 */
const MAX_CELLS_PER_SEGMENT = 256;

/* ------------------------------------------------------------------ */
/* 1. Outils numériques                                                */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  const r = Math.round(value * factor) / factor;
  return Object.is(r, -0) ? 0 : r;
}

/** Option numérique strictement positive, sinon le défaut. */
function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Option numérique positive ou nulle, sinon le défaut. */
function nonNegative(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Seuil de comptage : entier ≥ 1. */
function countOption(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(positive(value, fallback)));
}

/**
 * Seuil d'utilisateurs distincts : jamais en dessous de `K_ANONYMITY_MIN`
 * (sections 34 à 36). Un appelant peut durcir l'exigence, jamais l'abaisser
 * sous le plancher de vie privée — c'est ce plancher, et non la bonne volonté
 * de l'appelant, qui garantit qu'aucune détection n'isole une personne.
 */
function usersOption(value: number | undefined, fallback: number): number {
  return Math.max(K_ANONYMITY_MIN, countOption(value, fallback));
}

/**
 * Médiane interpolée : `percentile` de `statistics.ts` fait déjà ce travail
 * (valeurs non finies ignorées, tableau vide → 0, entrée non mutée), inutile
 * d'en écrire une seconde version qui divergerait.
 */
function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/** Échantillon pondéré : une valeur latérale et le crédit qu'on lui accorde. */
interface WeightedSample {
  value: number;
  weight: number;
}

/**
 * Quantile pondéré, interpolé entre les milieux de masse des échantillons
 * (`samples` doit être trié par valeur croissante). Convention usuelle : un
 * échantillon isolé vaut pour lui-même, les bornes ne sont jamais dépassées.
 */
function weightedQuantile(samples: readonly WeightedSample[], totalWeight: number, p: number): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1 || totalWeight <= 0) return samples[0].value;
  const target = clamp01(p) * totalWeight;
  let cumulative = 0;
  let previousMid = 0;
  let previousValue = samples[0].value;
  for (let i = 0; i < samples.length; i++) {
    const mid = cumulative + samples[i].weight / 2;
    if (target <= mid) {
      if (i === 0) return samples[0].value;
      const span = mid - previousMid;
      const t = span > 0 ? (target - previousMid) / span : 0;
      return previousValue + (samples[i].value - previousValue) * t;
    }
    cumulative += samples[i].weight;
    previousMid = mid;
    previousValue = samples[i].value;
  }
  return samples[samples.length - 1].value;
}

/**
 * Moyenne pondérée tronquée : on retire `q` de la masse de chaque côté, en
 * coupant au besoin *dans* le poids d'un échantillon (sinon un faisceau de six
 * traces perdrait un tiers de son information au lieu de 20 %).
 */
function trimmedWeightedMean(samples: readonly WeightedSample[], totalWeight: number, q: number): number {
  const lo = q * totalWeight;
  const hi = (1 - q) * totalWeight;
  if (!(hi > lo)) return weightedQuantile(samples, totalWeight, 0.5);
  let cumulative = 0;
  let sum = 0;
  let weight = 0;
  for (const sample of samples) {
    const start = cumulative;
    const end = cumulative + sample.weight;
    cumulative = end;
    const effective = Math.min(end, hi) - Math.max(start, lo);
    if (effective <= 0) continue;
    sum += sample.value * effective;
    weight += effective;
  }
  return weight > 0 ? sum / weight : weightedQuantile(samples, totalWeight, 0.5);
}

/**
 * Position centrale robuste d'un jeu d'écarts latéraux pondérés.
 * Sous `TRIM_MIN_SAMPLES` échantillons, ou sans troncature demandée, la
 * médiane pondérée l'emporte : c'est le seul estimateur qui ignore totalement
 * une trace aberrante quand elles sont peu nombreuses.
 */
function robustCenter(samples: readonly WeightedSample[], totalWeight: number, trimQuantile: number): number {
  if (trimQuantile <= 0 || samples.length < TRIM_MIN_SAMPLES) {
    return weightedQuantile(samples, totalWeight, 0.5);
  }
  return trimmedWeightedMean(samples, totalWeight, trimQuantile);
}

/** Précision exploitable d'un point : `null` ou valeur absurde → supposée. */
function accuracyOf(accuracy: number | null | undefined): number {
  return typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > 0 ? accuracy : UNKNOWN_ACCURACY_M;
}

/**
 * Poids d'un point selon sa précision annoncée : en 1/précision et non en
 * 1/précision², parce que le chiffre rendu par un récepteur est un ordre de
 * grandeur, pas un écart-type mesuré. L'inverse simple évite qu'un point
 * annoncé à 4 m écrase dix points annoncés à 15 m.
 */
function accuracyWeight(accuracyM: number): number {
  return ACCURACY_FLOOR_M / Math.max(accuracyM, ACCURACY_FLOOR_M);
}

function isFinitePosition(p: { lat: number; lng: number }): boolean {
  return (
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  );
}

/**
 * Décroissance exponentielle d'un horodatage vers un instant de référence.
 *
 * C'est exactement `freshnessWeight` de `statistics.ts` (1 aujourd'hui, 0,5 à
 * une demi-vie), à une nuance près : une référence non finie ne vaut pas ici
 * un poids nul — une horloge illisible ne doit pas effacer un corridor — d'où
 * la garde explicite avant l'appel.
 */
function decayTo(at: number, reference: number, halfLifeDays: number): number {
  if (!Number.isFinite(at) || !Number.isFinite(reference)) return 1;
  return freshnessWeight(at, reference, halfLifeDays);
}

/* ------------------------------------------------------------------ */
/* 2. Index de grille sur une polyligne                                */
/* ------------------------------------------------------------------ */

/** Plan local (mètres) autour d'un point de référence : valable sur un massif. */
interface Plane {
  lng: number;
  lat: number;
  kx: number;
  ky: number;
}

function makePlane(ref: LatLng): Plane {
  const kx = METERS_PER_DEG_LAT * Math.cos((ref.lat * Math.PI) / 180);
  // Aux pôles, kx tend vers 0 : un plancher évite une division par zéro plus loin.
  return { lng: ref.lng, lat: ref.lat, kx: Math.abs(kx) < 1 ? 1 : kx, ky: METERS_PER_DEG_LAT };
}

function toX(plane: Plane, lng: number): number {
  return (lng - plane.lng) * plane.kx;
}

function toY(plane: Plane, lat: number): number {
  return (lat - plane.lat) * plane.ky;
}

/**
 * Index spatial d'une polyligne : chaque segment est rangé dans les cellules
 * que couvre son emprise, ce qui ramène la recherche du segment le plus proche
 * à l'examen de quelques cellules au lieu de toute la ligne.
 */
interface LineIndex {
  line: readonly LngLat[];
  cumulative: readonly number[];
  totalM: number;
  plane: Plane;
  xs: number[];
  ys: number[];
  cells: Map<string, number[]>;
  /** Segments trop longs pour être indexés : toujours examinés. */
  wide: number[];
  cellM: number;
}

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

function buildLineIndex(line: readonly LngLat[], cellM: number = GRID_CELL_M): LineIndex | null {
  if (line.length < 2) return null;
  const plane = makePlane({ lng: line[0][0], lat: line[0][1] });
  const size = cellM > 0 ? cellM : GRID_CELL_M;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of line) {
    xs.push(toX(plane, c[0]));
    ys.push(toY(plane, c[1]));
  }
  const cells = new Map<string, number[]>();
  const wide: number[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const x0 = Math.floor(Math.min(xs[i], xs[i + 1]) / size);
    const x1 = Math.floor(Math.max(xs[i], xs[i + 1]) / size);
    const y0 = Math.floor(Math.min(ys[i], ys[i + 1]) / size);
    const y1 = Math.floor(Math.max(ys[i], ys[i + 1]) / size);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_SEGMENT) {
      wide.push(i);
      continue;
    }
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cellKey(cx, cy);
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
    }
  }
  const cumulative = cumulativeDistances(line);
  return {
    line,
    cumulative,
    totalM: cumulative[cumulative.length - 1],
    plane,
    xs,
    ys,
    cells,
    wide,
    cellM: size,
  };
}

/** Résultat d'une projection : abscisse, écart signé, distance. */
interface LineHit {
  along: number;
  /** Écart latéral signé (m) : positif quand le point est à *droite* de la ligne. */
  offsetM: number;
  distanceM: number;
}

/**
 * Projette un point sur la ligne indexée, en ne regardant que les cellules du
 * disque de rayon `maxDistanceM`. Renvoie `null` si la ligne est plus loin :
 * l'appelant sait alors que ce point n'appartient pas au corridor.
 */
function projectOnIndex(index: LineIndex, point: { lat: number; lng: number }, maxDistanceM: number): LineHit | null {
  const px = toX(index.plane, point.lng);
  const py = toY(index.plane, point.lat);
  const reach = Math.max(0, maxDistanceM);
  const cx0 = Math.floor((px - reach) / index.cellM);
  const cx1 = Math.floor((px + reach) / index.cellM);
  const cy0 = Math.floor((py - reach) / index.cellM);
  const cy1 = Math.floor((py + reach) / index.cellM);
  // Meilleur candidat suivi par valeurs simples : pas d'allocation par segment
  // examiné, et le résultat n'est construit qu'une fois.
  let bestDistance = Infinity;
  let bestAlong = 0;
  let bestOffset = 0;
  const seen = new Set<number>();
  const consider = (i: number): void => {
    if (seen.has(i)) return;
    seen.add(i);
    const ax = index.xs[i];
    const ay = index.ys[i];
    const dx = index.xs[i + 1] - ax;
    const dy = index.ys[i + 1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const vx = px - qx;
    const vy = py - qy;
    const distanceM = Math.hypot(vx, vy);
    if (distanceM >= bestDistance) return;
    const len = Math.sqrt(len2);
    const segLen = index.cumulative[i + 1] - index.cumulative[i];
    bestDistance = distanceM;
    bestAlong = index.cumulative[i] + t * segLen;
    // Produit vectoriel : négatif à droite du sens de parcours, d'où le signe.
    bestOffset = len > 0 ? (dy * vx - dx * vy) / len : 0;
  };
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const list = index.cells.get(cellKey(cx, cy));
      if (!list) continue;
      for (const i of list) consider(i);
    }
  }
  for (const i of index.wide) consider(i);
  if (bestDistance > reach) return null;
  return { along: bestAlong, offsetM: bestOffset, distanceM: bestDistance };
}

/**
 * Cap local (degrés) de la polyligne à l'abscisse `along`, mesuré sur une
 * fenêtre centrée : le vecteur entre deux points distants est bien plus stable
 * que l'orientation d'un micro-segment de trace.
 */
function bearingAtAlong(
  line: readonly LngLat[],
  cumulative: readonly number[],
  along: number,
  stepM: number,
): number {
  const total = cumulative[cumulative.length - 1];
  const half = Math.min(Math.max(stepM, MIN_BEARING_WINDOW_M) / 2, total / 2);
  let from = along - half;
  let to = along + half;
  if (from < 0) {
    from = 0;
    to = Math.min(total, 2 * half);
  }
  if (to > total) {
    to = total;
    from = Math.max(0, total - 2 * half);
  }
  if (to - from > 0) return bearingBetweenAlong(line, cumulative, from, to);
  // Ligne dégénérée (longueur nulle) : le cap global reste la moins mauvaise réponse.
  return bearing({ lng: line[0][0], lat: line[0][1] }, { lng: line[line.length - 1][0], lat: line[line.length - 1][1] });
}

/* ------------------------------------------------------------------ */
/* 3. Ligne centrale collective (sections 17 et 18)                    */
/* ------------------------------------------------------------------ */

export interface CenterlineOptions {
  /** Pas d'échantillonnage le long de la référence (m). */
  stepM?: number;
  /** Traces distinctes minimales. */
  minTraces?: number;
  /** Utilisateurs distincts minimaux ; jamais en dessous de `K_ANONYMITY_MIN`. */
  minUsers?: number;
  /** Précision GPS (m) au-delà de laquelle un point est écarté. */
  maxAccuracyM?: number;
  /** Part tronquée de chaque côté ; 0 = médiane pondérée pure. */
  trimQuantile?: number;
}

/** Trace conservée après filtrage qualité. */
interface UsableTrace {
  trace: CorridorTrace;
  points: { lat: number; lng: number; accuracy: number | null }[];
  lengthM: number;
}

/** Recalage d'une trace sur la référence : écart latéral à une abscisse. */
interface TraceHit {
  along: number;
  offsetM: number;
  accuracyM: number;
}

/**
 * Ligne centrale et son détail interne : les écarts signés à chaque abscisse
 * servent à `geometryCandidate` sans refaire la projection.
 */
interface CenterlineFit {
  communityCenterline: Centerline;
  /** Abscisses retenues sur la ligne de référence (m). */
  alongs: number[];
  /** Écart latéral signé retenu à chaque abscisse (m, positif = à droite). */
  offsets: number[];
  /** Précision GPS typique (m) des mesures qui ont réellement contribué. */
  typicalAccuracyM: number;
}

function usableTraces(traces: readonly CorridorTrace[], maxAccuracyM: number): UsableTrace[] {
  const out: UsableTrace[] = [];
  for (const trace of traces) {
    if (!trace || !trace.points || trace.points.length < 2) continue;
    const points: { lat: number; lng: number; accuracy: number | null }[] = [];
    for (const p of trace.points) {
      if (!p || !isFinitePosition(p)) continue;
      // Section 18 : seules les observations assez précises entrent dans le calcul.
      if (accuracyOf(p.accuracy) > maxAccuracyM) continue;
      points.push({ lat: p.lat, lng: p.lng, accuracy: p.accuracy });
    }
    if (points.length < 2) continue;
    let lengthM = 0;
    for (let i = 1; i < points.length; i++) lengthM += haversineM(points[i - 1], points[i]);
    out.push({ trace, points, lengthM });
  }
  return out;
}

/**
 * Squelette de substitution quand aucune référence n'est fournie : la trace de
 * longueur médiane (arrondie vers le haut), lissée.
 *
 * Pourquoi la médiane plutôt que la plus longue : la trace la plus longue est
 * souvent celle qui a divagué, et elle imposerait son détour comme axe de
 * référence. Pourquoi lisser : le squelette ne sert qu'à définir l'abscisse
 * commune ; la position latérale vient ensuite du centre robuste, donc les
 * oscillations propres à la trace choisie n'ont aucune raison de survivre.
 */
function skeletonFrom(traces: readonly UsableTrace[]): LngLat[] | null {
  if (traces.length === 0) return null;
  const sorted = [...traces].sort((a, b) => {
    if (a.lengthM !== b.lengthM) return a.lengthM - b.lengthM;
    const atA = Number.isFinite(a.trace.at) ? a.trace.at : 0;
    const atB = Number.isFinite(b.trace.at) ? b.trace.at : 0;
    if (atA !== atB) return atA - atB;
    return a.trace.userKey < b.trace.userKey ? -1 : a.trace.userKey > b.trace.userKey ? 1 : 0;
  });
  const picked = sorted[Math.floor(sorted.length / 2)];
  const smoothed = simplifyPoints(picked.points, SKELETON_TOLERANCE_M);
  if (smoothed.length < 2) return null;
  return smoothed.map((p) => [p.lng, p.lat] as LngLat);
}

/** Abscisses régulières de 0 à `total`, extrémité comprise. */
function sampleAlongs(total: number, stepM: number): number[] {
  const count = Math.max(1, Math.ceil(total / stepM));
  const out: number[] = [];
  for (let i = 0; i <= count; i++) out.push(Math.min(total, i * stepM));
  if (out.length > 1 && out[out.length - 1] === out[out.length - 2]) out.pop();
  return out;
}

/** Recale une trace sur la référence : écarts latéraux ordonnés par abscisse. */
function traceHits(index: LineIndex, points: readonly { lat: number; lng: number; accuracy: number | null }[]): TraceHit[] {
  const hits: TraceHit[] = [];
  for (const p of points) {
    const hit = projectOnIndex(index, p, MAX_LATERAL_M);
    if (!hit) continue;
    hits.push({ along: hit.along, offsetM: hit.offsetM, accuracyM: accuracyOf(p.accuracy) });
  }
  hits.sort((a, b) => a.along - b.along);
  return hits;
}

/**
 * Coeur commun de `communityCenterline` et `geometryCandidate` (section 18).
 *
 * Toutes les traces sont recalées sur une abscisse commune, puis à chaque pas
 * la position centrale est calculée sur les écarts latéraux : c'est cette
 * séparation « le long / en travers » qui permet de moyenner des traces sans
 * jamais moyenner des points qui ne se correspondent pas.
 */
function fitCenterline(
  traces: readonly CorridorTrace[],
  reference: readonly LngLat[] | null,
  opts: CenterlineOptions,
): CenterlineFit | null {
  const stepM = positive(opts.stepM, DEFAULT_CENTERLINE_STEP_M);
  const maxAccuracyM = positive(opts.maxAccuracyM, DEFAULT_MAX_ACCURACY_M);
  const minTraces = countOption(opts.minTraces, DEFAULT_MIN_TRACES);
  const minUsers = usersOption(opts.minUsers, K_ANONYMITY_MIN);
  const trimQuantile = Math.min(0.45, nonNegative(opts.trimQuantile, DEFAULT_TRIM_QUANTILE));

  const usable = usableTraces(traces, maxAccuracyM);
  if (usable.length < minTraces) return null;

  const line = reference && reference.length >= 2 ? reference : skeletonFrom(usable);
  if (!line || line.length < 2) return null;
  const index = buildLineIndex(line);
  if (!index || !(index.totalM > 0)) return null;

  const alongs = sampleAlongs(index.totalM, stepM);
  const perAlong: WeightedSample[][] = alongs.map(() => []);
  const contributing: UsableTrace[] = [];
  // Précisions annoncées par les mesures réellement utilisées : c'est à elles,
  // et non à une constante, que `geometryCandidate` compare un décalage.
  const accuracies: number[] = [];

  for (const candidate of usable) {
    const hits = traceHits(index, candidate.points);
    if (hits.length < 2) continue;
    const first = hits[0];
    const last = hits[hits.length - 1];
    let pointer = 0;
    let contributed = false;
    for (let k = 0; k < alongs.length; k++) {
      const s = alongs[k];
      let offsetM: number | null = null;
      let accuracyM = UNKNOWN_ACCURACY_M;
      if (s < first.along) {
        // Tolérance d'un pas aux extrémités : sinon le premier point d'une
        // trace, jamais exactement sur une abscisse, serait perdu.
        if (first.along - s <= stepM) {
          offsetM = first.offsetM;
          accuracyM = first.accuracyM;
        }
      } else if (s > last.along) {
        if (s - last.along <= stepM) {
          offsetM = last.offsetM;
          accuracyM = last.accuracyM;
        }
      } else {
        while (pointer < hits.length - 2 && hits[pointer + 1].along < s) pointer++;
        const a = hits[pointer];
        const b = hits[pointer + 1];
        const span = b.along - a.along;
        if (span <= MAX_ALONG_GAP_M) {
          const t = span > 0 ? (s - a.along) / span : 0;
          offsetM = a.offsetM + (b.offsetM - a.offsetM) * t;
          accuracyM = a.accuracyM + (b.accuracyM - a.accuracyM) * t;
        }
      }
      if (offsetM === null) continue;
      perAlong[k].push({ value: offsetM, weight: accuracyWeight(accuracyM) });
      accuracies.push(accuracyM);
      contributed = true;
    }
    if (contributed) contributing.push(candidate);
  }

  if (contributing.length < minTraces) return null;
  const users = new Set<string>();
  for (const t of contributing) users.add(t.trace.userKey);
  if (users.size < minUsers) return null;

  const coordinates: LngLat[] = [];
  const keptAlongs: number[] = [];
  const offsets: number[] = [];
  const spreads: number[] = [];
  for (let k = 0; k < alongs.length; k++) {
    const samples = perAlong[k];
    if (samples.length < MIN_SAMPLES_PER_STEP) continue;
    samples.sort((a, b) => a.value - b.value);
    let totalWeight = 0;
    for (const s of samples) totalWeight += s.weight;
    const center = robustCenter(samples, totalWeight, trimQuantile);
    // Dispersion locale = écart interquartile : insensible aux deux extrêmes.
    const spread = weightedQuantile(samples, totalWeight, 0.75) - weightedQuantile(samples, totalWeight, 0.25);
    const base = pointAtAlong(index.line, index.cumulative, alongs[k]);
    const brg = bearingAtAlong(index.line, index.cumulative, alongs[k], stepM);
    const p =
      Math.abs(center) < 1e-6 ? base : offsetPoint(base, Math.abs(center), brg + (center > 0 ? 90 : -90));
    coordinates.push([p.lng, p.lat]);
    keptAlongs.push(alongs[k]);
    offsets.push(center);
    spreads.push(Math.max(0, spread));
  }
  if (coordinates.length < 2) return null;

  const timestamps: number[] = [];
  for (const t of contributing) if (Number.isFinite(t.trace.at)) timestamps.push(t.trace.at);
  const firstSeenAt = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const lastSeenAt = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const dispersionM = round(median(spreads), 2);

  return {
    communityCenterline: {
      coordinates,
      dispersionM,
      observations: contributing.length,
      uniqueUsers: users.size,
      firstSeenAt,
      lastSeenAt,
      confidence: centerlineConfidence(contributing.length, users.size, dispersionM, timestamps, lastSeenAt),
    },
    alongs: keptAlongs,
    offsets,
    typicalAccuracyM: accuracies.length > 0 ? median(accuracies) : UNKNOWN_ACCURACY_M,
  };
}

/**
 * Confiance d'une ligne centrale (0..1) : elle croît avec le nombre de
 * passages et d'utilisateurs distincts, décroît avec la dispersion latérale et
 * avec l'ancienneté.
 *
 * L'ancienneté est mesurée *dans* le faisceau — âge médian des traces rapporté
 * à la plus récente — parce que la signature de ce module n'expose pas
 * d'horloge : un module pur ne doit pas lire l'heure en douce. La décote par
 * rapport à « maintenant » appartient aux appelants qui reçoivent un `now`
 * (voir `detectPotentialTrails`).
 */
function centerlineConfidence(
  observations: number,
  uniqueUsers: number,
  dispersionM: number,
  timestamps: readonly number[],
  lastSeenAt: number,
): number {
  const w = CENTERLINE_CONFIDENCE_WEIGHTS;
  const volume = clamp01(observations / CONFIDENCE_FULL_TRACES);
  const users = clamp01(uniqueUsers / GEOMETRY_CONFIDENCE_FULL_USERS);
  const precision = clamp01(1 - dispersionM / DISPERSION_REFERENCE_M);
  // Sans horodatage exploitable, la fraîcheur est neutre : ni bonus ni malus.
  const recency =
    timestamps.length === 0
      ? 0.5
      : decayTo(median(timestamps), lastSeenAt, CENTERLINE_AGE_HALF_LIFE_DAYS);
  return round(
    clamp01(volume * w.volume + users * w.users + precision * w.precision + recency * w.recency),
    3,
  );
}

/**
 * Ligne centrale statistique d'un faisceau de traces (section 18).
 *
 * Primitive commune à `geometryCandidate` et à `detectPotentialTrails` :
 * chaque trace est recalée sur une abscisse commune, et la position retenue à
 * chaque pas est la *médiane transversale* pondérée par la précision — pas la
 * moyenne, qu'une seule trace partie sur le chemin d'à côté suffirait à tirer.
 *
 * `reference` sert d'axe d'abscisse (géométrie officielle du segment,
 * par exemple) ; à défaut, le faisceau fournit son propre squelette. Renvoie
 * `null` dès que le faisceau ne réunit pas assez de traces, assez
 * d'utilisateurs distincts (jamais moins de `K_ANONYMITY_MIN`), ou ne se
 * recouvre nulle part.
 */
export function communityCenterline(
  traces: readonly CorridorTrace[],
  reference: readonly LngLat[] | null = null,
  options: CenterlineOptions = {},
): Centerline | null {
  return fitCenterline(traces, reference, options)?.communityCenterline ?? null;
}

/** Réglages de `geometryCandidate` (l'axe vient du segment, pas des options). */
export interface GeometryCandidateOptions extends CenterlineOptions {
  /** Décalage (m) sous lequel aucune correction n'est proposée. */
  minOffsetM?: number;
  /** Part de la précision GPS typique sous laquelle le décalage reste du bruit. */
  noiseAccuracyShare?: number;
  /** Dispersion maximale tolérée, en multiple du décalage constaté. */
  maxDispersionRatio?: number;
  /** Confiance minimale du faisceau pour proposer une correction. */
  minConfidence?: number;
}

/**
 * Candidature de correction de géométrie pour un segment existant (section 17).
 *
 * Si tout le monde passe systématiquement à quelques mètres à côté du tracé
 * officiel, c'est le tracé qui est faux. Encore faut-il distinguer « tout le
 * monde du même côté » de « tout le monde un peu partout » : l'écart retenu
 * est *signé* (positif à droite du sens de la géométrie, via le cap local), si
 * bien qu'un faisceau qui déborde autant à gauche qu'à droite s'annule de
 * lui-même au lieu de passer pour un décalage.
 *
 * Trois raisons de ne rien proposer, et elles sont testées :
 *
 *  1. pas assez de traces ni d'utilisateurs distincts (`fitCenterline`) ;
 *  2. écart dans le bruit — plus petit que `minOffsetM`, ou que la fraction
 *     `noiseAccuracyShare` de la précision que les récepteurs annoncent
 *     eux-mêmes : 6 m mesurés à ±18 m ne prouvent rien ;
 *  3. faisceau trop étalé pour conclure — dispersion latérale supérieure à
 *     `maxDispersionRatio` fois le décalage, ou confiance insuffisante.
 *
 * La carte officielle n'est jamais modifiée ici : la sortie est une
 * candidature, à valider par un humain.
 */
export function geometryCandidate(
  segment: PathSegment,
  traces: readonly CorridorTrace[],
  options: GeometryCandidateOptions = {},
): GeometryCandidate | null {
  if (!segment || !segment.coordinates || segment.coordinates.length < 2) return null;
  const fit = fitCenterline(traces, segment.coordinates, options);
  if (!fit) return null;

  // Médiane signée : un lacet mal placé sur dix ne fait pas basculer le verdict.
  const offsetM = round(median(fit.offsets), 2);
  let maxOffsetM = 0;
  for (const o of fit.offsets) if (Math.abs(o) > maxOffsetM) maxOffsetM = Math.abs(o);

  const noiseShare = nonNegative(options.noiseAccuracyShare, CANDIDATE_NOISE_ACCURACY_SHARE);
  const floorM = Math.max(nonNegative(options.minOffsetM, DEFAULT_MIN_OFFSET_M), noiseShare * fit.typicalAccuracyM);
  if (Math.abs(offsetM) < floorM) return null;

  const maxDispersionRatio = positive(options.maxDispersionRatio, CANDIDATE_MAX_DISPERSION_RATIO);
  if (fit.communityCenterline.dispersionM > Math.abs(offsetM) * maxDispersionRatio) return null;

  const minConfidence = nonNegative(options.minConfidence, MIN_CANDIDATE_CONFIDENCE);
  if (fit.communityCenterline.confidence < minConfidence) return null;

  return { ...fit.communityCenterline, segmentId: segment.id, offsetM, maxOffsetM: round(maxOffsetM, 2) };
}

/* ------------------------------------------------------------------ */
/* 4. Chemins potentiels (sections 19 et 20)                           */
/* ------------------------------------------------------------------ */

export interface PotentialTrailOptions {
  /** Largeur (m) du corridor de regroupement. */
  corridorM?: number;
  /** Passages minimaux. */
  minObservations?: number;
  /** Utilisateurs distincts minimaux. */
  minUsers?: number;
  /** Longueur minimale (m) du chemin reconstruit. */
  minLengthM?: number;
  /** Étalement minimal (jours) entre première et dernière observation. */
  minSpanDays?: number;
}

/** Portion hors réseau préparée pour la comparaison. */
interface CorridorRun {
  run: OffNetworkRun;
  line: LngLat[];
  index: LineIndex;
}

/**
 * Part de la longueur de `a` qui reste à moins de `corridorM` de `b`.
 * L'échantillonnage régulier de `a` garantit que la mesure est bien une part
 * de *longueur* et non une part de points (les traces n'ont pas toutes la même
 * cadence d'enregistrement).
 */
function corridorOverlap(a: CorridorRun, b: CorridorRun, corridorM: number): number {
  const samples = pointsAlongLine(a.line, CORRIDOR_SAMPLE_M);
  if (samples.length === 0) return 0;
  let inside = 0;
  for (const p of samples) if (projectOnIndex(b.index, p, corridorM)) inside++;
  return inside / samples.length;
}

/** Union-find : regroupement transitif des portions d'un même corridor. */
function makeUnionFind(size: number): { find: (i: number) => number; union: (a: number, b: number) => void } {
  const parent = new Array<number>(size);
  for (let i = 0; i < size; i++) parent[i] = i;
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let cur = i;
    while (parent[cur] !== root) {
      const next = parent[cur];
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  return { find, union };
}

/**
 * Identifiant déterministe d'un chemin potentiel, dérivé de la géométrie
 * arrondie : la même passe sur les mêmes données donne le même identifiant, et
 * une passe ultérieure enrichie de quelques traces le garde tant que la
 * géométrie ne bouge pas de plus d'une dizaine de mètres (`TRAIL_ID_GRID_DEG`).
 * Le sens de parcours est neutralisé (on hache la plus petite des deux
 * écritures) : un corridor reconstruit à l'envers reste le même chemin.
 */
function trailId(coordinates: readonly LngLat[]): string {
  const sampled = pointsAlongLine(coordinates, TRAIL_ID_SAMPLE_M);
  const parts = sampled.map((p) => {
    const g = snapToGrid(p, TRAIL_ID_GRID_DEG);
    return `${g.lng},${g.lat}`;
  });
  const forward = parts.join(";");
  const backward = [...parts].reverse().join(";");
  return `trail-${hashString(forward <= backward ? forward : backward).toString(36)}`;
}

/** Répartition des passages par activité (fractions sommant à 1). */
function activityMix(activities: readonly ActivityMode[]): Partial<Record<ActivityMode, number>> {
  const counts = new Map<ActivityMode, number>();
  for (const a of activities) counts.set(a, (counts.get(a) ?? 0) + 1);
  const total = activities.length;
  const mix: Partial<Record<ActivityMode, number>> = {};
  if (total === 0) return mix;
  for (const [activity, count] of counts) mix[activity] = round(count / total, 3);
  return mix;
}

/**
 * Détecte les chemins potentiels : portions hors réseau suivant le même
 * corridor (section 19), filtrées par les garde-fous de la section 20.
 *
 * Deux portions appartiennent au même corridor si l'une reste à moins de
 * `corridorM` de l'autre sur au moins 60 % de sa longueur — test fait dans les
 * deux sens d'inclusion, ce qui rattache un court raccourci à la portion longue
 * qui le contient, et ignore le sens de parcours (on compare des géométries,
 * pas des trajets).
 *
 * Le filtre spatial passe d'abord par une grille : seules les portions
 * partageant une cellule sont comparées deux à deux.
 */
export function detectPotentialTrails(
  runs: readonly OffNetworkRun[],
  options: PotentialTrailOptions = {},
  now: number = Date.now(),
): PotentialTrail[] {
  const corridorM = positive(options.corridorM, DEFAULT_CORRIDOR_M);
  const minObservations = countOption(options.minObservations, DEFAULT_MIN_OBSERVATIONS);
  const minUsers = usersOption(options.minUsers, DEFAULT_MIN_TRAIL_USERS);
  const minLengthM = positive(options.minLengthM, DEFAULT_MIN_TRAIL_LENGTH_M);
  const minSpanDays = nonNegative(options.minSpanDays, DEFAULT_MIN_SPAN_DAYS);

  const usable: CorridorRun[] = [];
  for (const run of runs) {
    if (!run || !run.points || run.points.length < 2) continue;
    const line: LngLat[] = [];
    for (const p of run.points) if (isFinitePosition(p)) line.push([p.lng, p.lat]);
    if (line.length < 2) continue;
    const index = buildLineIndex(line, Math.max(corridorM, GRID_CELL_M));
    if (!index || !(index.totalM > 0)) continue;
    usable.push({ run, line, index });
  }
  // Aucun corridor ne peut atteindre le seuil : inutile d'aller plus loin.
  if (usable.length < minObservations) return [];

  // Grille de pré-filtrage : cellules de 2 × corridorM, balayées avec leurs
  // voisines, donc toute paire réellement proche est bien candidate.
  const cellM = corridorM * 2;
  const plane = makePlane({ lng: usable[0].line[0][0], lat: usable[0].line[0][1] });
  const cellsOfRun: string[][] = [];
  const cellIndex = new Map<string, number[]>();
  for (let i = 0; i < usable.length; i++) {
    const own = new Set<string>();
    for (const p of pointsAlongLine(usable[i].line, cellM / 2)) {
      own.add(cellKey(Math.floor(toX(plane, p.lng) / cellM), Math.floor(toY(plane, p.lat) / cellM)));
    }
    const list = [...own];
    cellsOfRun.push(list);
    for (const key of list) {
      const bucket = cellIndex.get(key);
      if (bucket) bucket.push(i);
      else cellIndex.set(key, [i]);
    }
  }

  const uf = makeUnionFind(usable.length);
  const tested = new Set<string>();
  for (let i = 0; i < usable.length; i++) {
    const neighbours = new Set<number>();
    for (const key of cellsOfRun[i]) {
      const parts = key.split(":");
      const cx = Number(parts[0]);
      const cy = Number(parts[1]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = cellIndex.get(cellKey(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const j of bucket) if (j > i) neighbours.add(j);
        }
      }
    }
    for (const j of neighbours) {
      const pair = `${i}:${j}`;
      if (tested.has(pair)) continue;
      tested.add(pair);
      if (uf.find(i) === uf.find(j)) continue;
      const overlap = Math.max(
        corridorOverlap(usable[i], usable[j], corridorM),
        corridorOverlap(usable[j], usable[i], corridorM),
      );
      if (overlap >= CORRIDOR_MIN_OVERLAP) uf.union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < usable.length; i++) {
    const root = uf.find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  }

  const out: PotentialTrail[] = [];
  for (const group of groups.values()) {
    if (group.length < minObservations) continue;
    const users = new Set<string>();
    const timestamps: number[] = [];
    const activities: ActivityMode[] = [];
    for (const i of group) {
      const run = usable[i].run;
      users.add(run.userKey);
      activities.push(run.activity);
      if (Number.isFinite(run.at)) timestamps.push(run.at);
    }
    // Section 20 : une seule personne, ou une seule journée, ne fait pas un chemin.
    if (users.size < minUsers) continue;
    if (timestamps.length === 0) continue;
    const firstSeenAt = Math.min(...timestamps);
    const lastSeenAt = Math.max(...timestamps);
    const spanDays = (lastSeenAt - firstSeenAt) / DAY;
    if (spanDays < minSpanDays) continue;

    const traces: CorridorTrace[] = group.map((i) => {
      const run = usable[i].run;
      return {
        userKey: run.userKey,
        activity: run.activity,
        at: run.at,
        points: run.points.map((p) => ({ lat: p.lat, lng: p.lng, accuracy: p.accuracy })),
      };
    });
    // Le volume a déjà été vérifié sur le groupe : le calcul de géométrie
    // n'exige plus que de quoi moyenner (certaines portions ne couvrent qu'un
    // bout du corridor et ne contribueront pas partout). Le k-anonymat, lui,
    // est revérifié ici sur les seules traces qui ont réellement contribué à
    // la ligne publiée — c'est elle que l'on rend visible, pas le groupe.
    const fit = fitCenterline(traces, null, {
      minTraces: Math.max(MIN_SAMPLES_PER_STEP, Math.ceil(minObservations / 2)),
      minUsers: K_ANONYMITY_MIN,
    });
    if (!fit) continue;
    const coordinates = fit.communityCenterline.coordinates;
    const lengthM = round(polylineLengthM(coordinates), 1);
    if (lengthM < minLengthM) continue;

    // La durabilité (étalement) et la fraîcheur sont propres au chemin
    // potentiel : la ligne centrale, elle, ignore l'horloge.
    const spanScore = clamp01(spanDays / TRAIL_SPAN_FULL_DAYS);
    const freshness = decayTo(lastSeenAt, now, TRAIL_FRESHNESS_HALF_LIFE_DAYS);
    const w = TRAIL_CONFIDENCE_WEIGHTS;
    const confidence = round(
      clamp01((fit.communityCenterline.confidence * w.beam + spanScore * w.span) * freshness),
      3,
    );

    out.push({
      id: trailId(coordinates),
      coordinates,
      lengthM,
      observations: group.length,
      uniqueUsers: users.size,
      firstSeenAt,
      lastSeenAt,
      dispersionM: fit.communityCenterline.dispersionM,
      activityMix: activityMix(activities),
      confidence,
    });
  }

  out.sort((a, b) => b.confidence - a.confidence || b.lengthM - a.lengthM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. Variantes d'itinéraire (section 21)                              */
/* ------------------------------------------------------------------ */

/** Réglages de publication des variantes (section 21). */
export interface RouteVariantOptions {
  /** Passages minimaux pour qu'une variante soit publiée. */
  minPassages?: number;
  /** Utilisateurs distincts minimaux ; jamais en dessous de `K_ANONYMITY_MIN`. */
  minUsers?: number;
  /** Part d'usage minimale (0..1) sous laquelle la variante est anecdotique. */
  minShare?: number;
}

interface VariantAccumulator {
  segmentIds: string[];
  passages: number;
  users: Set<string>;
  distances: number[];
  durations: number[];
}

interface PairAccumulator {
  fromNode: string;
  toNode: string;
  total: number;
  /** Contributeurs distincts du couple, tous itinéraires confondus. */
  users: Set<string>;
  variants: Map<string, VariantAccumulator>;
}

/**
 * Variantes réellement empruntées entre deux mêmes points (section 21).
 *
 * Le couple de nœuds est normalisé (aller et retour décrivent le même
 * itinéraire) et la suite de segments l'est aussi : on retient la plus petite
 * des deux écritures (ordre direct / ordre inverse), ce qui rassemble les deux
 * sens de parcours sous une même variante sans dépendre de l'ordre d'arrivée
 * des observations.
 *
 * `share` est calculée sur *tous* les passages du couple, y compris ceux des
 * variantes trop confidentielles pour être publiées : dire « 70 % » suppose de
 * compter les 30 % restants.
 *
 * Le k-anonymat s'applique deux fois (sections 34 à 36) : un couple de nœuds
 * parcouru par moins de `minUsers` personnes distinctes ne produit aucune
 * variante — publier « 100 % passent par là » quand « là » est le trajet de
 * deux personnes reviendrait à décrire leurs habitudes — et, à l'intérieur
 * d'un couple publiable, chaque variante doit à son tour atteindre le seuil.
 */
export function detectVariants(
  observations: readonly PathObservation[],
  options: RouteVariantOptions = {},
): RouteVariant[] {
  const minPassages = countOption(options.minPassages, DEFAULT_MIN_PASSAGES);
  const minUsers = usersOption(options.minUsers, DEFAULT_MIN_VARIANT_USERS);
  const minShare = nonNegative(options.minShare, DEFAULT_MIN_SHARE);

  const pairs = new Map<string, PairAccumulator>();
  for (const obs of observations) {
    if (!obs || !obs.segmentIds || obs.segmentIds.length === 0) continue;
    if (typeof obs.fromNode !== "string" || typeof obs.toNode !== "string") continue;
    if (obs.fromNode === "" || obs.toNode === "") continue;
    const fromNode = obs.fromNode <= obs.toNode ? obs.fromNode : obs.toNode;
    const toNode = obs.fromNode <= obs.toNode ? obs.toNode : obs.fromNode;
    const pairKey = `${fromNode}>${toNode}`;
    let pair = pairs.get(pairKey);
    if (!pair) {
      pair = { fromNode, toNode, total: 0, users: new Set(), variants: new Map() };
      pairs.set(pairKey, pair);
    }
    pair.total++;
    if (typeof obs.userKey === "string" && obs.userKey !== "") pair.users.add(obs.userKey);

    const ids = [...obs.segmentIds];
    const reversed = [...ids].reverse();
    const forward = ids.join(">");
    const backward = reversed.join(">");
    const signature = forward <= backward ? forward : backward;
    let variant = pair.variants.get(signature);
    if (!variant) {
      variant = {
        segmentIds: forward <= backward ? ids : reversed,
        passages: 0,
        users: new Set(),
        distances: [],
        durations: [],
      };
      pair.variants.set(signature, variant);
    }
    variant.passages++;
    if (typeof obs.userKey === "string" && obs.userKey !== "") variant.users.add(obs.userKey);
    if (Number.isFinite(obs.distanceM) && obs.distanceM > 0) variant.distances.push(obs.distanceM);
    if (Number.isFinite(obs.durationMs) && obs.durationMs > 0) variant.durations.push(obs.durationMs);
  }

  const out: RouteVariant[] = [];
  for (const pair of pairs.values()) {
    // Couple trop confidentiel : ni ses variantes ni ses parts ne sortent d'ici.
    if (pair.total === 0 || pair.users.size < minUsers) continue;
    for (const variant of pair.variants.values()) {
      const share = variant.passages / pair.total;
      if (variant.passages < minPassages) continue;
      if (variant.users.size < minUsers) continue;
      if (share < minShare) continue;
      // Médianes : une sortie avec une heure de pause au col ne déplace ni la
      // distance de référence ni la durée de référence. `durationStats` sait
      // déjà écarter les durées nulles ou négatives et rend `null` quand il
      // ne reste rien de mesurable — pas une durée inventée.
      const durations = durationStats(variant.durations);
      out.push({
        fromNode: pair.fromNode,
        toNode: pair.toNode,
        segmentIds: [...variant.segmentIds],
        distanceM: round(median(variant.distances), 1),
        medianDurationMs: durations === null ? null : durations.medianMs,
        passages: variant.passages,
        uniqueUsers: variant.users.size,
        share: round(share, 3),
      });
    }
  }

  // Tri total : part, puis volume, puis une clé textuelle qui identifie la
  // variante sans ambiguïté (couple de nœuds + suite de segments). Deux appels
  // sur les mêmes données rendent donc exactement le même tableau, quel que
  // soit l'ordre d'arrivée des observations.
  out.sort((a, b) => {
    if (b.share !== a.share) return b.share - a.share;
    if (b.passages !== a.passages) return b.passages - a.passages;
    const ka = `${a.fromNode}>${a.toNode}>${a.segmentIds.join(">")}`;
    const kb = `${b.fromNode}>${b.toNode}>${b.segmentIds.join(">")}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out;
}
