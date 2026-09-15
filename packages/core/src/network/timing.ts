/**
 * Temps de parcours d'un segment (moteur cartographique collectif).
 *
 * Sections couvertes :
 *
 *  - **16. Profil physique d'un segment** : `segmentProfile` extrait de la
 *    géométrie et des altitudes ce qui détermine l'effort — distance, D+, D-,
 *    pente moyenne *signée*, pente maximale. Quand les altitudes manquent, les
 *    dénivelés valent 0 et les pentes 0 : on ne fabrique jamais un dénivelé
 *    plausible pour « faire joli », un chemin sans altimétrie est un chemin
 *    dont on ne connaît pas le dénivelé.
 *  - **14. Temps théorique** : `theoreticalTimeMs` applique un modèle de type
 *    Tobler / Naismith (base plate + majoration à la montée + pénalité de
 *    descente raide) corrigé par le terrain (revêtement, difficulté alpine,
 *    nature du chemin selon l'activité).
 *  - **13 et 25. Du théorique à l'observé** : `estimateTime` part du temps
 *    théorique et donne un poids croissant à la médiane observée au fur et à
 *    mesure que les passages s'accumulent. Un seul passage ne remplace pas un
 *    modèle ; cinquante, oui.
 *  - **24. Rythme personnel** : `personalPaceFactor` mesure, sur plusieurs
 *    segments déjà parcourus, le rapport médian entre le temps de
 *    l'utilisateur et celui de la communauté — borné, pour qu'une sortie
 *    atypique (pique-nique au lac) ne déforme pas toutes ses estimations.
 *  - **26. Ne pas promettre plus que ce que l'on sait** : `timeConfidence`
 *    combine nombre de passages *et* dispersion, et `describeEstimate`
 *    arrondit la durée affichée à la maille correspondante. Deux observations
 *    ne donnent jamais « 2 h 07 ».
 *  - **41. Restitution** : `formatTimeConfidence` et `describeEstimate`
 *    fournissent les libellés français utilisés par les itinéraires.
 *
 * Module pur : aucune notion de « maintenant » (une durée ne dépend pas de
 * l'heure qu'il est), aucun aléa, aucune mutation des entrées. Coût : O(n) sur
 * la géométrie du segment pour le profil, O(n log n) pour la seule médiane du
 * rythme personnel — rien de quadratique, les profils étant recalculés sur des
 * réseaux de dizaines de milliers de sommets.
 */
import { cumulativeDistances } from "../navigation/geometry";
import { CLIMB_MS_PER_M, DEFAULT_SPEED_MS, formatDurationShort } from "../navigation/eta";
import { elevationGain } from "../navigation/route";
import type { ActivityMode, PathKind, PathSegment } from "../navigation/types";
import type { DurationStats, SegmentProfile, TimeConfidence, TimeEstimate, TraversalDirection } from "./types";

/* ------------------------------------------------------------------ */
/* 1. Réglages produit : profil physique (section 16)                   */
/* ------------------------------------------------------------------ */

/**
 * Hystérésis (m) des dénivelés d'un segment.
 *
 * Plus faible que celle d'une trace GPS (5 m dans navigation/route, où
 * l'altitude barométrique tremble) : un profil de segment vient d'un modèle de
 * terrain ou d'une moyenne de traces, beaucoup plus lisse. 3 m filtre encore
 * les marches du MNT (±1 à 2 m) sans effacer les ressauts réels d'un sentier
 * échantillonné tous les 20 à 50 m.
 */
export const SEGMENT_ELEVATION_HYSTERESIS_M = 3;

/**
 * Longueur minimale (m) sur laquelle une pente est calculée.
 *
 * Sur deux sommets distants de 2 m, une erreur d'altitude de 3 m donnerait une
 * pente de 150 % : la pente n'a de sens que sur une base assez longue. Les
 * sommets trop rapprochés sont donc cumulés jusqu'à atteindre ce pas.
 */
export const MIN_SLOPE_SPAN_M = 10;

/**
 * Pente maximale (%) considérée comme physiquement possible sur un chemin.
 *
 * 200 % ≈ 63° : au-delà, ce n'est plus un sentier mais une erreur
 * d'altimétrie. La valeur est bornée plutôt qu'écartée : l'information « très
 * raide » reste vraie, seule l'absurdité numérique est coupée.
 */
export const MAX_PLAUSIBLE_SLOPE_PCT = 200;

/* ------------------------------------------------------------------ */
/* 2. Réglages produit : modèle de temps (section 14)                   */
/* ------------------------------------------------------------------ */

/**
 * Temps (ms) ajouté par mètre de dénivelé *négatif*, à pleine sévérité.
 *
 * Complément descendant de `CLIMB_MS_PER_M` : une descente raide ne fait pas
 * gagner du temps, elle en coûte (freinage, appuis, genoux). Repère de
 * Naismith corrigé (Aitken) : ~10 min par 300 m de descente très raide à pied,
 * soit ~1 h pour 1 000 m. Le traileur descend mieux, le VTT en fait un terrain
 * de jeu (surtout pénalisé par la technique, prise en compte par le terrain),
 * le cheval descend au pas, très prudemment.
 */
export const DESCENT_MS_PER_M: Record<ActivityMode, number> = {
  hiking: 3600_000 / 1000,
  trail: 3600_000 / 1500,
  mtb: 3600_000 / 2000,
  equestrian: 3600_000 / 800,
  other: 3600_000 / 1000,
};

/** Pente (%) à partir de laquelle une descente commence à ralentir. */
export const STEEP_DESCENT_START_PCT = -20;

/** Pente (%) à partir de laquelle la pénalité de descente est totale. */
export const STEEP_DESCENT_FULL_PCT = -40;

/**
 * Multiplicateur de temps par revêtement (OSM `surface`).
 *
 * Roulant sous 1, cassant au-dessus. L'échelle est volontairement resserrée
 * (0,95 à 1,35) : le revêtement module l'allure, il ne la double pas — c'est la
 * pente et la difficulté alpine qui font les grands écarts. Une valeur inconnue
 * vaut `DEFAULT_SURFACE_FACTOR` : on ne pénalise pas un chemin parce que
 * personne n'a renseigné son revêtement.
 */
export const SURFACE_FACTORS: Record<string, number> = {
  paved: 0.95,
  asphalt: 0.95,
  concrete: 0.95,
  paving_stones: 1,
  compacted: 0.98,
  fine_gravel: 1,
  gravel: 1,
  pebblestone: 1.12,
  dirt: 1.02,
  ground: 1.05,
  earth: 1.05,
  grass: 1.08,
  sand: 1.2,
  mud: 1.3,
  scree: 1.3,
  rock: 1.35,
  stone: 1.25,
};

/** Facteur retenu quand le revêtement est inconnu ou non répertorié. */
export const DEFAULT_SURFACE_FACTOR = 1;

/**
 * Multiplicateur de temps par difficulté alpine (OSM `sac_scale`).
 *
 * T1 (`hiking`) est la référence. À partir de T2 le terrain impose de regarder
 * où l'on met les pieds, T3 de poser les mains par endroits, T4 et au-delà de
 * progresser en terrain d'alpinisme : le temps par kilomètre s'envole bien plus
 * vite que la difficulté ressentie, d'où une échelle qui va jusqu'à ×2.
 */
export const SAC_SCALE_FACTORS: Record<string, number> = {
  hiking: 1,
  mountain_hiking: 1.12,
  demanding_mountain_hiking: 1.3,
  alpine_hiking: 1.55,
  demanding_alpine_hiking: 1.8,
  difficult_alpine_hiking: 2.05,
};

/** Facteur retenu quand la difficulté alpine est inconnue. */
export const DEFAULT_SAC_FACTOR = 1;

/**
 * Multiplicateur de temps par nature de chemin *et* par activité.
 *
 * C'est ici que l'activité change tout : des escaliers se montent à pied à
 * peine plus lentement qu'un sentier, mais se franchissent vélo sur l'épaule
 * (×4) et à peu près pas à cheval (×5) ; une via ferrata se parcourt à pied à
 * une allure d'escalade (×2,5) et n'a aucun sens pour les deux autres. Ces
 * facteurs ne remplacent pas l'interdiction de passage
 * (`isSegmentAllowed` dans navigation/graph) : ils disent le coût quand le
 * passage est possible. À l'inverse, une route ou une piste sont plus roulantes
 * que le sentier de référence, surtout à VTT.
 */
export const KIND_FACTORS: Partial<Record<PathKind, Partial<Record<ActivityMode, number>>>> = {
  steps: { hiking: 1.2, trail: 1.25, mtb: 4, equestrian: 5, other: 1.3 },
  via_ferrata: { hiking: 2.5, trail: 2.5, mtb: 6, equestrian: 6, other: 2.5 },
  road: { hiking: 0.95, trail: 0.95, mtb: 0.85, equestrian: 0.95, other: 0.95 },
  track: { mtb: 0.95 },
};

/* ------------------------------------------------------------------ */
/* 3. Réglages produit : théorique → observé (sections 25, 26, 24)      */
/* ------------------------------------------------------------------ */

/**
 * Nombre de passages donnant la moitié du poids aux observations (section 25).
 *
 * Poids observé = n / (n + `DEFAULT_MIN_SAMPLES_FOR_OBSERVED`) : 1 passage
 * ≈ 17 %, 5 passages 50 %, 50 passages ≈ 91 %. La courbe est douce au début
 * (un passage isolé peut être un pique-nique) et ne sature jamais tout à fait :
 * le modèle théorique garde toujours un peu de voix.
 */
export const DEFAULT_MIN_SAMPLES_FOR_OBSERVED = 5;

/** Nombre de passages sous lequel aucune confiance n'est possible (section 26). */
export const CONFIDENCE_MIN_SAMPLES = 3;

/** Nombre de passages au-delà duquel l'effectif ne fait plus progresser la confiance. */
export const CONFIDENCE_FULL_SAMPLES = 50;

/**
 * Dispersion (écart interquartile / médiane) annulant toute confiance.
 *
 * Même valeur que l'agrégateur statistique : un IQR égal à la médiane signifie
 * que la moitié centrale des passages va du simple au double. Aucun effectif,
 * même 500 passages, ne rend une telle distribution prédictive.
 */
export const SPREAD_REFERENCE = 1;

/** Score (0..1) minimal de chaque niveau de confiance, du plus fort au plus faible. */
export const CONFIDENCE_THRESHOLDS: readonly { minScore: number; level: TimeConfidence }[] = [
  { minScore: 0.75, level: "very_high" },
  { minScore: 0.55, level: "high" },
  { minScore: 0.35, level: "medium" },
  { minScore: 0.18, level: "low" },
];

/**
 * Plafond de confiance imposé par le seul effectif (section 26).
 *
 * Même parfaitement regroupées, quatre durées ne valent pas mieux que
 * « faible » : la régularité d'un tout petit échantillon est souvent un hasard.
 * Le niveau final est le minimum entre ce plafond et le niveau calculé.
 */
export const CONFIDENCE_SAMPLE_CAPS: readonly { minSamples: number; max: TimeConfidence }[] = [
  { minSamples: 25, max: "very_high" },
  { minSamples: 10, max: "high" },
  { minSamples: 5, max: "medium" },
  { minSamples: CONFIDENCE_MIN_SAMPLES, max: "low" },
];

/** Ordre des niveaux de confiance (utile pour prendre le minimum sur un itinéraire). */
export const TIME_CONFIDENCE_RANK: Record<TimeConfidence, number> = {
  very_low: 0,
  low: 1,
  medium: 2,
  high: 3,
  very_high: 4,
};

/** Libellés français des niveaux de confiance (section 41). */
export const TIME_CONFIDENCE_LABELS: Record<TimeConfidence, string> = {
  very_low: "Très faible",
  low: "Faible",
  medium: "Moyenne",
  high: "Élevée",
  very_high: "Très élevée",
};

/**
 * Maille d'arrondi (ms) de la durée affichée, par niveau de confiance
 * (section 26). Annoncer « 2 h 07 » avec trois passages serait mentir sur la
 * précision ; « 2 h 15 » est aussi utile et honnête.
 */
export const ESTIMATE_ROUNDING_MS: Record<TimeConfidence, number> = {
  very_low: 15 * 60_000,
  low: 10 * 60_000,
  medium: 5 * 60_000,
  high: 5 * 60_000,
  very_high: 60_000,
};

/**
 * Part maximale de la durée que l'arrondi peut absorber.
 *
 * Une maille qui dépasserait la moitié de la durée n'arrondirait plus, elle
 * inventerait : sur une liaison de 4 minutes, « 15 min » est une erreur, pas
 * une précaution. Dans ce cas la durée retombe à la minute.
 */
export const ESTIMATE_ROUNDING_MAX_SHARE = 0.5;

/** Nombre minimal de segments comparés pour oser un rythme personnel (section 24). */
export const PERSONAL_MIN_SAMPLES = 5;

/**
 * Écart maximal du facteur personnel : ±40 %.
 *
 * Personne n'est trois fois plus rapide que la communauté ; un tel rapport
 * traduit une erreur de mesure ou un usage particulier. Borner protège
 * l'utilisateur de ses propres données atypiques.
 */
export const PERSONAL_FACTOR_MAX_DEVIATION = 0.4;

/**
 * Rapports individuels retenus dans le calcul du rythme personnel.
 *
 * En dehors de [0,25 ; 4], le passage ne dit plus rien d'une allure : il y a eu
 * une pause longue, un arrêt secours, ou un horodatage faux. La médiane
 * absorberait le cas, mais l'écarter évite aussi de le compter comme
 * « échantillon ».
 */
export const PERSONAL_RATIO_MIN = 0.25;
export const PERSONAL_RATIO_MAX = 4;

/* ------------------------------------------------------------------ */
/* 4. Utilitaires internes                                              */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);
const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
/** Valeur positive exploitable, 0 sinon (NaN, Infinity, négatif). */
const positive = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Médiane interne (tri O(n log n), interpolation entre les deux valeurs
 * centrales). Le module reste autonome : le rythme personnel se calcule côté
 * client, sans l'agrégateur statistique serveur.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (mid - lo);
}

/**
 * Statistiques de durée réellement exploitables, ou null.
 * Un objet à zéro passage ou à médiane nulle n'est pas une observation.
 */
function usableDuration(stats: DurationStats | null): DurationStats | null {
  if (stats === null) return null;
  if (!Number.isFinite(stats.count) || stats.count < 1) return null;
  if (!Number.isFinite(stats.medianMs) || stats.medianMs <= 0) return null;
  return stats;
}

/** Altitudes utilisables : alignées sur la géométrie, sinon inconnues. */
function usableElevations(segment: PathSegment): readonly number[] | null {
  const elevations = segment.elevations;
  if (elevations === null) return null;
  // Un tableau désaligné ne peut pas être rattaché aux sommets : l'ignorer est
  // plus honnête que d'inventer une correspondance.
  if (elevations.length !== segment.coordinates.length) return null;
  return elevations;
}

/* ------------------------------------------------------------------ */
/* 5. Profil physique d'un segment (section 16)                         */
/* ------------------------------------------------------------------ */

/**
 * Profil d'un segment dans un sens donné.
 *
 * La distance vient de la géométrie (haversine, comme le reste du moteur) ;
 * `segment.lengthM` ne sert que de secours pour un segment sans géométrie
 * exploitable (import incomplet).
 *
 * La pente moyenne est **signée** : c'est le rapport entre la différence
 * d'altitude des deux extrémités et la distance qui les sépare — et non
 * (D+ − D−)/distance, qui gonflerait la pente d'un profil en dents de scie.
 * La pente maximale est absolue (le contrat ne dit pas son sens), mesurée sur
 * des bases d'au moins `MIN_SLOPE_SPAN_M`.
 *
 * En sens inverse, seule la lecture change : la distance est la même, D+ et D−
 * s'échangent, la pente moyenne change de signe, la pente maximale (absolue)
 * est inchangée.
 */
export function segmentProfile(segment: PathSegment, direction: TraversalDirection = "forward"): SegmentProfile {
  const coords = segment.coordinates;
  const cumulative = cumulativeDistances(coords);
  const geometryM = coords.length >= 2 ? cumulative[cumulative.length - 1] : 0;
  const distanceM = geometryM > 0 ? geometryM : positive(segment.lengthM);
  const elevations = usableElevations(segment);

  let gain = 0;
  let loss = 0;
  let averageSlope = 0;
  let maxSlope = 0;

  if (elevations !== null) {
    // Hystérésis partagée avec le reste du moteur : les micro-oscillations du
    // MNT ne sont pas du dénivelé.
    const relief = elevationGain(elevations, 0, elevations.length - 1, SEGMENT_ELEVATION_HYSTERESIS_M);
    gain = relief.gain;
    loss = relief.loss;

    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < elevations.length; i++) {
      if (!Number.isFinite(elevations[i])) continue;
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
    if (firstIdx !== -1 && lastIdx > firstIdx) {
      const span = cumulative[lastIdx] - cumulative[firstIdx];
      if (span > 0) {
        averageSlope = clamp(
          ((elevations[lastIdx] - elevations[firstIdx]) / span) * 100,
          -MAX_PLAUSIBLE_SLOPE_PCT,
          MAX_PLAUSIBLE_SLOPE_PCT,
        );
      }
    }

    // Pente maximale : un seul passage O(n), les sommets trop rapprochés étant
    // cumulés jusqu'à `MIN_SLOPE_SPAN_M` (voir la constante).
    let refIdx = firstIdx;
    if (refIdx !== -1) {
      for (let i = refIdx + 1; i < elevations.length; i++) {
        if (!Number.isFinite(elevations[i])) continue;
        const span = cumulative[i] - cumulative[refIdx];
        if (span < MIN_SLOPE_SPAN_M) continue;
        const slope = Math.abs(((elevations[i] - elevations[refIdx]) / span) * 100);
        if (slope > maxSlope) maxSlope = Math.min(slope, MAX_PLAUSIBLE_SLOPE_PCT);
        refIdx = i;
      }
    }
  }

  const backward = direction === "backward";
  return {
    distanceM: round(distanceM, 1),
    elevationGainM: round(backward ? loss : gain, 1),
    elevationLossM: round(backward ? gain : loss, 1),
    averageSlope: round(backward ? -averageSlope : averageSlope, 2),
    maxSlope: round(maxSlope, 2),
    surface: segment.surface,
    sacScale: segment.sacScale,
    kind: segment.kind,
  };
}

/* ------------------------------------------------------------------ */
/* 6. Temps théorique (section 14)                                      */
/* ------------------------------------------------------------------ */

/**
 * Sévérité (0..1) de la pénalité de descente en fonction de la pente moyenne.
 *
 * Nulle jusqu'à `STEEP_DESCENT_START_PCT` (une descente douce est le terrain le
 * plus rapide qui soit), puis montée linéaire jusqu'à
 * `STEEP_DESCENT_FULL_PCT`. Seule la pente *moyenne* peut servir ici : la pente
 * maximale du contrat est absolue, donc son sens est inconnu — elle pourrait
 * aussi bien décrire un raidillon en montée.
 */
export function steepDescentSeverity(averageSlope: number): number {
  if (!Number.isFinite(averageSlope) || averageSlope >= STEEP_DESCENT_START_PCT) return 0;
  const range = STEEP_DESCENT_START_PCT - STEEP_DESCENT_FULL_PCT;
  if (range <= 0) return 1;
  return clamp01((STEEP_DESCENT_START_PCT - averageSlope) / range);
}

/**
 * Facteur de ralentissement dû au terrain : revêtement × difficulté alpine ×
 * nature du chemin pour l'activité. Les trois se cumulent parce qu'ils décrivent
 * des gênes différentes (adhérence, engagement, praticabilité).
 */
export function terrainSlowdownFactor(profile: SegmentProfile, activity: ActivityMode): number {
  const surfaceKey = profile.surface === null ? null : profile.surface.trim().toLowerCase();
  const surface = surfaceKey !== null ? (SURFACE_FACTORS[surfaceKey] ?? DEFAULT_SURFACE_FACTOR) : DEFAULT_SURFACE_FACTOR;
  const sacKey = profile.sacScale === null ? null : profile.sacScale.trim().toLowerCase();
  const sac = sacKey !== null ? (SAC_SCALE_FACTORS[sacKey] ?? DEFAULT_SAC_FACTOR) : DEFAULT_SAC_FACTOR;
  const kind = KIND_FACTORS[profile.kind]?.[activity] ?? 1;
  return surface * sac * kind;
}

/**
 * Temps théorique (ms) de parcours d'un segment pour une activité.
 *
 * base plate + montée (Naismith) + descente raide, le tout multiplié par le
 * terrain. Le terrain multiplie l'ensemble et non la seule base : un pierrier
 * en dévers ralentit aussi bien la montée que le plat.
 *
 * Aucune donnée exploitable (distance nulle) → 0 ms : un segment sans longueur
 * ne coûte rien, et surtout pas une durée inventée.
 */
export function theoreticalTimeMs(profile: SegmentProfile, activity: ActivityMode): number {
  const distanceM = positive(profile.distanceM);
  const speedMs = DEFAULT_SPEED_MS[activity];
  if (distanceM === 0 || !(speedMs > 0)) return 0;
  const flatMs = (distanceM / speedMs) * 1000;
  const climbMs = positive(profile.elevationGainM) * CLIMB_MS_PER_M[activity];
  const descentMs = positive(profile.elevationLossM) * DESCENT_MS_PER_M[activity] * steepDescentSeverity(profile.averageSlope);
  return Math.round((flatMs + climbMs + descentMs) * terrainSlowdownFactor(profile, activity));
}

/* ------------------------------------------------------------------ */
/* 7. Estimation mêlant théorique et observé (sections 24, 25)          */
/* ------------------------------------------------------------------ */

export interface EstimateInput {
  theoreticalMs: number;
  observed: DurationStats | null;
  /** Rythme personnel (section 24), 1 = neutre. Absent ou nul = non appliqué. */
  personalFactor?: number | null;
  /** Passages donnant 50 % du poids aux observations. Défaut 5. */
  minSamplesForObserved?: number;
}

/** Facteur personnel réellement applicable (borné), ou null. */
function normalizePersonalFactor(factor: number | null | undefined): number | null {
  if (factor === null || factor === undefined) return null;
  if (!Number.isFinite(factor) || factor <= 0) return null;
  return round(clamp(factor, 1 - PERSONAL_FACTOR_MAX_DEVIATION, 1 + PERSONAL_FACTOR_MAX_DEVIATION), 3);
}

/**
 * Durée estimée d'un segment (section 25).
 *
 * Le temps théorique est le point de départ : il existe dès qu'un chemin est
 * cartographié, avant tout passage. Chaque passage observé lui prend un peu de
 * poids, selon n / (n + `minSamplesForObserved`) — jamais d'un coup, jamais
 * totalement. Le mélange porte sur la **médiane** observée : la moyenne
 * basculerait dès qu'un utilisateur oublie d'arrêter son enregistrement.
 *
 * Le rythme personnel s'applique en dernier, sur le mélange : il corrige
 * l'allure de la personne, pas la nature du chemin.
 */
export function estimateTime(input: EstimateInput): TimeEstimate {
  const theoreticalMs = Math.max(0, Number.isFinite(input.theoreticalMs) ? Math.round(input.theoreticalMs) : 0);
  const requested = input.minSamplesForObserved;
  const minSamples =
    requested !== undefined && Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_MIN_SAMPLES_FOR_OBSERVED;

  const observed = usableDuration(input.observed);
  const samples = observed === null ? 0 : observed.count;
  const observedMs = observed === null ? null : observed.medianMs;
  const observedWeight = observed === null ? 0 : round(samples / (samples + minSamples), 4);
  const blendedMs = observedMs === null ? theoreticalMs : observedWeight * observedMs + (1 - observedWeight) * theoreticalMs;
  const personalFactor = normalizePersonalFactor(input.personalFactor);

  return {
    ms: Math.max(0, Math.round(blendedMs * (personalFactor ?? 1))),
    observedWeight,
    theoreticalMs,
    observedMs,
    samples,
    confidence: timeConfidence(observed),
    personalFactor,
  };
}

/* ------------------------------------------------------------------ */
/* 8. Confiance (section 26)                                            */
/* ------------------------------------------------------------------ */

/** Niveau correspondant à un score 0..1. */
function levelFromScore(score: number): TimeConfidence {
  for (const tier of CONFIDENCE_THRESHOLDS) {
    if (score >= tier.minScore) return tier.level;
  }
  return "very_low";
}

/** Plafond imposé par le seul effectif. */
function capFromSamples(samples: number): TimeConfidence {
  for (const cap of CONFIDENCE_SAMPLE_CAPS) {
    if (samples >= cap.minSamples) return cap.max;
  }
  return "very_low";
}

/**
 * Confiance accordée à une durée observée.
 *
 * Deux conditions, toutes deux nécessaires : assez de passages (croissance
 * logarithmique, saturée à `CONFIDENCE_FULL_SAMPLES`) et des durées
 * resserrées. Le produit des deux scores fait qu'une distribution très
 * dispersée (IQR ≥ médiane) reste « très faible » même avec des centaines de
 * passages : un chemin où l'on met entre 1 h et 3 h n'a pas de durée
 * prévisible, quel que soit le nombre de témoins. Le plafond par effectif
 * (`CONFIDENCE_SAMPLE_CAPS`) interdit en plus d'afficher une confiance élevée
 * sur trois ou quatre passages bien groupés.
 */
export function timeConfidence(observed: DurationStats | null): TimeConfidence {
  const stats = usableDuration(observed);
  if (stats === null || stats.count < CONFIDENCE_MIN_SAMPLES) return "very_low";
  const countScore = clamp01(Math.log1p(stats.count) / Math.log1p(CONFIDENCE_FULL_SAMPLES));
  // Dispersion inconnue ou absurde : traitée comme la pire, on ne suppose pas
  // la régularité.
  const spread = Number.isFinite(stats.spread) && stats.spread >= 0 ? stats.spread : SPREAD_REFERENCE;
  const spreadScore = clamp01(1 - spread / SPREAD_REFERENCE);
  const level = levelFromScore(countScore * spreadScore);
  const cap = capFromSamples(stats.count);
  return TIME_CONFIDENCE_RANK[level] <= TIME_CONFIDENCE_RANK[cap] ? level : cap;
}

/* ------------------------------------------------------------------ */
/* 9. Rythme personnel (section 24)                                     */
/* ------------------------------------------------------------------ */

/**
 * Facteur d'allure personnel : rapport médian entre les temps de l'utilisateur
 * et les temps de référence de la communauté.
 *
 * Médiane et non moyenne (une sortie contemplative ne doit pas rendre
 * l'utilisateur « lent » pour toujours), rapports individuels aberrants
 * écartés, résultat borné à ±`maxDeviation`. Sous `minSamples` segments
 * comparables, le résultat est `null` : mieux vaut pas d'ajustement qu'un
 * ajustement tiré de deux sorties.
 */
export function personalPaceFactor(
  samples: readonly { observedMs: number; referenceMs: number }[],
  opts: { minSamples?: number; maxDeviation?: number } = {},
): { factor: number; samples: number } | null {
  const minSamples =
    opts.minSamples !== undefined && Number.isFinite(opts.minSamples) && opts.minSamples >= 1
      ? Math.round(opts.minSamples)
      : PERSONAL_MIN_SAMPLES;
  const maxDeviation =
    opts.maxDeviation !== undefined && Number.isFinite(opts.maxDeviation) && opts.maxDeviation >= 0
      ? Math.min(opts.maxDeviation, 1)
      : PERSONAL_FACTOR_MAX_DEVIATION;

  const ratios: number[] = [];
  for (const sample of samples) {
    const observed = positive(sample.observedMs);
    const reference = positive(sample.referenceMs);
    if (observed === 0 || reference === 0) continue;
    const ratio = observed / reference;
    if (ratio < PERSONAL_RATIO_MIN || ratio > PERSONAL_RATIO_MAX) continue;
    ratios.push(ratio);
  }
  if (ratios.length < minSamples) return null;

  const factor = round(clamp(median(ratios), 1 - maxDeviation, 1 + maxDeviation), 3);
  return { factor, samples: ratios.length };
}

/* ------------------------------------------------------------------ */
/* 10. Restitution (sections 26 et 41)                                  */
/* ------------------------------------------------------------------ */

/** Libellé français d'un niveau de confiance : « Très élevée », « Faible »… */
export function formatTimeConfidence(level: TimeConfidence): string {
  return TIME_CONFIDENCE_LABELS[level];
}

/**
 * Durée arrondie à la maille autorisée par la confiance (section 26).
 *
 * La maille du niveau s'applique tant qu'elle reste proportionnée à la durée
 * (`ESTIMATE_ROUNDING_MAX_SHARE`) ; sinon on se contente de la minute.
 * L'arrondi ne descend jamais sous une maille : « 0 min » n'est pas une durée.
 */
export function roundEstimateMs(ms: number, level: TimeConfidence): number {
  const value = positive(ms);
  if (value === 0) return 0;
  const step = ESTIMATE_ROUNDING_MS[level];
  const effective = step > 0 && step <= value * ESTIMATE_ROUNDING_MAX_SHARE ? step : 60_000;
  return Math.max(effective, Math.round(value / effective) * effective);
}

/**
 * Phrase complète d'une estimation : « 2 h 15, basé sur 486 passages,
 * confiance très élevée ». Sans observation, la phrase le dit — elle ne laisse
 * jamais croire que la durée vient du terrain.
 */
export function describeEstimate(estimate: TimeEstimate): string {
  const duration = formatDurationShort(roundEstimateMs(estimate.ms, estimate.confidence));
  const origin =
    estimate.samples <= 0
      ? "estimation théorique"
      : `basé sur ${estimate.samples} passage${estimate.samples > 1 ? "s" : ""}`;
  return `${duration}, ${origin}, confiance ${formatTimeConfidence(estimate.confidence).toLowerCase()}`;
}
