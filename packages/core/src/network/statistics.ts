/**
 * Statistiques collectives par segment : « comment ce chemin est réellement
 * parcouru », à partir des passages anonymisés produits par `traversals.ts`.
 *
 * Sections du cahier des charges « moteur cartographique » couvertes ici :
 *
 *  - **9. Mesurer les passages sans les compter deux fois** : comptages par
 *    fenêtre glissante, utilisateurs distincts, et surtout *sessions*
 *    distinctes — un aller-retour dans la même sortie est une seule sortie,
 *    pas deux passages de deux personnes.
 *  - **10. Dire la fréquentation en français** : `describeFrequentation`
 *    produit la phrase affichable (« Très fréquenté par les randonneurs »).
 *  - **11. Indice contextuel** : le niveau vient du score, jamais d'un seuil
 *    brut de passages — un sentier de Bavella et une piste périurbaine n'ont
 *    pas la même échelle.
 *  - **13, 14, 15. Temps par segment, par activité, par sens** : la *médiane*
 *    est privilégiée (une pause casse-croûte ne doit pas déplacer la
 *    référence), avec p25/p75 pour dire la dispersion. La clé d'agrégation
 *    porte l'activité et le sens : monter la Restonica et la descendre ne
 *    prennent pas le même temps.
 *  - **26. Dire la fiabilité** : chaque agrégat porte une `confidence` 0..1,
 *    fonction du volume, de la diversité des contributeurs, de la fraîcheur,
 *    de la qualité du rattachement et de la dispersion des durées.
 *  - **30. Chemin peut-être abandonné** : `possiblyInactive` est un *signal*
 *    à vérifier, jamais une conclusion — un chemin peut n'avoir aucun passage
 *    simplement parce que personne n'y enregistre d'activité.
 *  - **31. Saisonnalité et horaires** : répartition par mois et par heure.
 *  - **32, 42. Popularité pondérée par la fraîcheur** : 200 passages de 2019
 *    ne disent pas la même chose que 40 passages du mois dernier.
 *  - **43. Absence de données ≠ absence de chemin** : sous le seuil
 *    d'observations ou sous `K_ANONYMITY_MIN` contributeurs, le niveau de
 *    fréquentation devient `unknown` et `insufficientData` passe à vrai. Les
 *    comptages restent exacts : c'est la couche de publication (dto/API) qui
 *    décide ce qu'elle expose, ce module ne ment pas sur ce qu'il a vu.
 *
 * Module pur : aucune horloge implicite (l'instant de référence est toujours
 * `opts.now`, dont le défaut explicite est `Date.now()`), aucun aléa, aucune
 * mutation des entrées. Coût : une passe linéaire sur les observations, plus
 * un tri des durées (médiane) et un tri des horodatages par contributeur
 * (sessions) — jamais de comparaison deux à deux.
 */
import { ACTIVITY_MODES, type ActivityMode } from "../navigation/types";
import {
  K_ANONYMITY_MIN,
  type DurationStats,
  type FrequentationLevel,
  type SegmentStatistics,
  type StatisticsKey,
  type TraversalObservation,
  type WindowCounts,
} from "./types";

/* ------------------------------------------------------------------ */
/* Réglages produit (seuils documentés, pas des nombres perdus)        */
/* ------------------------------------------------------------------ */

/** Un jour en millisecondes (interne : `DAY_MS` est déjà exporté par `time.ts`). */
const DAY = 86_400_000;

/**
 * Demi-vie de la pondération temporelle (section 42), en jours.
 *
 * 180 jours = une saison de montagne : un passage de l'été dernier pèse encore
 * la moitié d'un passage d'aujourd'hui, un passage d'il y a trois ans ne pèse
 * plus rien. C'est le bon ordre de grandeur pour un usage saisonnier, sans
 * effacer un chemin parcouru seulement en été.
 */
export const POPULARITY_HALF_LIFE_DAYS = 180;

/**
 * Volume de référence du score de popularité : 40 passages *récents* (poids de
 * fraîcheur ≈ 1) suffisent à saturer l'échelle. Sur un sentier de montagne,
 * 40 passages enregistrés en quelques mois désignent déjà une voie très
 * empruntée : au-delà, la différence n'a plus de sens produit.
 */
export const POPULARITY_REFERENCE_WEIGHT = 40;

/**
 * Nombre minimal de passages avant de conclure quoi que ce soit (section 43).
 * En dessous, une médiane ou un indice de fréquentation serait du bruit.
 */
export const STATISTICS_MIN_OBSERVATIONS = 5;

/**
 * Délai au-delà duquel un même contributeur qui repasse est compté comme une
 * nouvelle sortie (section 9). 6 h couvre largement un aller-retour à la
 * journée (Grotelle → lac de Melo → Grotelle) sans fusionner deux sorties de
 * deux week-ends différents.
 */
export const SESSION_GAP_MS = 6 * 3_600_000;

/**
 * Couverture au-delà de laquelle un passage est considéré comme complet.
 * Entre 0,8 et 1, l'extrapolation corrigerait moins de bruit qu'elle n'en
 * ajouterait (les bornes du segment sont elles-mêmes interpolées) : la durée
 * est prise telle quelle.
 */
export const DURATION_FULL_COVERAGE = 0.8;

/**
 * Couverture minimale d'un passage pour alimenter les durées. Extrapoler une
 * portion de 15 % du segment au segment entier (× 6,7) ne mesure plus rien :
 * ces passages comptent comme fréquentation, pas comme temps de parcours.
 */
export const MIN_COVERAGE_FOR_DURATION = 0.2;

/** Nombre de mois distincts au-delà duquel la régularité est jugée maximale. */
export const REGULARITY_MONTHS_FULL = 12;

/** Bonus maximal de régularité sur le score de popularité (+25 %). */
export const REGULARITY_BONUS_MAX = 0.25;

/** Nombre de contributeurs distincts au-delà duquel la diversité est maximale. */
export const DIVERSITY_USERS_FULL = 10;

/** Bonus maximal de diversité des contributeurs (+15 %). */
export const DIVERSITY_BONUS_MAX = 0.15;

/**
 * Paliers de l'indice de fréquentation (section 11), du plus haut au plus bas :
 * le premier palier atteint gagne.
 */
export const FREQUENTATION_THRESHOLDS: readonly {
  readonly minScore: number;
  readonly level: FrequentationLevel;
}[] = [
  { minScore: 75, level: "very_high" },
  { minScore: 45, level: "high" },
  { minScore: 20, level: "moderate" },
  { minScore: 5, level: "low" },
  { minScore: 0, level: "very_low" },
];

/** Fenêtre de comparaison de la tendance : 12 mois contre les 12 précédents. */
export const TREND_WINDOW_DAYS = 365;

/** En dessous de ce rapport, la fréquentation s'est effondrée (section 30). */
export const INACTIVE_TREND_RATIO = 0.2;

/**
 * Historique minimal avant de signaler un effondrement : passer de 3 passages
 * à 0 n'est pas un signal, passer de 40 à 3 en est un.
 */
export const INACTIVE_MIN_HISTORY = 10;

/** Volume de passages au-delà duquel ce critère de confiance est maximal. */
export const CONFIDENCE_FULL_PASSAGES = 20;

/** Contributeurs distincts au-delà desquels ce critère de confiance est maximal. */
export const CONFIDENCE_FULL_USERS = 6;

/**
 * Poids des quatre critères de fiabilité (section 26) ; leur somme vaut 1.
 * Le volume et la diversité dominent : dix passages d'une même personne
 * n'apprennent pas grand-chose de plus qu'un seul.
 */
export const CONFIDENCE_WEIGHTS = {
  passages: 0.3,
  users: 0.25,
  freshness: 0.2,
  matching: 0.25,
} as const;

/** Dispersion relative (écart interquartile / médiane) jugée maximale. */
export const SPREAD_REFERENCE = 1;

/** Pénalité maximale de confiance due à la dispersion des durées. */
export const SPREAD_PENALTY_MAX = 0.3;

/** Part d'une activité au-delà de laquelle elle qualifie le chemin (section 10). */
export const DOMINANT_ACTIVITY_SHARE = 0.6;

/** Complément de phrase par activité dominante (« other » n'en a pas). */
export const ACTIVITY_QUALIFIERS: Record<ActivityMode, string | null> = {
  hiking: "par les randonneurs",
  trail: "par les traileurs",
  mtb: "par les VTT",
  equestrian: "à cheval",
  other: null,
};

/** Phrases de fréquentation (section 10), avec et sans activité dominante. */
export const FREQUENTATION_PHRASES: Record<
  Exclude<FrequentationLevel, "unknown">,
  { readonly withActivity: string; readonly alone: string }
> = {
  very_high: { withActivity: "Très fréquenté", alone: "Très fréquenté" },
  high: { withActivity: "Fréquenté", alone: "Fréquenté" },
  moderate: { withActivity: "Régulièrement emprunté", alone: "Régulièrement emprunté" },
  low: { withActivity: "Principalement utilisé", alone: "Peu emprunté" },
  very_low: { withActivity: "Rarement emprunté", alone: "Rarement emprunté" },
};

/** Phrase affichée tant qu'on ne sait pas (section 43) : jamais « aucun passage ». */
export const INSUFFICIENT_DATA_LABEL = "Données communautaires insuffisantes";

/* ------------------------------------------------------------------ */
/* Outils internes                                                     */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Arrondi stable (évite « -0 » et les artefacts flottants en sortie JSON). */
function round(value: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Compteur initialisé à zéro sur toutes ses clés : la forme de sortie est stable. */
function zeroCounts(from: number, to: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = from; i <= to; i++) out[String(i)] = 0;
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. Distributions (sections 13, 14, 15)                              */
/* ------------------------------------------------------------------ */

/** Percentile d'un tableau *déjà trié* et non vide, interpolation linéaire. */
function percentileSorted(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  const pos = clamp01(p) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Percentile avec interpolation linéaire entre les deux valeurs encadrantes
 * (`p` dans [0, 1], hors bornes ramené aux bornes).
 *
 * Les valeurs non finies sont ignorées : une seule mesure aberrante ne doit
 * pas rendre toute la distribution inutilisable. Tableau vide → 0, faute de
 * quoi que ce soit à interpoler (les appelants testent le vide en amont).
 */
export function percentile(values: readonly number[], p: number): number {
  const clean: number[] = [];
  for (const v of values) if (Number.isFinite(v)) clean.push(v);
  if (clean.length === 0) return 0;
  clean.sort((a, b) => a - b);
  return percentileSorted(clean, p);
}

/**
 * Distribution d'un jeu de durées (section 13).
 *
 * La médiane est la valeur de référence : contrairement à la moyenne, elle ne
 * bouge pas quand un utilisateur s'arrête une heure au bord du lac. `spread`
 * (écart interquartile rapporté à la médiane) dit si la durée est une
 * information solide ou une fourchette très large.
 *
 * Les durées nulles ou négatives sont rejetées (horodatages incohérents).
 * Aucune durée exploitable → `null`, jamais un objet à zéro qui laisserait
 * croire à une mesure.
 */
export function durationStats(durations: readonly number[]): DurationStats | null {
  const clean: number[] = [];
  let sum = 0;
  for (const d of durations) {
    if (!Number.isFinite(d) || d <= 0) continue;
    clean.push(d);
    sum += d;
  }
  if (clean.length === 0) return null;
  clean.sort((a, b) => a - b);
  const medianMs = percentileSorted(clean, 0.5);
  const p25Ms = percentileSorted(clean, 0.25);
  const p75Ms = percentileSorted(clean, 0.75);
  return {
    count: clean.length,
    averageMs: Math.round(sum / clean.length),
    medianMs: Math.round(medianMs),
    p25Ms: Math.round(p25Ms),
    p75Ms: Math.round(p75Ms),
    // Médiane nulle impossible ici (durées > 0), mais la garde reste explicite.
    spread: medianMs > 0 ? round((p75Ms - p25Ms) / medianMs, 4) : 0,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Pondération temporelle (section 42)                              */
/* ------------------------------------------------------------------ */

/**
 * Poids d'un passage selon son ancienneté : 1 aujourd'hui, 0,5 à une
 * demi-vie, 0,25 à deux demi-vies (décroissance exponentielle).
 *
 * Un horodatage postérieur à `now` (dérive d'horloge du téléphone) vaut 1
 * plutôt qu'un poids > 1 : la fraîcheur ne se gagne pas en avançant sa montre.
 * Une demi-vie absurde (nulle, négative, non finie) retombe sur le défaut.
 */
export function freshnessWeight(at: number, now: number, halfLifeDays = POPULARITY_HALF_LIFE_DAYS): number {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return 0;
  const halfLife = Number.isFinite(halfLifeDays) && halfLifeDays > 0 ? halfLifeDays : POPULARITY_HALF_LIFE_DAYS;
  const ageDays = (now - at) / DAY;
  if (ageDays <= 0) return 1;
  return clamp01(Math.pow(2, -ageDays / halfLife));
}

/* ------------------------------------------------------------------ */
/* 3. Agrégation d'un segment (sections 9 à 15, 26, 30 à 32, 43)       */
/* ------------------------------------------------------------------ */

export interface AggregateOptions {
  /** Instant de référence (fenêtres, fraîcheur, tendance). Défaut : `Date.now()`. */
  now?: number;
  /** Demi-vie de la pondération temporelle, en jours. */
  halfLifeDays?: number;
  /** Somme de poids de fraîcheur valant 100/100 de popularité. */
  referenceWeight?: number;
  /** Passages minimaux avant de conclure (section 43). */
  minObservations?: number;
}

interface ResolvedOptions {
  now: number;
  halfLifeDays: number;
  referenceWeight: number;
  minObservations: number;
}

function resolveOptions(opts: AggregateOptions): ResolvedOptions {
  const now = opts.now !== undefined && Number.isFinite(opts.now) ? opts.now : Date.now();
  const halfLifeDays =
    opts.halfLifeDays !== undefined && Number.isFinite(opts.halfLifeDays) && opts.halfLifeDays > 0
      ? opts.halfLifeDays
      : POPULARITY_HALF_LIFE_DAYS;
  const referenceWeight =
    opts.referenceWeight !== undefined && Number.isFinite(opts.referenceWeight) && opts.referenceWeight > 0
      ? opts.referenceWeight
      : POPULARITY_REFERENCE_WEIGHT;
  const minObservations =
    opts.minObservations !== undefined && Number.isFinite(opts.minObservations) && opts.minObservations >= 0
      ? Math.floor(opts.minObservations)
      : STATISTICS_MIN_OBSERVATIONS;
  return { now, halfLifeDays, referenceWeight, minObservations };
}

/** « all » et « both » sont des jokers : ils ne filtrent rien. */
function matchesKey(obs: TraversalObservation, key: StatisticsKey): boolean {
  return (
    obs.segmentId === key.segmentId &&
    (key.activity === "all" || obs.activity === key.activity) &&
    (key.direction === "both" || obs.direction === key.direction)
  );
}

/** Couverture exploitable pour une durée, ou null si le passage est trop partiel. */
function usableCoverage(coverage: number): number | null {
  if (!Number.isFinite(coverage)) return null;
  // Une couverture > 1 vient d'un arrondi de géométrie : le passage est complet.
  const c = coverage > 1 ? 1 : coverage;
  return c >= MIN_COVERAGE_FOR_DURATION ? c : null;
}

/**
 * Fractions par activité (section 10), sommant à 1.
 * Le résidu d'arrondi est reporté sur l'activité dominante pour que la somme
 * reste exactement 1 : une répartition qui somme à 0,999 serait un bug visible
 * dans un graphique empilé. L'ordre de parcours (`ACTIVITY_MODES`) rend le
 * choix de l'activité dominante déterministe en cas d'égalité.
 */
function buildActivityMix(
  counts: ReadonlyMap<ActivityMode, number>,
  total: number,
): Partial<Record<ActivityMode, number>> {
  const mix: Partial<Record<ActivityMode, number>> = {};
  if (total <= 0) return mix;
  let dominant: ActivityMode | null = null;
  let dominantCount = 0;
  let sum = 0;
  for (const mode of ACTIVITY_MODES) {
    const c = counts.get(mode);
    if (c === undefined || c <= 0) continue;
    const share = round(c / total, 4);
    mix[mode] = share;
    sum += share;
    if (c > dominantCount) {
      dominantCount = c;
      dominant = mode;
    }
  }
  if (dominant !== null) mix[dominant] = round((mix[dominant] ?? 0) + (1 - sum), 4);
  return mix;
}

/** Activité qualifiant le chemin, ou null si aucune ne se dégage nettement. */
function dominantActivity(mix: Partial<Record<ActivityMode, number>>): ActivityMode | null {
  let best: ActivityMode | null = null;
  let bestShare = 0;
  for (const mode of ACTIVITY_MODES) {
    const share = mix[mode];
    if (share !== undefined && share > bestShare) {
      bestShare = share;
      best = mode;
    }
  }
  return best !== null && bestShare >= DOMINANT_ACTIVITY_SHARE ? best : null;
}

/**
 * Sessions distinctes (section 9) : par contributeur, deux passages *successifs*
 * séparés de moins de `SESSION_GAP_MS` appartiennent à la même sortie.
 * L'aller-retour Grotelle → Melo → Grotelle compte donc pour une sortie, pas
 * deux. Le trou se mesure de proche en proche, et non depuis le début de la
 * sortie : une longue journée de marche reste une seule sortie, même si son
 * premier et son dernier passage sont séparés de dix heures.
 */
function countSessions(byUser: ReadonlyMap<string, number[]>): number {
  let sessions = 0;
  for (const times of byUser.values()) {
    if (times.length === 0) continue;
    // Tri par contributeur : les listes sont courtes, le coût total reste
    // bien inférieur à un tri global des observations.
    times.sort((a, b) => a - b);
    sessions += 1;
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] > SESSION_GAP_MS) sessions += 1;
    }
  }
  return sessions;
}

/**
 * Cœur de l'agrégation : une seule passe sur les observations *déjà filtrées*.
 * `aggregateSegment` filtre puis appelle ici ; `aggregateAll` regroupe puis
 * appelle ici — l'algorithme n'existe qu'en un seul exemplaire.
 */
function aggregateBucket(
  list: readonly TraversalObservation[],
  key: StatisticsKey,
  o: ResolvedOptions,
): SegmentStatistics {
  const passages: WindowCounts = { last7: 0, last30: 0, last365: 0, total: 0 };
  const monthly = zeroCounts(1, 12);
  const hourly = zeroCounts(0, 23);
  const byUser = new Map<string, number[]>();
  const activityCounts = new Map<ActivityMode, number>();
  const calendarMonths = new Set<string>();
  const durations: number[] = [];

  let freshnessSum = 0;
  let matchingSum = 0;
  let distanceSum = 0;
  let movingMs = 0;
  let firstPassageAt: number | null = null;
  let lastPassageAt: number | null = null;
  let recent12 = 0;
  let previous12 = 0;

  for (const obs of list) {
    // Sans horodatage exploitable, l'observation n'est ni datable ni pondérable.
    if (!Number.isFinite(obs.at)) continue;
    passages.total += 1;

    const age = Math.max(0, o.now - obs.at);
    if (age <= 7 * DAY) passages.last7 += 1;
    if (age <= 30 * DAY) passages.last30 += 1;
    if (age <= 365 * DAY) passages.last365 += 1;
    if (age <= TREND_WINDOW_DAYS * DAY) recent12 += 1;
    else if (age <= 2 * TREND_WINDOW_DAYS * DAY) previous12 += 1;

    if (firstPassageAt === null || obs.at < firstPassageAt) firstPassageAt = obs.at;
    if (lastPassageAt === null || obs.at > lastPassageAt) lastPassageAt = obs.at;

    // Saisonnalité et horaires en heure locale du serveur (section 31) : un
    // départ « à 6 h » n'a de sens que dans le fuseau du massif, pas en UTC.
    const d = new Date(obs.at);
    monthly[String(d.getMonth() + 1)] += 1;
    hourly[String(d.getHours())] += 1;
    calendarMonths.add(`${d.getFullYear()}-${d.getMonth()}`);

    freshnessSum += freshnessWeight(obs.at, o.now, o.halfLifeDays);
    matchingSum += Number.isFinite(obs.confidence) ? clamp01(obs.confidence) : 0;
    activityCounts.set(obs.activity, (activityCounts.get(obs.activity) ?? 0) + 1);

    // Sans pseudonyme exploitable, le passage compte mais ne peut prouver
    // aucune diversité de contributeurs : il ne crée ni utilisateur ni session.
    if (typeof obs.userKey === "string" && obs.userKey !== "") {
      const times = byUser.get(obs.userKey);
      if (times === undefined) byUser.set(obs.userKey, [obs.at]);
      else times.push(obs.at);
    }

    const coverage = usableCoverage(obs.coverage);
    if (coverage !== null && Number.isFinite(obs.durationMs) && obs.durationMs > 0) {
      // Un passage partiel est ramené au segment complet, sinon la médiane
      // dirait « 4 minutes » pour un segment qu'on ne traverse jamais en moins
      // de 10. Au-delà de DURATION_FULL_COVERAGE, la durée est prise telle quelle.
      durations.push(coverage < DURATION_FULL_COVERAGE ? obs.durationMs / coverage : obs.durationMs);
      if (Number.isFinite(obs.distanceM) && obs.distanceM > 0) {
        // Vitesse : distance et durée décrivent la même portion, l'extrapolation
        // s'annulerait — on somme les valeurs brutes.
        distanceSum += obs.distanceM;
        movingMs += obs.durationMs;
      }
    }
  }

  const uniqueUsers = byUser.size;
  const uniqueSessions = countSessions(byUser);
  const duration = durationStats(durations);
  const activityMix = buildActivityMix(activityCounts, passages.total);

  // Popularité (sections 32 et 42) : volume pondéré par la fraîcheur, majoré
  // par la régularité (nombre de mois calendaires où l'on a vu passer
  // quelqu'un) et la diversité des contributeurs. Croissante, saturée à 100 :
  // au-delà de la référence, « très fréquenté » reste « très fréquenté ».
  const regularity = Math.min(calendarMonths.size, REGULARITY_MONTHS_FULL) / REGULARITY_MONTHS_FULL;
  const diversity = Math.min(uniqueUsers, DIVERSITY_USERS_FULL) / DIVERSITY_USERS_FULL;
  const bonus = 1 + REGULARITY_BONUS_MAX * regularity + DIVERSITY_BONUS_MAX * diversity;
  const popularityScore =
    passages.total === 0 ? 0 : round(100 * clamp01((freshnessSum / o.referenceWeight) * bonus), 1);

  const insufficientData = passages.total < o.minObservations || uniqueUsers < K_ANONYMITY_MIN;

  // Tendance (section 30) : sans historique antérieur, il n'y a rien à
  // comparer — null, et surtout pas « 0 » qui se lirait comme un effondrement.
  const trend = previous12 > 0 ? round(recent12 / previous12, 3) : null;
  const silent = lastPassageAt !== null && o.now - lastPassageAt > TREND_WINDOW_DAYS * DAY;
  const collapsing = trend !== null && trend < INACTIVE_TREND_RATIO && previous12 >= INACTIVE_MIN_HISTORY;

  // Fiabilité (section 26). Sans durée exploitable, la dispersion est inconnue :
  // on applique la pénalité maximale plutôt que de supposer une belle régularité.
  const volumeScore = Math.min(1, passages.total / CONFIDENCE_FULL_PASSAGES);
  const usersScore = Math.min(1, uniqueUsers / CONFIDENCE_FULL_USERS);
  const freshnessScore = passages.total > 0 ? freshnessSum / passages.total : 0;
  const matchingScore = passages.total > 0 ? matchingSum / passages.total : 0;
  const spread = duration === null ? SPREAD_REFERENCE : duration.spread;
  const spreadPenalty = SPREAD_PENALTY_MAX * clamp01(spread / SPREAD_REFERENCE);
  const confidenceBase =
    CONFIDENCE_WEIGHTS.passages * volumeScore +
    CONFIDENCE_WEIGHTS.users * usersScore +
    CONFIDENCE_WEIGHTS.freshness * freshnessScore +
    CONFIDENCE_WEIGHTS.matching * matchingScore;
  const confidence = passages.total === 0 ? 0 : round(clamp01(confidenceBase * (1 - spreadPenalty)), 3);

  return {
    segmentId: key.segmentId,
    activity: key.activity,
    direction: key.direction,
    passages,
    uniqueSessions,
    uniqueUsers,
    duration,
    averageSpeedMs: movingMs > 0 ? round(distanceSum / (movingMs / 1000), 3) : null,
    firstPassageAt,
    lastPassageAt,
    popularityScore,
    frequentation: insufficientData ? "unknown" : frequentationLevel(popularityScore),
    confidence,
    insufficientData,
    activityMix,
    monthly,
    hourly,
    trend,
    possiblyInactive: silent || collapsing,
  };
}

/**
 * Statistiques d'un segment pour une clé donnée (segment × activité × sens).
 *
 * `activity: "all"` et `direction: "both"` ne filtrent rien : ce sont les
 * agrégats « toutes activités » et « les deux sens ». Un jeu d'observations
 * vide produit un agrégat valide et honnête — zéro partout,
 * `insufficientData: true`, `frequentation: "unknown"` — jamais une exception :
 * un chemin sans données reste un chemin (section 43).
 */
export function aggregateSegment(
  observations: readonly TraversalObservation[],
  key: StatisticsKey,
  opts: AggregateOptions = {},
): SegmentStatistics {
  const o = resolveOptions(opts);
  const kept: TraversalObservation[] = [];
  for (const obs of observations) if (matchesKey(obs, key)) kept.push(obs);
  return aggregateBucket(kept, key, o);
}

/** Rang d'une activité pour l'ordre de sortie (« all » en tête). */
function activityRank(activity: ActivityMode | "all"): number {
  if (activity === "all") return -1;
  const i = ACTIVITY_MODES.indexOf(activity);
  return i < 0 ? ACTIVITY_MODES.length : i;
}

const DIRECTION_RANK: Record<StatisticsKey["direction"], number> = { both: 0, forward: 1, backward: 2 };

/**
 * Agrège toutes les clés présentes dans un lot d'observations.
 *
 * Chaque observation est rangée en une seule passe dans les quatre agrégats
 * qui la concernent : (toutes activités, deux sens), (son activité, deux sens),
 * (toutes activités, son sens) et (son activité, son sens). C'est linéaire en
 * nombre d'observations ; filtrer le lot complet une fois par combinaison
 * serait quadratique dès qu'un massif compte quelques milliers de segments.
 *
 * Seules les combinaisons réellement observées sont produites (pas d'agrégat
 * vide), et la sortie est triée : segment, puis activité, puis sens — le
 * résultat est identique d'une exécution à l'autre.
 */
export function aggregateAll(
  observations: readonly TraversalObservation[],
  opts: AggregateOptions = {},
): SegmentStatistics[] {
  const o = resolveOptions(opts);
  const buckets = new Map<string, { key: StatisticsKey; list: TraversalObservation[] }>();

  const push = (
    segmentId: string,
    activity: ActivityMode | "all",
    direction: StatisticsKey["direction"],
    obs: TraversalObservation,
  ): void => {
    // Clé préfixée par la longueur de l'identifiant : aucun identifiant de
    // segment, si exotique soit-il, ne peut fabriquer une collision de clé.
    const id = `${segmentId.length}:${segmentId}|${activity}|${direction}`;
    const bucket = buckets.get(id);
    if (bucket === undefined) buckets.set(id, { key: { segmentId, activity, direction }, list: [obs] });
    else bucket.list.push(obs);
  };

  for (const obs of observations) {
    if (typeof obs.segmentId !== "string" || obs.segmentId === "") continue;
    if (!Number.isFinite(obs.at)) continue;
    push(obs.segmentId, "all", "both", obs);
    push(obs.segmentId, obs.activity, "both", obs);
    push(obs.segmentId, "all", obs.direction, obs);
    push(obs.segmentId, obs.activity, obs.direction, obs);
  }

  const out: SegmentStatistics[] = [];
  for (const bucket of buckets.values()) out.push(aggregateBucket(bucket.list, bucket.key, o));
  out.sort(
    (a, b) =>
      (a.segmentId < b.segmentId ? -1 : a.segmentId > b.segmentId ? 1 : 0) ||
      activityRank(a.activity) - activityRank(b.activity) ||
      DIRECTION_RANK[a.direction] - DIRECTION_RANK[b.direction],
  );
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. Restitution lisible (sections 10 et 11)                          */
/* ------------------------------------------------------------------ */

/**
 * Niveau de fréquentation correspondant à un score (section 11).
 * Un score non exploitable donne `unknown` : on ne devine pas.
 */
export function frequentationLevel(popularityScore: number): FrequentationLevel {
  if (!Number.isFinite(popularityScore)) return "unknown";
  for (const tier of FREQUENTATION_THRESHOLDS) {
    if (popularityScore >= tier.minScore) return tier.level;
  }
  return "very_low";
}

/**
 * Phrase affichable décrivant la fréquentation d'un segment (section 10).
 *
 * Le niveau donne le verbe, l'activité dominante (au moins
 * `DOMINANT_ACTIVITY_SHARE` des passages) le complément : « Très fréquenté par
 * les randonneurs », « Principalement utilisé à cheval », « Fréquenté par les
 * VTT », « Rarement emprunté ». Tant que les données ne permettent pas de
 * conclure, la phrase le dit — et ne laisse jamais entendre que le chemin
 * n'existe pas ou n'est pas emprunté (section 43).
 */
export function describeFrequentation(stats: SegmentStatistics): string {
  if (stats.insufficientData || stats.frequentation === "unknown") return INSUFFICIENT_DATA_LABEL;
  const phrases = FREQUENTATION_PHRASES[stats.frequentation];
  const dominant = dominantActivity(stats.activityMix);
  const qualifier = dominant === null ? null : ACTIVITY_QUALIFIERS[dominant];
  // « Rarement emprunté par les randonneurs » n'apporte rien : sous ce niveau,
  // la phrase reste nue.
  if (qualifier === null || stats.frequentation === "very_low") return phrases.alone;
  return `${phrases.withActivity} ${qualifier}`;
}
