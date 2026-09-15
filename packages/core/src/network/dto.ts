/**
 * Contrat de transport du moteur cartographique collectif : ce que l'API
 * expose au client. Rien ici ne contient de position individuelle : les
 * activités sont celles de l'utilisateur authentifié, tout le reste est agrégé.
 */
import type { LngLat } from "../geo";
import type { ActivityMode, PathSegment } from "../navigation/types";
import type {
  ContributionStatus,
  FrequentationLevel,
  PotentialTrail,
  RouteCriterion,
  RouteOption,
  SegmentProfile,
  SegmentStatistics,
  TimeConfidence,
  TraversalDirection,
} from "./types";

/** Point brut envoyé par le client (trace enregistrée pendant l'activité). */
export interface ActivityPointInput {
  /** Horodatage en millisecondes (epoch). */
  at: number;
  lat: number;
  lng: number;
  alt?: number | null;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
}

/** Activité telle que renvoyée à son auteur. */
export interface ActivityDto {
  id: string;
  name: string | null;
  activityType: ActivityMode;
  source: "recorded" | "gpx";
  startedAt: string;
  endedAt: string;
  distanceM: number;
  durationMs: number;
  movingMs: number;
  elevationGainM: number;
  elevationLossM: number;
  maxAltM: number | null;
  averageSpeedMs: number | null;
  pointCount: number;
  /** Qualité moyenne de la trace (0..5) et part de points rattachés (0..1). */
  qualityScore: number | null;
  matchedRatio: number | null;
  contribution: ContributionStatus;
  contributedAt: string | null;
  processedAt: string | null;
  /** Nombre de segments du réseau réellement parcourus. */
  segmentCount: number;
  /** La trace brute est-elle encore conservée ? */
  hasRawTrace: boolean;
}

/** Réponse à l'envoi d'une activité. */
export interface CreateActivityResponse {
  activity: ActivityDto;
  /** Passages retenus, segments distincts, portions hors réseau détectées. */
  traversals: number;
  segments: number;
  offNetworkRuns: number;
  /** La contribution a-t-elle été retenue (consentement et qualité suffisants) ? */
  contributed: boolean;
  /** Raison d'un refus de contribution, le cas échéant. */
  contributionNote: string | null;
}

export interface ActivitiesResponse {
  activities: ActivityDto[];
  total: number;
}

/** Durées observées pour un segment, par activité et par sens. */
export interface SegmentTimeDto {
  activity: ActivityMode;
  direction: TraversalDirection;
  /** Estimation retenue (théorique, mixte ou observée). */
  ms: number;
  observedMs: number | null;
  theoreticalMs: number;
  samples: number;
  confidence: TimeConfidence;
  /** Part des observations dans l'estimation (0..1). */
  observedWeight: number;
}

/** Fiche complète d'un chemin (section 33). */
export interface SegmentDetail {
  segment: PathSegment;
  profile: SegmentProfile;
  /** Statistiques toutes activités et tous sens confondus. */
  overall: SegmentStatistics;
  /** Statistiques par activité (agrégat des deux sens). */
  byActivity: SegmentStatistics[];
  times: SegmentTimeDto[];
  frequentation: FrequentationLevel;
  /** Phrase prête à afficher (« Très fréquenté par les randonneurs »). */
  frequentationLabel: string;
  /** Nom du chemin ou de l'itinéraire auquel il appartient. */
  trailName: string | null;
  /** Signalements actifs sur ce segment. */
  reportCount: number;
  /** Observations comportementales publiées sur ce segment. */
  notes: SegmentNote[];
}

/** Observation comportementale rattachée à un segment (sections 27 à 29). */
export interface SegmentNote {
  kind: "slow_zone" | "turnaround" | "confusion";
  label: string;
  detail: string;
  /** Abscisse (m) sur le segment, si ponctuelle. */
  along: number | null;
  confidence: number;
}

/** Trait de la carte de fréquentation (section 12). */
export interface HeatmapSegment {
  segmentId: string;
  coordinates: LngLat[];
  /** Passages sur la période demandée. */
  passages: number;
  popularityScore: number;
  frequentation: FrequentationLevel;
  /** Activité dominante sur ce chemin, si elle se dégage nettement. */
  dominantActivity: ActivityMode | null;
  insufficientData: boolean;
}

export type HeatmapPeriod = "today" | "week" | "month" | "year" | "all";

export interface HeatmapResponse {
  period: HeatmapPeriod;
  activity: ActivityMode | "all";
  segments: HeatmapSegment[];
  /** Passages maximum de la réponse : sert à l'échelle de couleur. */
  maxPassages: number;
  /** Couverture : part des segments de la zone disposant de données. */
  coverage: number;
  generatedAt: string;
}

export interface RoutePlanRequest {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  activity: ActivityMode;
  criteria?: RouteCriterion[];
}

export interface RoutePlanResponse {
  options: RouteOption[];
  /** Aucun nœud du réseau assez proche du départ ou de l'arrivée. */
  unreachable: boolean;
  note: string | null;
}

/** Candidature soumise à modération (sections 17 à 21, 27 à 30, 46). */
export interface NetworkCandidateDto {
  id: string;
  kind: "new_trail" | "geometry" | "variant" | "slow_zone" | "turnaround" | "confusion" | "inactive";
  status: "open" | "accepted" | "rejected" | "merged";
  segmentId: string | null;
  segmentName: string | null;
  coordinates: LngLat[] | null;
  observations: number;
  uniqueUsers: number;
  confidence: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface NetworkCandidatesResponse {
  candidates: NetworkCandidateDto[];
  total: number;
  /** Nombre de candidatures ouvertes par nature. */
  openByKind: Record<string, number>;
}

/** Synthèse analytique du réseau (section 44 : tableau de bord). */
export interface NetworkOverview {
  period: { from: string; to: string };
  /** Segments disposant d'au moins un passage. */
  segmentsWithData: number;
  segmentsTotal: number;
  activitiesCount: number;
  contributorsCount: number;
  passagesCount: number;
  distanceM: number;
  byActivity: Record<string, number>;
  /** Passages par mois, clé « AAAA-MM ». */
  monthly: Record<string, number>;
  /** Passages par heure locale. */
  hourly: Record<string, number>;
  topSegments: { segmentId: string; name: string | null; passages: number; popularityScore: number }[];
  openCandidates: Record<string, number>;
  /** Chemins potentiels les plus solides. */
  potentialTrails: PotentialTrail[];
}
