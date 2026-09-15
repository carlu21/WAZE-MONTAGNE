/**
 * Qualité des relevés d'une trace brute (moteur cartographique collectif).
 *
 * Sections couvertes :
 *
 *  - **4. Ne jamais promettre une fausse précision** : chaque point porte un
 *    score 0..5 qui dit ce qu'on sait *vraiment* de sa position. La précision
 *    annoncée par le récepteur plafonne le score, et une précision inconnue
 *    n'est jamais traitée comme parfaite (on plafonne alors à « correct »).
 *  - **6. Nettoyer les erreurs GPS** : les incohérences (téléport, vitesse ou
 *    accélération impossibles, cap absurde, doublons, immobilité) sont
 *    diagnostiquées point par point, jamais corrigées : la trace brute n'est
 *    pas écrasée (section 8 du contrat), elle est seulement *annotée*. Les
 *    consommateurs (map matching, corridors, statistiques) filtrent ensuite
 *    avec `usablePoints`, et `traceQuality` dit si une activité mérite de
 *    contribuer aux statistiques collectives.
 *
 * Principe directeur : **un point n'est déclassé que sur un faisceau
 * d'indices**. Un seul écart de distance ne suffit jamais ; il faut que la
 * géométrie *et* la cinématique *et* l'incertitude annoncée convergent. C'est
 * ce qui permet de ne pas casser une descente VTT à 12 m/s (mouvement rapide
 * mais soutenu et cohérent) tout en isolant le relevé qui part à 120 m et
 * revient aussitôt.
 *
 * Module pur : aucune notion de « maintenant » (tout est relatif aux
 * horodatages des points eux-mêmes), aucun aléa, aucune mutation de l'entrée.
 * Coût : O(n) sur la trace + trois tris O(n log n) pour les médianes robustes,
 * ce qui tient sur des dizaines de milliers de points.
 */
import { bearing, haversineM, isValidLatLng } from "../geo";
import { headingDelta } from "../navigation/geometry";
import type { ActivityMode } from "../navigation/types";
import type { PointFlag, PointQuality, RawPoint, ScoredPoint } from "./types";

/* ------------------------------------------------------------------ */
/* Réglages produit (seuils documentés, pas des nombres perdus)         */
/* ------------------------------------------------------------------ */

/**
 * Vitesse instantanée plausible maximale par activité (m/s).
 *
 * Ce n'est pas la vitesse de croisière (`DEFAULT_SPEED_MS` dans navigation/eta)
 * mais le plafond au-delà duquel le relevé ne peut plus être un déplacement
 * réel : ~2,5 m/s = 9 km/h pour un marcheur (course brève incluse), 5 m/s pour
 * le trail, 14 m/s = 50 km/h pour un VTT en descente (une descente à 12 m/s
 * reste donc légitime), 8 m/s pour un cheval au galop.
 */
export const MAX_SPEED_MS: Record<ActivityMode, number> = {
  hiking: 2.5,
  trail: 5,
  mtb: 14,
  equestrian: 8,
  other: 5,
};

/**
 * Échelle de la précision annoncée → score maximal du point (section 4).
 * Bornes croissantes, la première atteinte gagne ; au-delà du dernier palier,
 * le point est inutilisable.
 */
export const ACCURACY_TIERS_M: readonly { readonly maxM: number; readonly quality: PointQuality }[] = [
  { maxM: 5, quality: 5 }, // excellent : ciel dégagé, multi-constellation
  { maxM: 10, quality: 4 }, // bon
  { maxM: 20, quality: 3 }, // correct : encore exploitable pour la géométrie
  { maxM: 35, quality: 2 }, // faible : sous couvert forestier, en gorge
  { maxM: 60, quality: 1 }, // très faible : ordre de grandeur seulement
];

/** Au-delà, l'incertitude dépasse largement la largeur d'un sentier : rien à en tirer. */
export const ACCURACY_UNUSABLE_M = 60;

/** Précision inconnue : incertitude non mesurée, donc jamais « parfaite » (plafond « correct »). */
export const UNKNOWN_ACCURACY_QUALITY: PointQuality = 3;

/** Incertitude supposée (m) quand le récepteur n'annonce rien, pour les comparaisons de seuils. */
export const ASSUMED_ACCURACY_M = 15;

/** Qualité minimale d'un point exploitable pour la géométrie (défaut de `usablePoints`). */
export const MIN_USABLE_QUALITY: PointQuality = 3;

/** Accélération plausible maximale (m/s²) : au-delà, le relevé est mécaniquement impossible. */
export const DEFAULT_MAX_ACCEL_MS2 = 4;

/** Vitesse (m/s) sous laquelle on considère l'utilisateur immobile (pause, photo, refuge). */
export const DEFAULT_STILL_SPEED_MS = 0.3;

/** Facteur d'écart voisins/excursion caractérisant un téléport. */
export const DEFAULT_TELEPORT_FACTOR = 3;

/** Écart absolu minimal (m) pour envisager un téléport : en dessous, c'est du bruit GPS ordinaire. */
export const TELEPORT_MIN_JUMP_M = 25;

/** Tolérance (m) sous laquelle deux relevés sont « à la même position ». */
export const DUPLICATE_MAX_M = 1;

/** Un point isolé s'écarte de ses deux voisins d'au moins ce multiple du pas médian. */
export const OUTLIER_STEP_FACTOR = 6;

/** Écart absolu minimal (m) pour parler d'isolement (évite de punir les traces très denses). */
export const OUTLIER_MIN_JUMP_M = 30;

/** Un intervalle bien plus long que la médiane explique l'écart : ce n'est pas un isolement. */
export const OUTLIER_MAX_INTERVAL_FACTOR = 2;

/** Part de la vitesse max au-delà de laquelle un changement de cap brutal devient suspect. */
export const HEADING_MIN_SPEED_FACTOR = 0.6;

/** Changement de cap (degrés) considéré comme un demi-tour instantané. */
export const HEADING_MAX_DELTA_DEG = 135;

/** Au-delà de cet intervalle (s), le cap entre deux relevés est une moyenne : on ne juge plus. */
export const HEADING_MAX_INTERVAL_S = 15;

/**
 * Pénalité de score par motif.
 *
 * `accuracy` ne pénalise pas deux fois (l'échelle de précision a déjà fixé le
 * plafond) et `still` ne pénalise pas du tout : un point à l'arrêt est un point
 * juste, simplement sans valeur pour reconstruire une géométrie. `teleport`
 * suffit à lui seul à rendre le point inutilisable, `duplicate` le sort des
 * points exploitables sans prétendre qu'il est faux.
 */
export const FLAG_PENALTY: Record<PointFlag, number> = {
  accuracy: 0,
  teleport: 5,
  speed: 2,
  acceleration: 1,
  heading: 1,
  duplicate: 4,
  outlier: 1,
  still: 0,
};

export interface QualityOptions {
  /** Précision annoncée (m) au-delà de laquelle un point est inutilisable. Défaut 60, jamais plus. */
  maxAccuracyM?: number;
  /** Accélération plausible maximale (m/s²). Défaut 4. */
  maxAccelMs2?: number;
  /** Vitesse (m/s) sous laquelle l'utilisateur est considéré immobile. Défaut 0,3. */
  stillSpeedMs?: number;
  /** Facteur de détection du téléport (plus grand = plus permissif). Défaut 3. */
  teleportFactor?: number;
}

/* ------------------------------------------------------------------ */
/* Utilitaires internes                                                */
/* ------------------------------------------------------------------ */

/** Échelle des qualités : évite un cast pour repasser de `number` à `PointQuality`. */
const QUALITY_LADDER: readonly PointQuality[] = [0, 1, 2, 3, 4, 5];

function clampQuality(value: number): PointQuality {
  return QUALITY_LADDER[Math.max(0, Math.min(5, Math.round(value)))];
}

/** Option numérique strictement positive, sinon valeur par défaut. */
function positiveOption(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Précision annoncée exploitable : une valeur négative ou non finie vaut « inconnue ». */
function announcedAccuracy(point: { accuracy: number | null }): number | null {
  const a = point.accuracy;
  return a !== null && Number.isFinite(a) && a >= 0 ? a : null;
}

/** Médiane (copie l'entrée : la fonction reste pure). Tableau vide → 0. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Score plafond d'un point d'après la seule précision annoncée (section 4). */
function accuracyScore(accuracyM: number | null, maxAccuracyM: number): PointQuality {
  if (accuracyM === null) return UNKNOWN_ACCURACY_QUALITY;
  if (accuracyM > maxAccuracyM) return 0;
  for (const tier of ACCURACY_TIERS_M) {
    if (accuracyM <= tier.maxM) return tier.quality;
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Notation d'une trace                                                */
/* ------------------------------------------------------------------ */

/**
 * Annote chaque relevé d'une trace brute : score 0..5 et motifs de déclassement.
 *
 * L'ordre et le nombre de points sont préservés (l'indice reste la clé entre
 * trace brute et trace rattachée, cf. `MatchedPoint.index`), et les points
 * d'entrée ne sont jamais modifiés.
 *
 * `stepM` et `observedSpeedMs` sont mesurés depuis le dernier point **retenu**
 * (les téléports, doublons et relevés impossibles sont sautés) : une trace
 * filtrée par `usablePoints` reste ainsi cohérente en distance et en vitesse,
 * et un point aberrant ne contamine pas son successeur.
 */
export function scoreTrace(
  points: readonly RawPoint[],
  activity: ActivityMode,
  opts: QualityOptions = {},
): ScoredPoint[] {
  const n = points.length;
  if (n === 0) return [];

  // `maxAccuracyM` ne peut que durcir le plafond absolu : au-delà de 60 m,
  // la position ne veut plus rien dire, quelle que soit la configuration.
  const maxAccuracyM = Math.min(positiveOption(opts.maxAccuracyM, ACCURACY_UNUSABLE_M), ACCURACY_UNUSABLE_M);
  const maxAccelMs2 = positiveOption(opts.maxAccelMs2, DEFAULT_MAX_ACCEL_MS2);
  const stillSpeedMs = positiveOption(opts.stillSpeedMs, DEFAULT_STILL_SPEED_MS);
  const teleportFactor = positiveOption(opts.teleportFactor, DEFAULT_TELEPORT_FACTOR);
  const rawMax = MAX_SPEED_MS[activity];
  const maxSpeedMs = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : MAX_SPEED_MS.other;

  const flags: PointFlag[][] = Array.from({ length: n }, () => []);
  const stepM: (number | null)[] = new Array<number | null>(n).fill(null);
  const speedMs: (number | null)[] = new Array<number | null>(n).fill(null);

  // Passe 1 : validité brute. Une coordonnée hors WGS84 ou un horodatage non
  // fini ne peut servir à rien, et ne doit surtout pas polluer les voisins.
  const valid: boolean[] = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    valid[i] = isValidLatLng(points[i]) && Number.isFinite(points[i].at);
  }

  // Passe 2 : téléports, jugés sur les voisins immédiats de la trace brute.
  const teleport = detectTeleports(points, valid, teleportFactor, maxSpeedMs);

  // Passe 3 : chaîne des points retenus (vitesses, accélérations, immobilité).
  const retained: number[] = [];
  const chainSteps: number[] = [];
  const chainIntervalsS: number[] = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    const point = points[i];
    if (!valid[i]) {
      // Aucun motif du contrat ne dit « coordonnée invalide » : « outlier »
      // (isolé, inexploitable) est le diagnostic le plus proche.
      flags[i].push("outlier");
      continue;
    }
    const accuracy = announcedAccuracy(point);
    if (accuracy !== null && accuracy > maxAccuracyM) flags[i].push("accuracy");

    if (teleport[i]) {
      flags[i].push("teleport");
      if (last >= 0) stepM[i] = haversineM(points[last], point);
      continue; // hors chaîne : ni jugé plus loin, ni référence pour le suivant
    }
    if (last < 0) {
      // Premier point exploitable : aucun indice cinématique disponible, on ne
      // lui reproche rien (section 4 : un point isolé n'est pas un point faux).
      retained.push(i);
      last = i;
      continue;
    }

    const d = haversineM(points[last], point);
    const dtS = (point.at - points[last].at) / 1000;
    stepM[i] = d;
    if (dtS <= 0) {
      // Même instant : soit un doublon exact, soit un déplacement en un temps
      // nul (ou un horodatage qui recule) — impossible dans les deux cas.
      flags[i].push(d <= DUPLICATE_MAX_M ? "duplicate" : "speed");
      continue;
    }

    const v = d / dtS;
    speedMs[i] = v;
    if (v < stillSpeedMs) flags[i].push("still");
    if (v > maxSpeedMs) flags[i].push("speed");
    const previousV = speedMs[last];
    if (previousV !== null && Math.abs(v - previousV) / dtS > maxAccelMs2) flags[i].push("acceleration");

    retained.push(i);
    chainSteps.push(d);
    chainIntervalsS.push(dtS);
    last = i;
  }

  // Passe 4 : indices qui demandent le point suivant de la chaîne (cap, isolement).
  // Les médianes servent d'échelle de référence : elles s'adaptent à la cadence
  // d'enregistrement (1 Hz en mode précis, 30 s en mode économie) sans réglage.
  const medianStepM = median(chainSteps);
  const medianIntervalS = median(chainIntervalsS);
  for (let k = 1; k < retained.length - 1; k++) {
    const i = retained[k];
    const previous = points[retained[k - 1]];
    const current = points[i];
    const next = points[retained[k + 1]];
    const dPrev = stepM[i] ?? 0;
    const dNext = stepM[retained[k + 1]] ?? 0;
    const dtPrevS = (current.at - previous.at) / 1000;
    const dtNextS = (next.at - current.at) / 1000;
    const v = speedMs[i];

    // Cap : un quasi-demi-tour ne s'improvise pas à vitesse élevée. On ne juge
    // que sur des intervalles courts, sinon le « cap » n'est qu'une moyenne.
    if (
      v !== null &&
      v >= HEADING_MIN_SPEED_FACTOR * maxSpeedMs &&
      dPrev > 0 &&
      dNext > 0 &&
      dtPrevS <= HEADING_MAX_INTERVAL_S &&
      dtNextS <= HEADING_MAX_INTERVAL_S
    ) {
      const course = bearing(previous, current);
      const nextCourse = bearing(current, next);
      const announced = current.heading;
      const courseBreak = Math.abs(headingDelta(course, nextCourse)) >= HEADING_MAX_DELTA_DEG;
      // Second indice : le récepteur annonce un cap opposé à la trajectoire réelle.
      const announcedBreak =
        announced !== null &&
        Number.isFinite(announced) &&
        Math.abs(headingDelta(announced, nextCourse)) >= HEADING_MAX_DELTA_DEG;
      if (courseBreak || announcedBreak) flags[i].push("heading");
    }

    // Isolement : écarté de ses deux voisins bien au-delà du pas habituel, sans
    // qu'un long intervalle d'enregistrement puisse l'expliquer.
    if (
      medianIntervalS > 0 &&
      dPrev > OUTLIER_STEP_FACTOR * medianStepM &&
      dNext > OUTLIER_STEP_FACTOR * medianStepM &&
      Math.min(dPrev, dNext) >= OUTLIER_MIN_JUMP_M &&
      dtPrevS <= OUTLIER_MAX_INTERVAL_FACTOR * medianIntervalS &&
      dtNextS <= OUTLIER_MAX_INTERVAL_FACTOR * medianIntervalS
    ) {
      flags[i].push("outlier");
    }
  }

  const scored: ScoredPoint[] = new Array<ScoredPoint>(n);
  for (let i = 0; i < n; i++) {
    let quality = valid[i] ? accuracyScore(announcedAccuracy(points[i]), maxAccuracyM) : 0;
    for (const flag of flags[i]) quality -= FLAG_PENALTY[flag];
    scored[i] = {
      ...points[i],
      quality: clampQuality(quality),
      flags: flags[i],
      observedSpeedMs: speedMs[i],
      stepM: stepM[i],
    };
  }
  return scored;
}

/**
 * Détection du « téléport » (section 6) : le relevé qui part à 120 m et revient
 * au relevé suivant alors que le marcheur avance à 5 km/h.
 *
 * Trois indices doivent converger, faute de quoi on ne touche à rien :
 *
 *  1. **écart franc** : l'excursion dépasse un plancher absolu et vaut plusieurs
 *     fois l'incertitude annoncée (sinon ce n'est que du bruit GPS) ;
 *  2. **aller-retour impossible** : la distance parcourue pour aller et revenir
 *     exige une vitesse supérieure à la vitesse plausible de l'activité ;
 *  3. **retour effectif** : soit géométriquement (l'écart aux deux voisins est
 *     `factor` fois plus grand que la distance qui les sépare), soit
 *     cinématiquement (les deux tronçons sont impossibles alors que le
 *     déplacement net des voisins, lui, reste plausible).
 *
 * Conséquence voulue : une descente VTT rectiligne à 12 m/s n'est jamais un
 * téléport (le déplacement net est aussi rapide que les tronçons), un lacet
 * enregistré toutes les minutes non plus (l'aller-retour est faisable à pied),
 * et le premier comme le dernier point ne sont jamais jugés (pas de voisin).
 */
function detectTeleports(
  points: readonly RawPoint[],
  valid: readonly boolean[],
  teleportFactor: number,
  maxSpeedMs: number,
): boolean[] {
  const n = points.length;
  const out: boolean[] = new Array<boolean>(n).fill(false);
  for (let i = 1; i < n - 1; i++) {
    if (!valid[i] || !valid[i - 1] || !valid[i + 1]) continue;
    const previous = points[i - 1];
    const current = points[i];
    const next = points[i + 1];
    const dPrev = haversineM(previous, current);
    const dNext = haversineM(current, next);
    const minSide = Math.min(dPrev, dNext);
    if (minSide < TELEPORT_MIN_JUMP_M) continue;

    const accuracyRef = Math.max(
      announcedAccuracy(previous) ?? ASSUMED_ACCURACY_M,
      announcedAccuracy(current) ?? ASSUMED_ACCURACY_M,
      announcedAccuracy(next) ?? ASSUMED_ACCURACY_M,
    );
    if (minSide <= teleportFactor * accuracyRef) continue;

    const dtPrevS = (current.at - previous.at) / 1000;
    const dtNextS = (next.at - current.at) / 1000;
    const dtTotalS = dtPrevS + dtNextS;
    // Horodatages nuls ou incohérents : l'aller-retour est de toute façon impossible.
    const roundTripMs = dtTotalS > 0 ? (dPrev + dNext) / dtTotalS : Infinity;
    if (roundTripMs <= maxSpeedMs) continue;

    const span = haversineM(previous, next);
    const returnsGeometrically = minSide > teleportFactor * span;
    const netSpeedMs = dtTotalS > 0 ? span / dtTotalS : Infinity;
    const returnsKinematically =
      dtPrevS > 0 &&
      dtNextS > 0 &&
      dPrev / dtPrevS > maxSpeedMs &&
      dNext / dtNextS > maxSpeedMs &&
      netSpeedMs <= maxSpeedMs;
    if (returnsGeometrically || returnsKinematically) out[i] = true;
  }
  return out;
}

/**
 * Points exploitables pour la géométrie (map matching, corridors, distances).
 *
 * Le filtre ne porte que sur le score : les points marqués `still` restent
 * valides (ils disent où l'on était), c'est au consommateur qui reconstruit une
 * géométrie de les écarter s'ils ne lui servent pas.
 */
export function usablePoints(
  points: readonly ScoredPoint[],
  minQuality: PointQuality = MIN_USABLE_QUALITY,
): ScoredPoint[] {
  return points.filter((p) => p.quality >= minQuality);
}

/**
 * Bilan d'une trace notée : sert à décider si une activité mérite de contribuer
 * aux statistiques collectives (section 4 — mieux vaut ne rien publier qu'une
 * fausse précision).
 *
 * La **médiane** de précision est préférée à la moyenne : quelques relevés
 * catastrophiques en gorge ne doivent pas condamner une trace par ailleurs
 * propre. `averageQuality` est arrondie au centième (c'est un indicateur, pas
 * une mesure). Trace vide → `medianAccuracyM` nul et moyenne 0, jamais NaN.
 */
export function traceQuality(points: readonly ScoredPoint[]): {
  total: number;
  usable: number;
  medianAccuracyM: number | null;
  averageQuality: number;
  flagged: Record<PointFlag, number>;
} {
  const flagged: Record<PointFlag, number> = {
    accuracy: 0,
    teleport: 0,
    speed: 0,
    acceleration: 0,
    heading: 0,
    duplicate: 0,
    outlier: 0,
    still: 0,
  };
  const accuracies: number[] = [];
  let sum = 0;
  let usable = 0;
  for (const point of points) {
    sum += point.quality;
    if (point.quality >= MIN_USABLE_QUALITY) usable += 1;
    const accuracy = announcedAccuracy(point);
    if (accuracy !== null) accuracies.push(accuracy);
    for (const flag of point.flags) {
      // Garde-fou : un motif inconnu (donnée désérialisée) ne crée pas de clé.
      if (Object.hasOwn(flagged, flag)) flagged[flag] += 1;
    }
  }
  const total = points.length;
  return {
    total,
    usable,
    medianAccuracyM: accuracies.length > 0 ? median(accuracies) : null,
    averageQuality: total > 0 ? Math.round((sum / total) * 100) / 100 : 0,
    flagged,
  };
}
