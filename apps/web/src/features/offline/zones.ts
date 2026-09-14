/**
 * Zones hors connexion (section 9) : téléchargement du bundle de données
 * (signalements, alertes, sentiers, points d'eau, lieux) et préchargement des
 * tuiles topographiques dans le cache « map-tiles » partagé avec le service worker.
 */
import type { BBox } from "@mountain-live/core";
import { api } from "@/lib/api";
import { db, type OfflineZone } from "@/lib/db";
import { cacheReports } from "@/features/map/useReports";
import { MAX_TILES, countTiles, estimateBytes, tileUrls } from "./tiles";

export const TILES_CACHE = "map-tiles";
export const BATCH = 6;

export interface DownloadProgress {
  done: number;
  total: number;
  failed: number;
  phase: "data" | "tiles" | "finished";
}

export class ZoneTooLargeError extends Error {
  constructor(public tiles: number) {
    super("zone_too_large");
  }
}

async function openTilesCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(TILES_CACHE);
  } catch {
    return null;
  }
}

async function fetchTile(url: string, cache: Cache | null): Promise<boolean> {
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return true;
  }
  try {
    let res = await fetch(url, { mode: "cors", cache: "force-cache" });
    if (!res.ok) throw new Error(String(res.status));
    if (cache) await cache.put(url, res.clone());
    return true;
  } catch {
    try {
      // Repli : réponse opaque (sans CORS), mise en cache telle quelle.
      const res = await fetch(url, { mode: "no-cors", cache: "force-cache" });
      if (cache) await cache.put(url, res.clone());
      return true;
    } catch {
      return false;
    }
  }
}

export async function downloadZone(
  input: { id?: string; name: string; bbox: BBox },
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<OfflineZone> {
  const tiles = countTiles(input.bbox);
  if (tiles > MAX_TILES) throw new ZoneTooLargeError(tiles);
  onProgress({ done: 0, total: tiles, failed: 0, phase: "data" });

  const bundle = await api.offline.bundle(input.bbox);
  await cacheReports(bundle.reports);

  const urls = tileUrls(input.bbox);
  const cache = await openTilesCache();
  let done = 0;
  let failed = 0;
  for (let i = 0; i < urls.length; i += BATCH) {
    if (signal?.aborted) throw new DOMException("Téléchargement annulé", "AbortError");
    const results = await Promise.all(urls.slice(i, i + BATCH).map((u) => fetchTile(u, cache)));
    for (const ok of results) (ok ? (done += 1) : (failed += 1));
    onProgress({ done: done + failed, total: urls.length, failed, phase: "tiles" });
  }

  const zone: OfflineZone = {
    id: input.id ?? `z_${Date.now().toString(36)}`,
    name: input.name,
    bbox: input.bbox,
    downloadedAt: Date.now(),
    tileCount: done,
    bytesEstimate: estimateBytes(done),
    reports: bundle.reports,
    officialAlerts: bundle.officialAlerts,
    trails: bundle.trails,
    waterPoints: bundle.waterPoints,
    areas: bundle.areas,
    paths: bundle.paths ?? [],
  };
  await db.zones.put(zone);
  onProgress({ done: urls.length, total: urls.length, failed, phase: "finished" });
  return zone;
}

export async function listZones(): Promise<OfflineZone[]> {
  return db.zones.orderBy("downloadedAt").reverse().toArray();
}

/** Supprime la zone et ses tuiles (celles qui ne sont pas couvertes par une autre zone). */
export async function deleteZone(id: string): Promise<void> {
  const zone = await db.zones.get(id);
  if (!zone) return;
  const others = (await db.zones.toArray()).filter((z) => z.id !== id);
  const keep = new Set(others.flatMap((z) => tileUrls(z.bbox)));
  const cache = await openTilesCache();
  if (cache) {
    await Promise.all(tileUrls(zone.bbox).filter((u) => !keep.has(u)).map((u) => cache.delete(u).catch(() => false)));
  }
  await db.zones.delete(id);
}

export function defaultZoneName(date: Date = new Date()): string {
  return `Zone du ${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`;
}

export function parseBBoxParam(raw: string | null): BBox | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = parts;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}
