/**
 * Contrat de transport de la collecte GPX : ce que l'API expose au client.
 *
 * Deux choses n'en sortent jamais : le contenu d'un fichier dont la licence
 * interdit la redistribution, et une géométrie présentée sans sa provenance.
 */
import type { LngLat } from "../geo";
import type { ActivityMode, PathSegment } from "../navigation/types";
import type { SegmentKnowledgeUsage } from "./knowledge";
import type {
  DataSource,
  DiscoveredResource,
  DiscoveryQuery,
  GeometryLayer,
  GpxQualityFlag,
  GpxQualityLevel,
  LicenceId,
  ReuseDecision,
  SegmentConfidence,
  SourceType,
  TerritoryStep,
  TraceComparison,
} from "./types";

/** Source telle qu'affichée au back-office, avec sa décision de réutilisation. */
export interface DataSourceDto extends DataSource {
  decision: ReuseDecision;
  /** Importation automatique possible en l'état ? */
  autoImport: boolean;
  /** Traces déjà importées depuis cette source. */
  traceCount: number;
}

export interface SourcesResponse {
  sources: DataSourceDto[];
  byStatus: Record<string, number>;
}

/** Trace de la bibliothèque (section 15). */
export interface ImportedTraceDto {
  id: string;
  name: string | null;
  description: string | null;
  sourceId: string | null;
  sourceName: string | null;
  origin: "manual_upload" | "url_import" | "api_import" | "discovery";
  originUrl: string | null;
  format: "gpx" | "kml" | "geojson";
  licence: LicenceId;
  attribution: string | null;
  territory: string | null;
  activity: ActivityMode | "all";
  distanceM: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  points: number;
  qualityScore: number | null;
  qualityLevel: GpxQualityLevel | null;
  qualityFlags: GpxQualityFlag[];
  /** Part de la trace rattachée au réseau connu. */
  matchedRatio: number | null;
  /** Segments empruntés (section 6). */
  segmentCount: number;
  status: "review_required" | "approved" | "rejected" | "merged";
  duplicateOf: string | null;
  version: number;
  recordedAt: string | null;
  importedAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface TracesResponse {
  traces: ImportedTraceDto[];
  total: number;
}

/** Détail d'une trace : géométrie et rattachement. */
export interface TraceDetail {
  trace: ImportedTraceDto;
  coordinates: LngLat[];
  elevations: number[] | null;
  /** Segments empruntés, dans l'ordre du parcours. */
  legs: { segmentId: string; segmentName: string | null; reversed: boolean; distanceM: number; coverage: number; deviationM: number | null }[];
  /** Portions sans chemin connu : matière première des nouveaux chemins. */
  gaps: { fromM: number; toM: number; coordinates: LngLat[] }[];
  versions: { version: number; lengthM: number; changedM: number | null; reason: string | null; createdAt: string }[];
}

/** Réponse à l'envoi d'un fichier ou d'une URL (sections 17 et 18). */
export interface ImportTraceResponse {
  trace: ImportedTraceDto;
  decision: ReuseDecision;
  /** Résumé lisible : distance, D+, D−, points, zone, chemins correspondants. */
  summary: {
    distanceM: number;
    elevationGainM: number | null;
    elevationLossM: number | null;
    points: number;
    bbox: { west: number; south: number; east: number; north: number };
    matchedSegments: number;
    matchedRatio: number;
    quality: string;
  };
  duplicateOf: string | null;
  note: string | null;
}

/** Comparaison de plusieurs traces d'un même parcours (section 10). */
export interface TraceComparisonResponse {
  comparisons: TraceComparison[];
  /** Faisceaux détectés : traces indépendantes suivant le même passage. */
  corridors: {
    id: string;
    traceIds: string[];
    coordinates: LngLat[];
    lengthM: number;
    dispersionM: number;
    uniqueSources: number;
    confidence: number;
  }[];
  note: string | null;
}

/** Territoire du back-office (section 16). */
export interface TerritoryDto {
  id: string;
  name: string;
  country: string;
  parentId: string | null;
  aliases: string[];
  bbox: { west: number; south: number; east: number; north: number } | null;
  /** Ce que l'on sait déjà de ce territoire. */
  coverage: {
    segments: number;
    withSource: number;
    withTrace: number;
    withPassages: number;
    averageConfidence: number | null;
  };
  traces: number;
}

export interface TerritoriesResponse {
  territories: TerritoryDto[];
}

/** Plan d'ouverture d'un territoire, avant toute exécution (section 23). */
export interface TerritoryPlanResponse {
  territory: TerritoryDto;
  steps: TerritoryStep[];
  /** Requêtes que la campagne soumettrait, visibles avant d'être lancées. */
  queries: DiscoveryQuery[];
  /** Le réseau sortant est-il utilisable depuis le serveur ? */
  networkAvailable: boolean;
  note: string;
}

/** Bilan d'une campagne : ne compte QUE ce qui a été réellement constaté. */
export interface CampaignResponse {
  territory: string;
  inspected: DiscoveredResource[];
  summary: { total: number; byStatus: Record<string, number>; byFormat: Record<string, number>; withGpx: number };
  networkAvailable: boolean;
  note: string;
}

export interface DiscoveriesResponse {
  discoveries: DiscoveredResource[];
  byStatus: Record<string, number>;
}

/** Fiche de connaissance d'un segment servie au client (section 30). */
export interface SegmentSourcesResponse {
  segmentId: string;
  name: string | null;
  /** Géométrie retenue et couche dont elle provient. */
  geometry: { layer: GeometryLayer; coordinates: LngLat[]; lengthM: number; points: number };
  confidence: SegmentConfidence;
  sources: { id: string; name: string; type: SourceType; licence: LicenceId; attribution: string | null }[];
  /** Itinéraires importés empruntant ce segment. */
  itineraries: { id: string; name: string | null }[];
  lastValidatedAt: string | null;
  /**
   * Usage réel. Les champs valent `null` tant que rien n'a été mesuré :
   * « pas encore de données » n'est pas « personne n'y passe ».
   */
  usage: SegmentKnowledgeUsage;
  /** Phrase prête à afficher, qui ne conclut jamais au-delà des données. */
  summary: string;
  /** Mentions d'attribution à afficher (section 22). */
  attributions: string[];
}

/** Segment enrichi de sa provenance, pour les couches carte. */
export interface SegmentWithProvenance {
  segment: PathSegment;
  layer: GeometryLayer | null;
  confidence: number | null;
  sourceCount: number;
  traceCount: number;
}
