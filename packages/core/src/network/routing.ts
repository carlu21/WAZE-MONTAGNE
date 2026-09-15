/**
 * Calculateur d'itinéraires multicritères sur le réseau vivant.
 *
 * Sections du cahier des charges « moteur cartographique » couvertes ici :
 *
 *  - **22. Proposer plusieurs itinéraires** : un calcul par critère demandé
 *    (recommandé, le plus rapide, le plus court, le plus emprunté, le plus
 *    facile, le plus tranquille). Deux critères qui aboutissent exactement au
 *    même enchaînement de tronçons ne donnent qu'une proposition : afficher
 *    deux fois le même tracé sous deux étiquettes serait mentir.
 *  - **23. Décrire chaque itinéraire** : chaque `RouteOption` sort complète —
 *    tronçons, géométrie, distance, durée, dénivelés, fréquentation,
 *    difficulté, part de temps réellement observé et fiabilité associée. Rien
 *    n'est laissé à recalculer par l'appelant.
 *  - **39. Coûts par segment** : `segmentCosts` produit les cinq coûts du
 *    contrat, *par sens de parcours* — monter la Restonica et la descendre
 *    n'ont ni le même temps, ni le même dénivelé, ni la même difficulté.
 *  - **40. Pondération par critère** : `criterionWeight` n'expose que des
 *    poids, lus dans une table constante ; `edgeCost` en fait une somme.
 *  - **41. Calcul d'itinéraire** : A* sur le graphe des nœuds, heuristique
 *    admissible *et* consistante, file de priorité en tas binaire, nombre de
 *    nœuds explorés borné.
 *
 * ## Pourquoi des « mètres équivalents »
 *
 * Additionner des millisecondes, des mètres de dénivelé et un indice 0..1 n'a
 * aucun sens : les ordres de grandeur s'écrasent les uns les autres. Les cinq
 * coûts sont donc tous exprimés dans une unité commune, le **mètre de plat** :
 *
 *  - une durée devient la distance parcourue pendant ce temps à la vitesse
 *    nominale de l'activité (un segment lent « coûte » plus long qu'il n'est) ;
 *  - un mètre de dénivelé vaut `ROUTE_CLIMB_EQUIVALENT_M` (montée) ou
 *    `ROUTE_DESCENT_EQUIVALENT_M` (descente) mètres de plat, convention du
 *    « kilomètre-effort » ;
 *  - la difficulté (0..1) et la fréquentation (0..100) sont des *taux* : elles
 *    modulent le coût au mètre, donc se multiplient par la distance.
 *
 * Conséquence structurante : le coût combiné reste **additif et strictement
 * positif** (`ROUTE_MIN_EDGE_COST` en plancher), condition nécessaire à la
 * terminaison et à l'optimalité d'un plus court chemin.
 *
 * ## L'heuristique, le vrai piège de ce module
 *
 * A* n'est optimal que si l'heuristique ne surestime **jamais** le coût
 * restant. Convertir la distance à vol d'oiseau avec le coût au mètre du
 * critère « en général » (ou avec celui du segment courant) casse cette
 * garantie dès qu'un chemin moins cher au mètre existe ailleurs : l'algorithme
 * fonce vers l'arrivée et rate le détour pourtant meilleur. On convertit donc
 * avec le coût au mètre **le plus favorable réellement observé sur le graphe**
 * pour cette activité et ce critère (`bestCostPerMeter`). Comme la longueur
 * d'une arête est toujours ≥ la distance à vol d'oiseau entre ses deux nœuds,
 * l'heuristique est admissible ; l'inégalité triangulaire la rend en outre
 * consistante, ce qui autorise la fermeture définitive des nœuds sortis du tas.
 *
 * ## Vie privée (sections 34 à 36)
 *
 * Aucune statistique d'un segment n'est exploitée — ni pour le coût, ni pour
 * l'affichage — tant qu'elle ne repose pas sur au moins `K_ANONYMITY_MIN`
 * utilisateurs distincts. Une médiane de durée calculée sur les passages d'une
 * seule personne est sa signature horaire ; un « 2 passages en 30 jours »
 * affiché sur un sentier confidentiel désigne quelqu'un. Sous le seuil, le
 * segment est traité comme inconnu : temps purement théorique, fréquentation
 * nulle, confiance minimale.
 *
 * Module pur : aucune horloge (les fenêtres de fréquentation sont déjà
 * agrégées en amont), aucun aléa, aucune mutation des entrées. Les résultats
 * ne dépendent pas de l'ordre des segments fournis : arêtes et listes
 * d'adjacence sont triées, les égalités de coût sont départagées par clé.
 */
import type { LatLng } from "../types";
import { haversineM, type LngLat } from "../geo";
import { DEFAULT_SPEED_MS } from "../navigation/eta";
import { isSegmentAllowed, nodeKey, nodePosition } from "../navigation/graph";
import { ACTIVITY_MODES, type ActivityMode, type PathKind } from "../navigation/types";
import { TIME_CONFIDENCE_RANK, estimateTime, segmentProfile, theoreticalTimeMs, timeConfidence } from "./timing";
import {
  K_ANONYMITY_MIN,
  type RouteCriterion,
  type RouteLeg,
  type RouteOption,
  type RoutingSegmentInput,
  type SegmentCosts,
  type SegmentProfile,
  type SegmentStatistics,
  type TimeConfidence,
  type TimeEstimate,
  type TraversalDirection,
} from "./types";

/* ------------------------------------------------------------------ */
/* 1. Réglages produit : rattachement et exploration (sections 22, 41)  */
/* ------------------------------------------------------------------ */

/**
 * Rayon maximal de rattachement du départ et de l'arrivée à un nœud (m).
 *
 * 2 km : en montagne, on part rarement d'une intersection cartographiée — le
 * parking de la Restonica, un refuge ou un hameau sont souvent à plusieurs
 * centaines de mètres du premier nœud du réseau. Au-delà de 2 km en revanche,
 * l'itinéraire proposé ne répond plus à la question posée : mieux vaut ne rien
 * proposer que de faire commencer la randonnée à une heure de marche.
 */
export const ROUTE_MAX_SNAP_M = 2000;

/** Critères calculés quand l'appelant n'en précise aucun, dans l'ordre d'affichage. */
export const ROUTE_DEFAULT_CRITERIA: readonly RouteCriterion[] = [
  "recommended",
  "fastest",
  "shortest",
  "most_used",
  "easiest",
  "quietest",
];

/**
 * Nombre maximal de nœuds définitivement réglés par recherche.
 *
 * Garde-fou de temps de calcul : au-delà, la recherche renonce plutôt que de
 * bloquer l'appelant. 200 000 nœuds, c'est déjà un massif entier ; une demande
 * qui l'atteint est une demande aberrante.
 */
export const ROUTE_MAX_SETTLED_NODES = 200_000;

/**
 * Coût minimal d'une arête (mètres équivalents).
 *
 * Une arête de coût nul autoriserait des allers-retours gratuits et, en
 * théorie, une exploration sans fin. Un millième de mètre équivalent suffit à
 * garantir la terminaison sans fausser aucun arbitrage.
 */
export const ROUTE_MIN_EDGE_COST = 1e-3;

/* ------------------------------------------------------------------ */
/* 2. Réglages produit : conversion en mètres équivalents (section 39)  */
/* ------------------------------------------------------------------ */

/**
 * Mètres de plat « valant » un mètre de dénivelé positif.
 *
 * 10 : convention du kilomètre-effort (100 m de D+ ≈ 1 km de plat), celle que
 * les randonneurs utilisent déjà pour comparer deux courses.
 */
export const ROUTE_CLIMB_EQUIVALENT_M = 10;

/**
 * Mètres de plat « valant » un mètre de dénivelé négatif.
 *
 * 3 : une descente coûte, mais trois fois moins qu'une montée. La compter pour
 * zéro ferait accepter un itinéraire qui perd 800 m pour les reprendre ensuite ;
 * la compter comme une montée interdirait toute redescente.
 */
export const ROUTE_DESCENT_EQUIVALENT_M = 3;

/** Clés des cinq coûts du contrat, dans un ordre fixe (sommes déterministes). */
export const SEGMENT_COST_KEYS: readonly (keyof SegmentCosts)[] = [
  "distance",
  "time",
  "difficulty",
  "popularity",
  "elevation",
];

/* ------------------------------------------------------------------ */
/* 3. Réglages produit : difficulté d'un segment (section 39)           */
/* ------------------------------------------------------------------ */

/** Pente moyenne en montée (%) à partir de laquelle la composante « pente » est maximale. */
export const ROUTE_SLOPE_FULL_PCT = 25;

/** Pente ponctuelle (%) à partir de laquelle la composante « raideur » est maximale. */
export const ROUTE_MAX_SLOPE_FULL_PCT = 50;

/** Poids des composantes de la difficulté (somme = 1). */
export const ROUTE_DIFFICULTY_WEIGHTS = {
  /** Pente moyenne en montée : le premier facteur de pénibilité. */
  slope: 0.35,
  /** Raideur ponctuelle : un seul ressaut suffit à rendre un sentier difficile. */
  maxSlope: 0.15,
  /** Cotation alpine : la seule donnée qui parle d'exposition. */
  sacScale: 0.25,
  /** Revêtement : un pierrier n'est pas une piste roulante. */
  surface: 0.15,
  /** Nature du chemin : escaliers, via ferrata… */
  kind: 0.1,
} as const;

/** Difficulté (0..1) apportée par la cotation alpine OSM `sac_scale`. */
export const ROUTE_SAC_DIFFICULTY: Readonly<Record<string, number>> = {
  hiking: 0.1,
  mountain_hiking: 0.3,
  demanding_mountain_hiking: 0.5,
  alpine_hiking: 0.7,
  demanding_alpine_hiking: 0.85,
  difficult_alpine_hiking: 1,
};

/** Cotation inconnue : ni facile ni difficile, on ne suppose rien de flatteur. */
export const ROUTE_SAC_DIFFICULTY_DEFAULT = 0.2;

/** Difficulté (0..1) apportée par le revêtement OSM `surface`. */
export const ROUTE_SURFACE_DIFFICULTY: Readonly<Record<string, number>> = {
  asphalt: 0,
  concrete: 0,
  paved: 0.05,
  paving_stones: 0.05,
  compacted: 0.1,
  fine_gravel: 0.15,
  gravel: 0.2,
  dirt: 0.2,
  earth: 0.2,
  ground: 0.2,
  grass: 0.25,
  wood: 0.3,
  pebblestone: 0.4,
  sand: 0.45,
  stone: 0.5,
  mud: 0.55,
  rock: 0.6,
  snow: 0.7,
  scree: 0.75,
  ice: 0.9,
};

/** Revêtement inconnu : par défaut un sentier de montagne, pas une piste. */
export const ROUTE_SURFACE_DIFFICULTY_DEFAULT = 0.25;

/** Difficulté (0..1) apportée par la nature du chemin. */
export const ROUTE_KIND_DIFFICULTY: Readonly<Record<PathKind, number>> = {
  path: 0.2,
  track: 0.1,
  footway: 0.05,
  bridleway: 0.15,
  cycleway: 0.05,
  steps: 0.6,
  road: 0.05,
  via_ferrata: 1,
  unknown: 0.2,
};

/** Supplément de difficulté d'un gué : traverser une rivière n'est jamais anodin. */
export const ROUTE_FORD_DIFFICULTY = 0.15;

/* ------------------------------------------------------------------ */
/* 4. Réglages produit : pondérations par critère (section 40)          */
/* ------------------------------------------------------------------ */

/**
 * Poids appliqués aux cinq coûts, par critère.
 *
 * Lecture : tous les coûts étant en mètres équivalents, un poids se lit comme
 * un multiplicateur de longueur. `popularity` est un coût de *foule* (il croît
 * avec la fréquentation) ; un poids négatif signifie donc « préférer les
 * chemins fréquentés ».
 *
 *  - `shortest` : la distance, rien d'autre — c'est la définition.
 *  - `fastest` : le temps, rien d'autre (observé dès qu'il existe).
 *  - `most_used` : coût au mètre = 1,6 − 0,6 × (popularité/100), soit un chemin
 *    désert 60 % plus cher qu'un chemin saturé : le détour toléré pour
 *    rejoindre le sentier balisé est de cet ordre.
 *  - `easiest` : difficulté et dénivelé dominent, la distance compte peu —
 *    allonger pour éviter un couloir raide est exactement le but.
 *  - `quietest` : symétrique de `most_used`, en pénalité : un sentier saturé
 *    coûte jusqu'à 2,5 fois sa longueur.
 *  - `recommended` : compromis de la section 41, décliné par activité dans
 *    `ROUTE_RECOMMENDED_WEIGHTS` ; la valeur ci-dessous est celle de la marche
 *    et sert de repli.
 *
 * Invariant vérifié par les tests : pour chaque critère et chaque activité,
 * `distance + min(0, popularity) ≥ 0`, et au moins un poids est strictement
 * positif. Comme le coût de fréquentation ne dépasse jamais le coût de
 * distance (la popularité est un taux 0..1 appliqué à la longueur), le coût au
 * mètre ne peut pas devenir négatif ; `edgeCost` n'a plus qu'à écarter le cas
 * nul.
 */
export const ROUTE_CRITERION_WEIGHTS: Readonly<
  Record<RouteCriterion, Readonly<Record<keyof SegmentCosts, number>>>
> = {
  recommended: { distance: 0.35, time: 0.35, difficulty: 0.4, popularity: -0.15, elevation: 0.3 },
  fastest: { distance: 0, time: 1, difficulty: 0, popularity: 0, elevation: 0 },
  shortest: { distance: 1, time: 0, difficulty: 0, popularity: 0, elevation: 0 },
  most_used: { distance: 1.6, time: 0, difficulty: 0, popularity: -0.6, elevation: 0 },
  easiest: { distance: 0.3, time: 0, difficulty: 1.5, popularity: 0, elevation: 1 },
  quietest: { distance: 1, time: 0, difficulty: 0, popularity: 1.5, elevation: 0 },
};

/**
 * Compromis « recommandé » (section 41), décliné par activité.
 *
 * Le compromis n'a de sens que rapporté à une pratique :
 *
 *  - `hiking` : équilibre distance / temps / difficulté, léger penchant pour
 *    les chemins fréquentés (mieux tracés, mieux balisés, et l'on y croise du
 *    monde en cas de pépin).
 *  - `trail` : le temps prime, le dénivelé effraie moins — c'est le terrain de
 *    jeu, pas l'obstacle.
 *  - `mtb` : la difficulté technique pèse lourd (une section non roulante se
 *    paie en portage) et la pente aussi.
 *  - `equestrian` : la sûreté du terrain avant tout — un cheval ne se rattrape
 *    pas sur une dalle ; les chemins connus sont nettement préférés.
 *  - `other` : repli neutre, identique à la marche.
 */
export const ROUTE_RECOMMENDED_WEIGHTS: Readonly<
  Record<ActivityMode, Readonly<Record<keyof SegmentCosts, number>>>
> = {
  hiking: { distance: 0.35, time: 0.35, difficulty: 0.4, popularity: -0.15, elevation: 0.3 },
  trail: { distance: 0.3, time: 0.5, difficulty: 0.25, popularity: -0.1, elevation: 0.2 },
  mtb: { distance: 0.3, time: 0.4, difficulty: 0.6, popularity: -0.1, elevation: 0.35 },
  equestrian: { distance: 0.3, time: 0.3, difficulty: 0.8, popularity: -0.2, elevation: 0.35 },
  other: { distance: 0.35, time: 0.35, difficulty: 0.4, popularity: -0.15, elevation: 0.3 },
};

/* ------------------------------------------------------------------ */
/* 5. Utilitaires internes                                              */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);

const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** Valeur finie et positive, 0 sinon (NaN, Infinity, négatif). */
const positive = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

/** Lecture tolérante d'une table de terrain : clé nettoyée, valeur par défaut assumée. */
function lookupTerrain(table: Readonly<Record<string, number>>, key: string | null, fallback: number): number {
  if (key === null) return fallback;
  const normalized = key.trim().toLowerCase();
  if (normalized === "") return fallback;
  const value = table[normalized];
  return value === undefined || !Number.isFinite(value) ? fallback : value;
}

/** Activité réellement exploitable (une valeur hors contrat retombe sur la marche). */
function safeActivity(activity: ActivityMode): ActivityMode {
  return ACTIVITY_MODES.includes(activity) ? activity : "hiking";
}

/**
 * Table indexée par activité, construite clé par clé.
 *
 * Écrire les cinq clés plutôt que partir d'un objet vide évite une assertion de
 * type — et le compilateur signalera l'oubli le jour où une activité s'ajoute
 * au contrat.
 */
function byActivity<T>(make: (activity: ActivityMode) => T): Record<ActivityMode, T> {
  return {
    hiking: make("hiking"),
    trail: make("trail"),
    mtb: make("mtb"),
    equestrian: make("equestrian"),
    other: make("other"),
  };
}

/** Comparaison de chaînes indépendante de la locale (déterminisme entre machines). */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ------------------------------------------------------------------ */
/* 6. Vie privée : ce qu'une statistique a le droit de dire (34 à 36)   */
/* ------------------------------------------------------------------ */

/**
 * Statistiques exploitables, ou `null` sous le seuil de k-anonymat.
 *
 * On compte des **utilisateurs distincts**, jamais des passages : cinquante
 * passages d'une même personne restent une personne. Sous `K_ANONYMITY_MIN`,
 * le segment est traité comme jamais parcouru — c'est volontairement plus
 * sévère qu'un simple masquage d'affichage, parce qu'un itinéraire calculé
 * *à partir* de ces données les divulguerait tout autant.
 */
export function publishableStats(stats: SegmentStatistics | null | undefined): SegmentStatistics | null {
  if (stats === null || stats === undefined) return null;
  const users = stats.uniqueUsers;
  if (!Number.isFinite(users) || users < K_ANONYMITY_MIN) return null;
  return stats;
}

/** Statistiques du sens demandé, déjà filtrées par le k-anonymat. */
function directionStats(input: RoutingSegmentInput, direction: TraversalDirection): SegmentStatistics | null {
  return publishableStats(direction === "forward" ? input.statsForward : input.statsBackward);
}

/* ------------------------------------------------------------------ */
/* 7. Difficulté et coûts d'un segment (section 39)                     */
/* ------------------------------------------------------------------ */

/**
 * Profil du segment dans le sens demandé.
 *
 * Le contrat fournit le profil « dans le sens de la géométrie » et précise que
 * le sens inverse en est *dérivé* : c'est exactement ce que fait cette fonction
 * — distance et pente maximale (absolue) inchangées, dénivelés échangés, pente
 * moyenne changée de signe. Le profil fourni est privilégié parce qu'il vient
 * souvent d'un modèle de terrain bien meilleur que les altitudes portées par la
 * géométrie ; s'il est absent ou inexploitable (distance non finie ou
 * négative), `segmentProfile` le recalcule depuis le segment.
 */
export function directionProfile(
  input: RoutingSegmentInput,
  direction: TraversalDirection = "forward",
): SegmentProfile {
  const provided = input.profile;
  if (provided === null || provided === undefined || !Number.isFinite(provided.distanceM) || provided.distanceM < 0) {
    return segmentProfile(input.segment, direction);
  }
  if (direction === "forward") return provided;
  return {
    ...provided,
    elevationGainM: provided.elevationLossM,
    elevationLossM: provided.elevationGainM,
    averageSlope: Number.isFinite(provided.averageSlope) ? round(-provided.averageSlope, 4) : 0,
  };
}

/** Difficulté 0..1 déduite du profil et du caractère « gué » du segment. */
function difficultyFromProfile(profile: SegmentProfile, ford: boolean): number {
  const slope = Number.isFinite(profile.averageSlope) ? profile.averageSlope : 0;
  const maxSlope = Number.isFinite(profile.maxSlope) ? Math.abs(profile.maxSlope) : 0;
  const uphill = clamp01(Math.max(0, slope) / ROUTE_SLOPE_FULL_PCT);
  const steep = clamp01(maxSlope / ROUTE_MAX_SLOPE_FULL_PCT);
  const sac = lookupTerrain(ROUTE_SAC_DIFFICULTY, profile.sacScale, ROUTE_SAC_DIFFICULTY_DEFAULT);
  const surface = lookupTerrain(ROUTE_SURFACE_DIFFICULTY, profile.surface, ROUTE_SURFACE_DIFFICULTY_DEFAULT);
  const kind = ROUTE_KIND_DIFFICULTY[profile.kind] ?? ROUTE_KIND_DIFFICULTY.unknown;
  const base =
    uphill * ROUTE_DIFFICULTY_WEIGHTS.slope +
    steep * ROUTE_DIFFICULTY_WEIGHTS.maxSlope +
    sac * ROUTE_DIFFICULTY_WEIGHTS.sacScale +
    surface * ROUTE_DIFFICULTY_WEIGHTS.surface +
    kind * ROUTE_DIFFICULTY_WEIGHTS.kind;
  return round(clamp01(base + (ford ? ROUTE_FORD_DIFFICULTY : 0)), 4);
}

/**
 * Difficulté 0..1 d'un segment dans un sens donné.
 *
 * Elle dépend du sens : la pente moyenne change de signe, et seule la montée
 * pèse dans la composante « pente » (une descente se paie en temps et en
 * genoux, pas en effort d'ascension). Le reste — cotation, revêtement, nature
 * du chemin, gué — est commun aux deux sens.
 */
export function segmentDifficulty(input: RoutingSegmentInput, direction: TraversalDirection = "forward"): number {
  return difficultyFromProfile(directionProfile(input, direction), input.segment.ford);
}

/**
 * Durée estimée d'un segment dans un sens, pour une activité (sections 14, 25).
 *
 * Point de départ théorique (`theoreticalTimeMs`), puis mélange progressif avec
 * la médiane observée (`estimateTime`) — mais uniquement si les passages
 * viennent d'assez d'utilisateurs distincts (`publishableStats`). Sans
 * observation publiable, l'estimation reste franchement théorique, et le dit
 * (`observedWeight` à 0, confiance « très faible »).
 */
export function segmentTimeEstimate(
  input: RoutingSegmentInput,
  direction: TraversalDirection = "forward",
  activity: ActivityMode = "hiking",
): TimeEstimate {
  const mode = safeActivity(activity);
  const profile = directionProfile(input, direction);
  const stats = directionStats(input, direction);
  return estimateTime({
    theoreticalMs: theoreticalTimeMs(profile, mode),
    observed: stats === null ? null : stats.duration,
  });
}

/** Assemblage des cinq coûts à partir d'éléments déjà calculés (aucun doublon de calcul). */
function costsFromParts(
  profile: SegmentProfile,
  durationMs: number,
  difficulty: number,
  popularityScore: number,
  activity: ActivityMode,
): SegmentCosts {
  const distanceM = positive(profile.distanceM);
  const speedMs = DEFAULT_SPEED_MS[activity] ?? DEFAULT_SPEED_MS.hiking;
  const timeM = speedMs > 0 ? (positive(durationMs) / 1000) * speedMs : 0;
  const elevationM =
    positive(profile.elevationGainM) * ROUTE_CLIMB_EQUIVALENT_M +
    positive(profile.elevationLossM) * ROUTE_DESCENT_EQUIVALENT_M;
  return {
    distance: round(distanceM, 3),
    time: round(timeM, 3),
    difficulty: round(clamp01(difficulty) * distanceM, 3),
    popularity: round(clamp01(popularityScore / 100) * distanceM, 3),
    elevation: round(elevationM, 3),
  };
}

/** Score de popularité exploitable (0..100), 0 si les statistiques sont muettes. */
function popularityOf(stats: SegmentStatistics | null): number {
  if (stats === null || !Number.isFinite(stats.popularityScore)) return 0;
  return clamp(stats.popularityScore, 0, 100);
}

/**
 * Les cinq coûts d'un segment dans un sens donné, pour une activité
 * (section 39), exprimés en mètres équivalents.
 *
 * Tous finis et ≥ 0, y compris sur une géométrie dégénérée (deux points
 * identiques, distance nulle, altitudes absentes, statistiques vides) : un
 * segment sans longueur ne coûte rien, et surtout pas `NaN`.
 */
export function segmentCosts(
  input: RoutingSegmentInput,
  direction: TraversalDirection = "forward",
  activity: ActivityMode = "hiking",
): SegmentCosts {
  const mode = safeActivity(activity);
  const profile = directionProfile(input, direction);
  const stats = directionStats(input, direction);
  const estimate = estimateTime({
    theoreticalMs: theoreticalTimeMs(profile, mode),
    observed: stats === null ? null : stats.duration,
  });
  return costsFromParts(
    profile,
    estimate.ms,
    difficultyFromProfile(profile, input.segment.ford),
    popularityOf(stats),
    mode,
  );
}

/**
 * Poids d'un critère pour une activité (section 40).
 *
 * Seul `recommended` dépend de l'activité : les cinq autres critères ont une
 * définition littérale (« le plus court », « le plus rapide »…) que la pratique
 * ne déplace pas. Le résultat est une copie : la table constante reste intacte
 * quoi qu'en fasse l'appelant.
 */
export function criterionWeight(
  criterion: RouteCriterion,
  activity: ActivityMode = "hiking",
): Record<keyof SegmentCosts, number> {
  const mode = safeActivity(activity);
  if (criterion === "recommended") {
    return { ...(ROUTE_RECOMMENDED_WEIGHTS[mode] ?? ROUTE_RECOMMENDED_WEIGHTS.hiking) };
  }
  return { ...(ROUTE_CRITERION_WEIGHTS[criterion] ?? ROUTE_RECOMMENDED_WEIGHTS[mode]) };
}

/**
 * Coût combiné d'une arête : somme pondérée des cinq composantes.
 *
 * Le résultat est **strictement positif** (plancher `ROUTE_MIN_EDGE_COST`) et
 * toujours fini. C'est la condition sans laquelle une recherche de plus court
 * chemin peut ne jamais s'arrêter : un poids négatif sur la fréquentation ne
 * doit jamais rendre un aller-retour profitable.
 */
export function edgeCost(costs: SegmentCosts, weights: Record<keyof SegmentCosts, number>): number {
  let total = 0;
  for (const key of SEGMENT_COST_KEYS) {
    const cost = costs[key];
    const weight = weights[key];
    if (!Number.isFinite(cost) || !Number.isFinite(weight)) continue;
    total += cost * weight;
  }
  if (!Number.isFinite(total)) return ROUTE_MIN_EDGE_COST;
  return Math.max(ROUTE_MIN_EDGE_COST, total);
}

/* ------------------------------------------------------------------ */
/* 8. Graphe orienté de routage (section 41)                            */
/* ------------------------------------------------------------------ */

/**
 * Arête orientée : un segment parcouru dans un sens, avec tout ce que le calcul
 * d'itinéraire aura besoin de lire — jamais de recalcul pendant l'A*.
 */
export interface RoutingEdge {
  segmentId: string;
  /** Nœud de départ (`nodeKey`, comme partout ailleurs dans l'application). */
  from: string;
  /** Nœud d'arrivée. */
  to: string;
  direction: TraversalDirection;
  /** Profil physique dans ce sens. */
  profile: SegmentProfile;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  /** Distance à vol d'oiseau entre les deux nœuds (m) : base de l'heuristique. */
  spanM: number;
  /** Durée estimée par activité (théorique mêlée d'observé quand c'est publiable). */
  durations: Record<ActivityMode, TimeEstimate>;
  /** Cinq coûts du contrat, par activité. */
  costs: Record<ActivityMode, SegmentCosts>;
  /** Praticabilité par activité (interdiction d'usage, fermeture administrative). */
  allowed: Record<ActivityMode, boolean>;
  /** Difficulté 0..1 dans ce sens. */
  difficulty: number;
  /** Passages des 30 derniers jours, 0 sous le seuil de k-anonymat. */
  passages30d: number;
  /** Score de popularité 0..100, 0 sous le seuil de k-anonymat. */
  popularityScore: number;
  /** Fiabilité de la durée observée dans ce sens. */
  timeConfidence: TimeConfidence;
}

/**
 * Graphe de routage : sommets = nœuds du réseau (extrémités de segments,
 * soudées au mètre par `nodeKey`), arêtes = segments orientés.
 */
export interface RoutingGraph {
  /** Entrées retenues, par identifiant de segment (géométrie, nom, métadonnées). */
  segments: Map<string, RoutingSegmentInput>;
  /** Toutes les arêtes, triées par (segment, sens). */
  edges: RoutingEdge[];
  /** Nœud → arêtes qui en partent, triées de la même façon. */
  adjacency: Map<string, RoutingEdge[]>;
  /** Nœud → position (déduite de la clé, donc arrondie au mètre). */
  nodes: Map<string, LatLng>;
}

/** Arête construite pour un sens donné : tout y est précalculé, une fois pour toutes. */
function makeEdge(
  input: RoutingSegmentInput,
  direction: TraversalDirection,
  from: string,
  to: string,
  fromPos: LatLng,
  toPos: LatLng,
): RoutingEdge {
  const profile = directionProfile(input, direction);
  const stats = directionStats(input, direction);
  const observed = stats === null ? null : stats.duration;
  const difficulty = difficultyFromProfile(profile, input.segment.ford);
  const popularityScore = popularityOf(stats);

  // Un segment fermé est déjà écarté par `isSegmentAllowed` ; la première
  // condition de `allowed` rend la règle lisible sans dépendre de ce détail.
  const perActivity = byActivity((activity) => {
    const estimate = estimateTime({ theoreticalMs: theoreticalTimeMs(profile, activity), observed });
    return {
      estimate,
      costs: costsFromParts(profile, estimate.ms, difficulty, popularityScore, activity),
      allowed: input.segment.status !== "closed" && isSegmentAllowed(input.segment, activity),
    };
  });
  const durations = byActivity((activity) => perActivity[activity].estimate);
  const costs = byActivity((activity) => perActivity[activity].costs);
  const allowed = byActivity((activity) => perActivity[activity].allowed);

  const passages = stats === null ? 0 : stats.passages.last30;
  return {
    segmentId: input.segment.id,
    from,
    to,
    direction,
    profile,
    distanceM: round(positive(profile.distanceM), 3),
    elevationGainM: round(positive(profile.elevationGainM), 3),
    elevationLossM: round(positive(profile.elevationLossM), 3),
    spanM: round(positive(haversineM(fromPos, toPos)), 3),
    durations,
    costs,
    allowed,
    difficulty,
    passages30d: Number.isFinite(passages) ? Math.max(0, Math.round(passages)) : 0,
    popularityScore: round(popularityScore, 2),
    timeConfidence: timeConfidence(observed),
  };
}

/** Ordre total sur les arêtes : (segment, sens). Rend le graphe indépendant de l'ordre d'entrée. */
function compareEdges(a: RoutingEdge, b: RoutingEdge): number {
  return compareKeys(a.segmentId, b.segmentId) || compareKeys(a.direction, b.direction);
}

/**
 * Construit le graphe orienté du routage (section 41).
 *
 * Chaque segment donne **deux** arêtes, aller et retour : un sentier se parcourt
 * dans les deux sens, mais ni au même prix ni avec le même dénivelé. Les nœuds
 * sont ceux de `nodeKey`, pour que le nommage reste celui du reste de
 * l'application (map matching, jonctions, points de confusion).
 *
 * Écartés sans bruit : une géométrie de moins de deux points (pas
 * d'extrémités), un identifiant déjà vu (le premier gagne, donc un doublon
 * d'import ne change pas le résultat), et une boucle fermée sur elle-même
 * (même nœud aux deux bouts : jamais utile pour aller d'un point à un autre).
 *
 * Les interdictions d'usage ne filtrent pas la construction : le même graphe
 * sert à toutes les activités, chaque arête sait pour lesquelles elle est
 * praticable. Coût : linéaire en nombre de segments.
 */
export function buildRoutingGraph(inputs: readonly RoutingSegmentInput[]): RoutingGraph {
  const segments = new Map<string, RoutingSegmentInput>();
  const nodes = new Map<string, LatLng>();
  const edges: RoutingEdge[] = [];

  for (const input of inputs) {
    const segment = input.segment;
    const coordinates = segment.coordinates;
    if (coordinates.length < 2) continue;
    if (segments.has(segment.id)) continue;
    segments.set(segment.id, input);

    const start = nodeKey(coordinates[0]);
    const end = nodeKey(coordinates[coordinates.length - 1]);
    const startPos = nodes.get(start) ?? nodePosition(start);
    const endPos = nodes.get(end) ?? nodePosition(end);
    nodes.set(start, startPos);
    nodes.set(end, endPos);
    if (start === end) continue;

    edges.push(makeEdge(input, "forward", start, end, startPos, endPos));
    edges.push(makeEdge(input, "backward", end, start, endPos, startPos));
  }

  edges.sort(compareEdges);
  const adjacency = new Map<string, RoutingEdge[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from);
    if (list === undefined) adjacency.set(edge.from, [edge]);
    else list.push(edge);
  }

  return { segments, edges, adjacency, nodes };
}

/** Position d'un nœud : celle du graphe, ou celle que sa clé porte déjà. */
function nodeAt(graph: RoutingGraph, key: string): LatLng {
  return graph.nodes.get(key) ?? nodePosition(key);
}

/**
 * Nœud le plus proche d'une position, ou `null` au-delà de `maxDistanceM`.
 *
 * Balayage linéaire (deux appels par itinéraire, négligeable devant l'A*). Les
 * égalités parfaites sont départagées par la clé du nœud : le résultat ne
 * dépend donc pas de l'ordre d'insertion des segments.
 */
export function nearestNode(graph: RoutingGraph, point: LatLng, maxDistanceM = ROUTE_MAX_SNAP_M): string | null {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  const limit = Number.isFinite(maxDistanceM) ? Math.max(0, maxDistanceM) : ROUTE_MAX_SNAP_M;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const [key, position] of graph.nodes) {
    const distance = haversineM(point, position);
    if (!Number.isFinite(distance) || distance > limit) continue;
    if (distance < bestDistance || (distance === bestDistance && best !== null && compareKeys(key, best) < 0)) {
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 9. File de priorité (tas binaire)                                    */
/* ------------------------------------------------------------------ */

interface QueueEntry {
  node: string;
  /** Coût estimé du trajet complet passant par ce nœud : g + h. */
  f: number;
  /** Rang d'insertion : dernier départage, pour un ordre total strict. */
  seq: number;
}

/** Ordre du tas : coût, puis clé de nœud, puis rang d'insertion (aucune égalité). */
function compareEntries(a: QueueEntry, b: QueueEntry): number {
  if (a.f !== b.f) return a.f < b.f ? -1 : 1;
  return compareKeys(a.node, b.node) || (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0);
}

function queuePush(heap: QueueEntry[], entry: QueueEntry): void {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (compareEntries(heap[index], heap[parent]) >= 0) break;
    const swap = heap[parent];
    heap[parent] = heap[index];
    heap[index] = swap;
    index = parent;
  }
}

function queuePop(heap: QueueEntry[]): QueueEntry | null {
  if (heap.length === 0) return null;
  const top = heap[0];
  const last = heap.pop();
  if (last !== undefined && heap.length > 0) {
    heap[0] = last;
    let index = 0;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < heap.length && compareEntries(heap[left], heap[best]) < 0) best = left;
      if (right < heap.length && compareEntries(heap[right], heap[best]) < 0) best = right;
      if (best === index) break;
      const swap = heap[best];
      heap[best] = heap[index];
      heap[index] = swap;
      index = best;
    }
  }
  return top;
}

/* ------------------------------------------------------------------ */
/* 10. A* multicritère (section 41)                                     */
/* ------------------------------------------------------------------ */

/**
 * Coût au mètre le plus favorable du graphe, pour cette activité et ces poids.
 *
 * C'est le facteur de conversion de l'heuristique : multiplié par la distance à
 * vol d'oiseau restante, il donne une minoration du coût restant, puisque
 * aucune arête praticable ne coûte moins que cela par mètre parcouru. Le
 * rapport est calculé sur `max(longueur, portée)` — la portée étant la distance
 * à vol d'oiseau entre les deux nœuds — afin que la minoration reste vraie même
 * quand l'arrondi des clés de nœuds rend la portée légèrement supérieure à la
 * longueur de la géométrie.
 *
 * Aucune arête praticable → 0 : l'heuristique s'annule et l'A* se réduit à un
 * Dijkstra, ce qui reste correct.
 */
export function bestCostPerMeter(
  graph: RoutingGraph,
  activity: ActivityMode,
  weights: Record<keyof SegmentCosts, number>,
): number {
  const mode = safeActivity(activity);
  let best = Infinity;
  for (const edge of graph.edges) {
    if (!edge.allowed[mode]) continue;
    const span = Math.max(edge.distanceM, edge.spanM);
    if (!(span > 0)) continue;
    const ratio = edgeCost(edge.costs[mode], weights) / span;
    if (Number.isFinite(ratio) && ratio < best) best = ratio;
  }
  return Number.isFinite(best) ? Math.max(0, best) : 0;
}

/**
 * Plus court chemin d'un nœud à un autre au sens des poids fournis.
 *
 * A* avec heuristique admissible et consistante (voir l'en-tête) : un nœud sorti
 * du tas est définitivement réglé, ce qui évite de rouvrir des nœuds et garantit
 * l'optimalité. Renvoie la suite d'arêtes, ou `null` si les deux nœuds ne sont
 * pas reliés par des chemins praticables.
 *
 * Les coûts étant strictement positifs, le chemin obtenu ne repasse jamais par
 * un nœud déjà visité : aucune arête n'y figure deux fois.
 */
function searchPath(
  graph: RoutingGraph,
  start: string,
  goal: string,
  activity: ActivityMode,
  weights: Record<keyof SegmentCosts, number>,
): RoutingEdge[] | null {
  if (start === goal) return [];
  const mode = safeActivity(activity);
  const goalPosition = nodeAt(graph, goal);
  const perMeter = bestCostPerMeter(graph, mode, weights);
  const heuristic = (node: string): number => {
    if (perMeter <= 0) return 0;
    const distance = haversineM(nodeAt(graph, node), goalPosition);
    return Number.isFinite(distance) ? distance * perMeter : 0;
  };

  const gScore = new Map<string, number>([[start, 0]]);
  const cameFrom = new Map<string, RoutingEdge>();
  const settled = new Set<string>();
  const heap: QueueEntry[] = [];
  let seq = 0;
  queuePush(heap, { node: start, f: heuristic(start), seq: seq++ });

  while (settled.size <= ROUTE_MAX_SETTLED_NODES) {
    const current = queuePop(heap);
    if (current === null) break;
    if (settled.has(current.node)) continue;
    settled.add(current.node);
    if (current.node === goal) {
      const path: RoutingEdge[] = [];
      let node = goal;
      while (node !== start) {
        const edge = cameFrom.get(node);
        if (edge === undefined) return null;
        path.push(edge);
        node = edge.from;
      }
      path.reverse();
      return path;
    }

    const base = gScore.get(current.node);
    if (base === undefined) continue;
    for (const edge of graph.adjacency.get(current.node) ?? []) {
      if (!edge.allowed[mode]) continue;
      if (settled.has(edge.to)) continue;
      const tentative = base + edgeCost(edge.costs[mode], weights);
      const known = gScore.get(edge.to);
      if (known !== undefined && known <= tentative) continue;
      gScore.set(edge.to, tentative);
      cameFrom.set(edge.to, edge);
      queuePush(heap, { node: edge.to, f: tentative + heuristic(edge.to), seq: seq++ });
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 11. Construction d'un itinéraire complet (section 23)                */
/* ------------------------------------------------------------------ */

/** Niveau de fiabilité le plus bas rencontré, comparé par rang. */
function lowestConfidence(levels: readonly TimeConfidence[]): TimeConfidence {
  let lowest: TimeConfidence = "very_low";
  let rank = Infinity;
  for (const level of levels) {
    const value = TIME_CONFIDENCE_RANK[level] ?? 0;
    if (value < rank) {
      rank = value;
      lowest = level;
    }
  }
  return lowest;
}

/**
 * Géométrie concaténée d'une suite d'arêtes.
 *
 * Chaque arête est lue dans son sens de parcours (géométrie retournée pour un
 * sens `backward`), et le premier point de chaque arête suivante est omis :
 * c'est le nœud de jonction, déjà présent comme dernier point de la précédente.
 * Les deux relevés du même nœud diffèrent parfois de quelques décimètres (deux
 * imports successifs) ; garder celui d'amont évite un micro-aller-retour
 * visible au zoom maximal.
 */
function concatCoordinates(graph: RoutingGraph, edges: readonly RoutingEdge[]): LngLat[] {
  const out: LngLat[] = [];
  for (const edge of edges) {
    const input = graph.segments.get(edge.segmentId);
    if (input === undefined) continue;
    const source = input.segment.coordinates;
    const ordered = edge.direction === "backward" ? [...source].reverse() : source;
    for (let i = out.length === 0 ? 0 : 1; i < ordered.length; i++) {
      const point = ordered[i];
      out.push([point[0], point[1]]);
    }
  }
  return out;
}

/** Assemble la proposition complète décrite par la section 23. */
function buildOption(
  graph: RoutingGraph,
  criterion: RouteCriterion,
  edges: readonly RoutingEdge[],
  activity: ActivityMode,
): RouteOption {
  const legs: RouteLeg[] = [];
  const confidences: TimeConfidence[] = [];
  let distanceM = 0;
  let durationMs = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;
  let difficultyWeighted = 0;
  let popularityWeighted = 0;
  let observedWeighted = 0;
  let difficultySimple = 0;
  let popularitySimple = 0;
  let observedSimple = 0;
  let passages30d = Infinity;

  for (const edge of edges) {
    const input = graph.segments.get(edge.segmentId);
    const estimate = edge.durations[activity];
    const legDistance = edge.distanceM;
    legs.push({
      segmentId: edge.segmentId,
      direction: edge.direction,
      distanceM: Math.round(legDistance),
      durationMs: Math.round(estimate.ms),
      name: input === undefined ? null : input.segment.name,
    });
    distanceM += legDistance;
    durationMs += estimate.ms;
    elevationGainM += edge.elevationGainM;
    elevationLossM += edge.elevationLossM;
    difficultyWeighted += edge.difficulty * legDistance;
    popularityWeighted += edge.popularityScore * legDistance;
    observedWeighted += estimate.observedWeight * legDistance;
    difficultySimple += edge.difficulty;
    popularitySimple += edge.popularityScore;
    observedSimple += estimate.observedWeight;
    confidences.push(edge.timeConfidence);
    // Un maillon peu fréquenté fait la fréquentation réelle du parcours : la
    // moyenne laisserait croire qu'un itinéraire est couru alors qu'il tient à
    // un tronçon que presque personne n'emprunte.
    if (edge.passages30d < passages30d) passages30d = edge.passages30d;
  }

  // Sans distance exploitable (arêtes de longueur nulle), la moyenne pondérée
  // n'a pas de sens : on retombe sur une moyenne simple, jamais sur une
  // division par zéro.
  const count = edges.length;
  const share = (weighted: number, simple: number): number =>
    distanceM > 0 ? weighted / distanceM : count > 0 ? simple / count : 0;

  return {
    criterion,
    legs,
    coordinates: concatCoordinates(graph, edges),
    distanceM: Math.round(distanceM),
    durationMs: Math.round(durationMs),
    elevationGainM: Math.round(elevationGainM),
    elevationLossM: Math.round(elevationLossM),
    passages30d: Number.isFinite(passages30d) ? passages30d : 0,
    popularityScore: round(clamp(share(popularityWeighted, popularitySimple), 0, 100), 2),
    difficulty: round(clamp01(share(difficultyWeighted, difficultySimple)), 4),
    observedWeight: round(clamp01(share(observedWeighted, observedSimple)), 4),
    timeConfidence: lowestConfidence(confidences),
  };
}

/* ------------------------------------------------------------------ */
/* 12. Planification (sections 22, 23, 41)                              */
/* ------------------------------------------------------------------ */

export interface PlanOptions {
  activity: ActivityMode;
  /** Critères demandés, dans l'ordre d'affichage. Défaut : `ROUTE_DEFAULT_CRITERIA`. */
  criteria?: readonly RouteCriterion[];
  /** Rayon de rattachement du départ et de l'arrivée (m). Défaut : `ROUTE_MAX_SNAP_M`. */
  maxSnapM?: number;
}

/** Critères réellement calculables, dédoublonnés, dans l'ordre demandé. */
function requestedCriteria(criteria: readonly RouteCriterion[] | undefined): RouteCriterion[] {
  const source = criteria === undefined || criteria.length === 0 ? ROUTE_DEFAULT_CRITERIA : criteria;
  const seen = new Set<RouteCriterion>();
  const out: RouteCriterion[] = [];
  for (const criterion of source) {
    if (seen.has(criterion)) continue;
    if (ROUTE_CRITERION_WEIGHTS[criterion] === undefined) continue;
    seen.add(criterion);
    out.push(criterion);
  }
  return out;
}

/** Signature d'un itinéraire : la suite exacte des arêtes empruntées. */
function routeSignature(edges: readonly RoutingEdge[]): string {
  return edges.map((edge) => `${edge.segmentId}/${edge.direction}`).join("|");
}

/**
 * Itinéraires de A à B, un par critère demandé (sections 22, 23, 41).
 *
 * Déroulé : rattachement des deux extrémités au nœud le plus proche (`null`
 * au-delà de `maxSnapM` → aucune proposition), puis un A* par critère. Les
 * itinéraires strictement identiques — mêmes arêtes dans le même ordre — sont
 * fusionnés, le premier critère demandé l'emportant : proposer deux fois le
 * même tracé sous deux étiquettes différentes n'aide personne.
 *
 * Renvoie `[]` — jamais une exception — quand le graphe est vide, quand une
 * extrémité est trop loin du réseau, quand départ et arrivée se rattachent au
 * même nœud (il n'y a rien à parcourir), ou quand aucun chemin praticable ne
 * relie les deux points pour cette activité.
 */
export function planRoutes(graph: RoutingGraph, from: LatLng, to: LatLng, options: PlanOptions): RouteOption[] {
  if (graph.nodes.size === 0) return [];
  const activity = safeActivity(options.activity);
  const maxSnapM =
    options.maxSnapM !== undefined && Number.isFinite(options.maxSnapM)
      ? Math.max(0, options.maxSnapM)
      : ROUTE_MAX_SNAP_M;

  const start = nearestNode(graph, from, maxSnapM);
  const goal = nearestNode(graph, to, maxSnapM);
  if (start === null || goal === null || start === goal) return [];

  const routes: RouteOption[] = [];
  const seen = new Set<string>();
  for (const criterion of requestedCriteria(options.criteria)) {
    const weights = criterionWeight(criterion, activity);
    const edges = searchPath(graph, start, goal, activity, weights);
    if (edges === null || edges.length === 0) continue;
    const signature = routeSignature(edges);
    if (seen.has(signature)) continue;
    seen.add(signature);
    routes.push(buildOption(graph, criterion, edges, activity));
  }
  return routes;
}
