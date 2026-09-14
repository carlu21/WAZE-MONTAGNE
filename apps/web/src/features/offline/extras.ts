/** Données annexes des zones téléchargées (alertes officielles, points d'eau, sentiers) pour l'usage hors connexion. */
import { inBBox, type BBox, type OfficialAlert, type Trail, type WaterPoint } from "@mountain-live/core";
import { db } from "@/lib/db";

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

export interface OfflineExtras {
  officialAlerts: OfficialAlert[];
  waterPoints: WaterPoint[];
  trails: Trail[];
}

export async function offlineExtras(bbox: BBox, now: number = Date.now()): Promise<OfflineExtras> {
  const alerts = new Map<string, OfficialAlert>();
  const water = new Map<string, WaterPoint>();
  const trails = new Map<string, Trail>();
  try {
    for (const z of await db.zones.toArray()) {
      if (!bboxIntersects(z.bbox, bbox)) continue;
      for (const a of z.officialAlerts) {
        if (a.endsAt && new Date(a.endsAt).getTime() < now) continue;
        if (inBBox({ lat: a.centroidLat, lng: a.centroidLng }, bbox)) alerts.set(a.id, a);
      }
      for (const w of z.waterPoints) if (inBBox(w, bbox)) water.set(w.id, w);
      for (const t of z.trails) trails.set(t.id, t);
    }
  } catch {
    /* IndexedDB indisponible */
  }
  return { officialAlerts: [...alerts.values()], waterPoints: [...water.values()], trails: [...trails.values()] };
}
