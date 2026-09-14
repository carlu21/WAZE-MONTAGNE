import Dexie, { type EntityTable } from "dexie";
import type { BBox, Report, OfficialAlert, Trail, WaterPoint, Area, CreateReportInput } from "@mountain-live/core";

/**
 * Base locale (IndexedDB) pour le mode hors connexion (section 9).
 * - reports  : cache des signalements consultés/téléchargés
 * - zones    : zones téléchargées (métadonnées + contenu du bundle)
 * - outbox   : actions en attente de synchronisation (créations, confirmations)
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

  constructor() {
    super("mountain-live");
    this.version(1).stores({
      reports: "id, category, subtype, status, expiresAt, cachedAt, [lat+lng]",
      zones: "id, downloadedAt",
      outbox: "id, kind, createdAt",
    });
  }
}

export const db = new MountainLiveDB();
