/**
 * Données d'événements pour la navigation : signalements, alertes officielles
 * et points d'eau autour de l'itinéraire ou de la position. En ligne via l'API
 * (et mise en cache locale), hors connexion depuis IndexedDB (cache des
 * signalements consultés + zones téléchargées).
 */
import { expandBBox, inBBox, type BBox, type OfficialAlert, type Report, type WaterPoint } from "@mountain-live/core";
import { api } from "@/lib/api";
import { db } from "@/lib/db";
import { cacheReports } from "@/features/map/useReports";
import { useUiStore } from "@/store/ui";

export interface NavData {
  reports: Report[];
  officialAlerts: OfficialAlert[];
  waterPoints: WaterPoint[];
  bbox: BBox;
  fetchedAt: number;
  offline: boolean;
}

export function routeBBox(coordinates: readonly [number, number][] | readonly (readonly [number, number])[], marginFactor = 1.2): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of coordinates) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  // Marge minimale de ~1 km autour d'un itinéraire très court.
  const b = { west: west - 0.01, south: south - 0.008, east: east + 0.01, north: north + 0.008 };
  return expandBBox(b, marginFactor);
}

async function fromLocal(bbox: BBox): Promise<Omit<NavData, "bbox" | "fetchedAt" | "offline">> {
  const reports = new Map<string, Report>();
  const alerts = new Map<string, OfficialAlert>();
  const water = new Map<string, WaterPoint>();
  try {
    for (const r of await db.reports.toArray()) if (inBBox(r, bbox)) reports.set(r.id, r);
    for (const z of await db.zones.toArray()) {
      for (const r of z.reports) if (inBBox(r, bbox)) reports.set(r.id, r);
      for (const a of z.officialAlerts) if (inBBox({ lat: a.centroidLat, lng: a.centroidLng }, bbox)) alerts.set(a.id, a);
      for (const w of z.waterPoints) if (inBBox(w, bbox)) water.set(w.id, w);
    }
  } catch {
    /* IndexedDB indisponible */
  }
  return { reports: [...reports.values()], officialAlerts: [...alerts.values()], waterPoints: [...water.values()] };
}

export async function loadNavData(bbox: BBox): Promise<NavData> {
  const online = useUiStore.getState().online;
  if (online) {
    try {
      const [list, water] = await Promise.all([api.reports.list({ bbox, limit: 500 }), api.waterPoints(bbox)]);
      void cacheReports(list.reports);
      return { reports: list.reports, officialAlerts: list.officialAlerts, waterPoints: water.waterPoints, bbox, fetchedAt: Date.now(), offline: false };
    } catch {
      /* repli local */
    }
  }
  const local = await fromLocal(bbox);
  return { ...local, bbox, fetchedAt: Date.now(), offline: true };
}
