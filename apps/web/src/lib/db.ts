import Dexie, { type EntityTable } from "dexie";
import type { BBox, Report, OfficialAlert, Trail, WaterPoint, Area, CreateReportInput, PathSegment, TrackPoint, TrackStats } from "@mountain-live/core";

/**
 * Base locale (IndexedDB) pour le mode hors connexion (section 9).
 * - reports  : cache des signalements consultés/téléchargés
 * - zones    : zones téléchargées (métadonnées + contenu du bundle)
 * - outbox   : actions en attente de synchronisation (créations, confirmations)
 * - pathCells: réseau de chemins par cellule (~5 km), pour le map matching hors connexion
 * - tracks   : traces enregistrées par l'utilisateur (jamais envoyées au serveur)
 */
export interface CachedReport extends Report {
  cachedAt: number;
}

export interface OfflineZone {
  id: string;
  name: string;
  bbox: BBox;
  downloadedAt: number;
  tileCount: number;
  bytesEstimate: number;
  reports: Report[];
  officialAlerts: OfficialAlert[];
  trails: Trail[];
  waterPoints: WaterPoint[];
  areas: Area[];
  /** Réseau de chemins de la zone (absent des zones téléchargées avant la navigation). */
  paths?: PathSegment[];
}

/** Cellule de réseau de chemins mise en cache (clé « lng:lat » sur une grille de 0,05°). */
export interface PathCell {
  id: string;
  fetchedAt: number;
  paths: PathSegment[];
}

/** Trace enregistrée localement (section 17). */
export interface SavedTrack {
  id: string;
  name: string;
  activity: "hiking" | "trail" | "mtb" | "equestrian";
  savedAt: number;
  points: TrackPoint[];
  stats: TrackStats;
}

export type OutboxItem =
  | {
      id: string; // clientId
      kind: "create_report";
      createdAt: number;
      attempts: number;
      lastError?: string;
      payload: CreateReportInput;
      photo?: Blob;
    }
  | {
      id: string;
      kind: "confirm";
      createdAt: number;
      attempts: number;
      lastError?: string;
      payload: { reportId: string; kind: "still_present" | "improved" | "gone" | "disputed"; comment?: string | null };
    };

export class MountainLiveDB extends Dexie {
  reports!: EntityTable<CachedReport, "id">;
  zones!: EntityTable<OfflineZone, "id">;
  outbox!: EntityTable<OutboxItem, "id">;
  pathCells!: EntityTable<PathCell, "id">;
  tracks!: EntityTable<SavedTrack, "id">;

  constructor() {
    super("mountain-live");
    this.version(1).stores({
      reports: "id, category, subtype, status, expiresAt, cachedAt, [lat+lng]",
      zones: "id, downloadedAt",
      outbox: "id, kind, createdAt",
    });
    this.version(2).stores({
      pathCells: "id, fetchedAt",
      tracks: "id, savedAt",
    });
  }
}

export const db = new MountainLiveDB();
