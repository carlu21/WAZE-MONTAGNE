/**
 * Moteur cartographique collectif — contrat partagé.
 *
 * Objectif (section 50 du cahier des charges « moteur cartographique ») : ne
 * plus seulement connaître « les chemins présents sur une carte », mais
 * « comment la montagne est réellement parcourue ». La chaîne est toujours la
 * même :
 *
 *   trace brute → qualité des points → map matching → passages par segment
 *   → statistiques agrégées → apprentissage (géométrie, chemins potentiels,
 *   comportements) → coûts de routage → itinéraires proposés
 *
 * Deux règles structurantes traversent tout le module :
 *
 * 1. **La trace brute n'est jamais écrasée** (section 8) : `RawPoint` et
 *    `MatchedPoint` coexistent, ce qui permettra de rejouer les algorithmes.
 * 2. **Vie privée d'abord** (sections 34 à 36) : rien de ce qui sort de ce
 *    module ne permet de suivre une personne. Les observations portent un
 *    `userKey` pseudonymisé (dérivé côté serveur, jamais l'identifiant du
 *    compte), et une statistique n'est publiable qu'au-delà d'un seuil
 *    d'utilisateurs distincts (`K_ANONYMITY_MIN`).
 *
 * Les tables correspondantes sont décrites dans docs/DATA_MODEL.md.
 */
import type { LngLat } from "../geo";
import type { ActivityMode, PathSegment, PathSource, TrackPoint } from "../navigation/types";

/* ------------------------------------------------------------------ */
/* 1. Trace brute et qualité des points (sections 4, 5, 6)             */
/* ------------------------------------------------------------------ */

/**
 * Point GPS tel que mesuré (section 5) : jamais modifié après enregistrement.
 * `accuracy` est le rayon d'incertitude annoncé par le récepteur : aucune
 * position n'est connue « au millimètre » (section 4).
 */
export interface RawPoint extends TrackPoint {
  /** Vitesse sol annoncée par le récepteur (m/s), ou null. */
  speed: number | null;
  /** Cap annoncé par le récepteur (degrés), ou null. */
  heading: number | null;
}

/** Score de qualité d'un point : 0 inutilisable → 5 excellent (section 6). */
export type PointQuality = 0 | 1 | 2 | 3 | 4 | 5;

/** Motif de déclassement d'un point (diagnostic interne). */
export type PointFlag =
  | "accuracy" // incertitude annoncée trop grande
  | "teleport" // saut incompatible avec l'activité, suivi d'un retour
  | "speed" // vitesse implausible
  | "acceleration" // variation de vitesse implausible
  | "heading" // changement de cap incohérent avec la vitesse
  | "duplicate" // même position et même instant
  | "outlier" // isolé par rapport aux points voisins
  | "still"; // immobilité (utile, mais sans valeur pour la géométrie)

export interface ScoredPoint extends RawPoint {
  quality: PointQuality;
  flags: PointFlag[];
  /** Vitesse calculée depuis le point précédent (m/s), ou null. */
  observedSpeedMs: number | null;
  /** Écart (m) au point précédent. */
  stepM: number | null;
}

/* ------------------------------------------------------------------ */
/* 2. Map matching et passages (sections 7, 8, 9, 13, 15)              */
/* ------------------------------------------------------------------ */

/** Point rattaché au réseau (section 8 : MATCHED_TRACE). */
export interface MatchedPoint {
  /** Index du point dans la trace brute (lien RAW ↔ MATCHED). */
  index: number;
  at: number;
  /** Segment retenu, ou null quand aucun chemin connu ne convient. */
  segmentId: string | null;
  /** Position retenue : projetée sur le segment, ou brute si non rattachée. */
  lat: number;
  lng: number;
  /** Abscisse curviligne (m) sur le segment retenu (0 si non rattaché). */
  along: number;
  /** Confiance du rattachement, 0..1. */
  confidence: number;
  /** Écart (m) entre la position brute et le segment retenu. */
  deviationM: number;
  alt: number | null;
  accuracy: number | null;
}

/** Sens de parcours d'un segment : dans l'ordre de sa géométrie, ou à rebours. */
export type TraversalDirection = "forward" | "backward";

/** Passage d'un utilisateur sur un segment (section 13 : SEGMENT_TRAVERSALS). */
export interface SegmentTraversal {
  segmentId: string;
  direction: TraversalDirection;
  /** Entrée et sortie interpolées aux extrémités réellement franchies. */
  enteredAt: number;
  exitedAt: number;
  durationMs: number;
  /** Fraction du segment réellement parcourue (0..1). */
  coverage: number;
  /** Distance parcourue sur ce segment (m). */
  distanceM: number;
  averageSpeedMs: number;
  /** Nombre de points rattachés ayant servi. */
  points: number;
  /** Confiance moyenne du rattachement sur ce passage (0..1). */
  confidence: number;
}

/* ------------------------------------------------------------------ */
/* 3. Observations et statistiques (sections 9 à 16, 26, 30 à 32, 42)  */
/* ------------------------------------------------------------------ */

/**
 * Passage anonymisé alimentant les statistiques. `userKey` est un pseudonyme
 * stable (dérivé d'un secret serveur) : il sert à compter des utilisateurs
 * distincts sans jamais identifier quiconque.
 */
export interface TraversalObservation {
  segmentId: string;
  activity: ActivityMode;
  direction: TraversalDirection;
  /** Fin du passage (ms epoch) : sert à la fraîcheur et à la saisonnalité. */
  at: number;
  durationMs: number;
  distanceM: number;
  coverage: number;
  userKey: string;
  /** Confiance du rattachement (les passages incertains pèsent moins). */
  confidence: number;
}

/** Distribution d'une durée observée (section 13 : médiane privilégiée). */
export interface DurationStats {
  count: number;
  averageMs: number;
  medianMs: number;
  p25Ms: number;
  p75Ms: number;
  /** Écart interquartile rapporté à la médiane (dispersion relative). */
  spread: number;
}

/** Comptages par fenêtre glissante (section 9). */
export interface WindowCounts {
  last7: number;
  last30: number;
  last365: number;
  total: number;
}

/** Indice de fréquentation contextualisé (section 11). */
export type FrequentationLevel = "unknown" | "very_low" | "low" | "moderate" | "high" | "very_high";

/** Clé d'agrégation : « all » / « both » désignent l'agrégat toutes valeurs confondues. */
export interface StatisticsKey {
  segmentId: string;
  activity: ActivityMode | "all";
  direction: TraversalDirection | "both";
}

/** Statistiques d'un segment pour une activité et un sens (section 37). */
export interface SegmentStatistics extends StatisticsKey {
  passages: WindowCounts;
  /** Sessions distinctes (un aller-retour ne compte pas pour deux personnes). */
  uniqueSessions: number;
  uniqueUsers: number;
  duration: DurationStats | null;
  averageSpeedMs: number | null;
  firstPassageAt: number | null;
  lastPassageAt: number | null;
  /** 0..100, pondéré par la fraîcheur des passages (sections 32 et 42). */
  popularityScore: number;
  frequentation: FrequentationLevel;
  /** Fiabilité de ces statistiques, 0..1 (section 26). */
  confidence: number;
  /** Trop peu d'observations pour conclure quoi que ce soit (section 43). */
  insufficientData: boolean;
  /** Répartition des passages par activité (fractions sommant à 1). */
  activityMix: Partial<Record<ActivityMode, number>>;
  /** Passages par mois de l'année, clés « 1 » à « 12 » (section 31). */
  monthly: Record<string, number>;
  /** Passages par heure locale, clés « 0 » à « 23 » (section 31). */
  hourly: Record<string, number>;
  /** Passages des 12 derniers mois rapportés aux 12 précédents, ou null. */
  trend: number | null;
  /** Fréquentation en forte baisse : à vérifier, jamais une conclusion (section 30). */
  possiblyInactive: boolean;
}

/* ------------------------------------------------------------------ */
/* 4. Temps de parcours (sections 13, 14, 16, 24, 25, 26)              */
/* ------------------------------------------------------------------ */

/** Profil physique d'un segment, dans un sens donné (section 16). */
export interface SegmentProfile {
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  /** Pente moyenne signée (%, positive en montée). */
  averageSlope: number;
  /** Pente maximale absolue (%). */
  maxSlope: number;
  surface: string | null;
  sacScale: string | null;
  kind: PathSegment["kind"];
}

export type TimeConfidence = "very_low" | "low" | "medium" | "high" | "very_high";

/** Estimation de durée (section 25 : théorique → observée progressivement). */
export interface TimeEstimate {
  ms: number;
  /** Part des observations dans l'estimation (0 = purement théorique). */
  observedWeight: number;
  theoreticalMs: number;
  observedMs: number | null;
  samples: number;
  confidence: TimeConfidence;
  /** Ajustement personnel appliqué (section 24), 1 = aucun. */
  personalFactor: number | null;
}

/* ------------------------------------------------------------------ */
/* 5. Apprentissage : géométrie et chemins potentiels (17 à 21)        */
/* ------------------------------------------------------------------ */

/** Corridor : faisceau de traces suivant le même passage. */
export interface CorridorTrace {
  userKey: string;
  activity: ActivityMode;
  at: number;
  points: readonly { lat: number; lng: number; accuracy: number | null }[];
}

/** Ligne centrale statistique d'un corridor (section 18). */
export interface Centerline {
  coordinates: LngLat[];
  /** Dispersion latérale (m) des traces autour de la ligne centrale. */
  dispersionM: number;
  observations: number;
  uniqueUsers: number;
  firstSeenAt: number;
  lastSeenAt: number;
  confidence: number;
}

/** Correction de géométrie proposée pour un segment existant (section 17). */
export interface GeometryCandidate extends Centerline {
  segmentId: string;
  /** Décalage latéral moyen signé (m) par rapport à la géométrie actuelle. */
  offsetM: number;
  /** Écart maximal (m) entre la ligne centrale et la géométrie actuelle. */
  maxOffsetM: number;
}

/** Portion de trace hors de tout chemin connu (matière première des nouveaux chemins). */
export interface OffNetworkRun {
  userKey: string;
  activity: ActivityMode;
  at: number;
  /** Indices de début et de fin dans la trace d'origine. */
  fromIndex: number;
  toIndex: number;
  lengthM: number;
  points: readonly { lat: number; lng: number; at: number; accuracy: number | null }[];
}

/** Chemin potentiel détecté collectivement (section 19). */
export interface PotentialTrail {
  /** Identifiant déterministe dérivé de la géométrie (stable entre deux passes). */
  id: string;
  coordinates: LngLat[];
  lengthM: number;
  observations: number;
  uniqueUsers: number;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Dispersion latérale (m) entre les traces du corridor. */
  dispersionM: number;
  activityMix: Partial<Record<ActivityMode, number>>;
  confidence: number;
}

/**
 * Itinéraire réellement observé entre deux nœuds du réseau (matière première
 * des variantes, section 21) : une session complète, réduite à ses extrémités
 * et à la suite des segments empruntés.
 */
export interface PathObservation {
  fromNode: string;
  toNode: string;
  segmentIds: string[];
  distanceM: number;
  durationMs: number;
  userKey: string;
  at: number;
}

/** Variante empruntée entre deux mêmes points (section 21). */
export interface RouteVariant {
  /** Clé du couple de nœuds (extrémités communes). */
  fromNode: string;
  toNode: string;
  segmentIds: string[];
  distanceM: number;
  medianDurationMs: number | null;
  passages: number;
  uniqueUsers: number;
  /** Part des passages de ce couple empruntant cette variante (0..1). */
  share: number;
}

/* ------------------------------------------------------------------ */
/* 6. Apprentissage : comportements (sections 27, 28, 29)              */
/* ------------------------------------------------------------------ */

/**
 * Suite des passages d'une même sortie (sections 28 et 29) : c'est en relisant
 * une session entière que l'on voit un demi-tour ou une erreur d'orientation.
 * `userKey` est déjà pseudonymisé, `at` est la fin de la sortie.
 */
export interface SessionPath {
  userKey: string;
  activity: ActivityMode;
  at: number;
  /** En lecture seule : un détecteur relit une session, il ne la réécrit pas. */
  traversals: readonly SegmentTraversal[];
}

/** Vitesse observée à une abscisse d'un segment (matière première des ralentissements). */
export interface SpeedSample {
  segmentId: string;
  /** Abscisse (m) sur le segment. */
  along: number;
  speedMs: number;
  activity: ActivityMode;
  userKey: string;
  at: number;
}

/** Zone où la majorité ralentit fortement (section 27). */
export interface SlowZone {
  segmentId: string;
  fromAlong: number;
  toAlong: number;
  /** Vitesse médiane dans la zone (m/s). */
  speedMs: number;
  /** Vitesse médiane de référence sur le reste du segment (m/s). */
  referenceSpeedMs: number;
  /** Rapport ralentissement / référence (0..1 : plus bas = plus marqué). */
  ratio: number;
  observations: number;
  uniqueUsers: number;
  confidence: number;
}

/** Demi-tour observé (section 28). */
export interface TurnaroundSpot {
  segmentId: string;
  along: number;
  lat: number;
  lng: number;
  observations: number;
  uniqueUsers: number;
  /** Part des passages du segment qui font demi-tour ici (0..1). */
  rate: number;
  confidence: number;
}

/** Intersection où les usagers se trompent puis reviennent (section 29). */
export interface ConfusionPoint {
  /** Nœud du graphe concerné. */
  nodeKey: string;
  lat: number;
  lng: number;
  observations: number;
  uniqueUsers: number;
  /** Part des passages par ce nœud suivis d'une erreur (0..1). */
  rate: number;
  /** Segments empruntés par erreur, du plus fréquent au moins fréquent. */
  wrongSegmentIds: string[];
  confidence: number;
}

/* ------------------------------------------------------------------ */
/* 7. Routage multicritère (sections 22, 23, 39, 40, 41)               */
/* ------------------------------------------------------------------ */

export type RouteCriterion =
  | "fastest" // le plus rapide (temps observé quand il existe)
  | "shortest" // le plus court
  | "most_used" // le plus emprunté
  | "easiest" // le plus facile (pente, difficulté, surface)
  | "quietest" // le moins fréquenté
  | "recommended"; // compromis adapté à l'activité

/** Coûts d'un segment dans un sens donné (section 39). */
export interface SegmentCosts {
  distance: number;
  time: number;
  difficulty: number;
  popularity: number;
  elevation: number;
}

/** Données nécessaires au routage pour un segment. */
export interface RoutingSegmentInput {
  segment: PathSegment;
  /** Profil dans le sens de la géométrie (le sens inverse est dérivé). */
  profile: SegmentProfile;
  /** Statistiques par sens, si connues. */
  statsForward?: SegmentStatistics | null;
  statsBackward?: SegmentStatistics | null;
}

export interface RouteLeg {
  segmentId: string;
  direction: TraversalDirection;
  distanceM: number;
  durationMs: number;
  name: string | null;
}

/** Itinéraire proposé (section 23). */
export interface RouteOption {
  criterion: RouteCriterion;
  legs: RouteLeg[];
  coordinates: LngLat[];
  /**
   * Provenances des segments empruntés, dédoublonnées. L'affichage s'en sert
   * pour refuser de présenter comme itinéraire un tracé issu du jeu de
   * démonstration : un chemin calculé sur des données fictives reste fictif.
   */
  sources: PathSource[];
  distanceM: number;
  durationMs: number;
  elevationGainM: number;
  elevationLossM: number;
  /** Passages des 30 derniers jours, minimum le long de l'itinéraire. */
  passages30d: number;
  popularityScore: number;
  /** Difficulté moyenne pondérée par la distance (0..1). */
  difficulty: number;
  /** Part de l'itinéraire couverte par des temps réellement observés (0..1). */
  observedWeight: number;
  timeConfidence: TimeConfidence;
}

/* ------------------------------------------------------------------ */
/* 8. Vie privée (sections 34, 35, 36)                                 */
/* ------------------------------------------------------------------ */

/** Statut d'une activité vis-à-vis de la contribution collective (section 35). */
export type ContributionStatus =
  | "private" // conservée pour l'utilisateur seul
  | "contributed" // utilisée pour les statistiques collectives
  | "withdrawn"; // contribution retirée par l'utilisateur

/** Zone à ne jamais exploiter collectivement (domicile, lieu sensible). */
export interface PrivacyZone {
  lat: number;
  lng: number;
  radiusM: number;
}

/** Seuil d'utilisateurs distincts sous lequel une statistique n'est pas publiée. */
export const K_ANONYMITY_MIN = 3;

/** Durée de conservation par défaut des traces brutes (jours). */
export const RAW_TRACE_RETENTION_DAYS = 90;
