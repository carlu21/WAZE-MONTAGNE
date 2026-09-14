/** Calculs de tuiles Web Mercator pour le préchargement hors connexion. */
import type { BBox } from "@mountain-live/core";

export const OFFLINE_MIN_ZOOM = 10;
export const OFFLINE_MAX_ZOOM = 15;
export const MAX_TILES = 4000;
export const BYTES_PER_TILE = 25 * 1024;
export const TILE_HOSTS = ["https://a.tile.opentopomap.org", "https://b.tile.opentopomap.org", "https://c.tile.opentopomap.org"];

export function lon2tile(lng: number, zoom: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}
export function lat2tile(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom);
}

export interface TileRange {
  z: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  count: number;
}

export function tileRanges(bbox: BBox, minZoom = OFFLINE_MIN_ZOOM, maxZoom = OFFLINE_MAX_ZOOM): TileRange[] {
  const out: TileRange[] = [];
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const xMin = lon2tile(bbox.west, z);
    const xMax = lon2tile(bbox.east, z);
    const yMin = lat2tile(bbox.north, z);
    const yMax = lat2tile(bbox.south, z);
    out.push({ z, xMin, xMax, yMin, yMax, count: (xMax - xMin + 1) * (yMax - yMin + 1) });
  }
  return out;
}

export function countTiles(bbox: BBox, minZoom = OFFLINE_MIN_ZOOM, maxZoom = OFFLINE_MAX_ZOOM): number {
  return tileRanges(bbox, minZoom, maxZoom).reduce((n, r) => n + r.count, 0);
}

export function estimateBytes(tileCount: number): number {
  return tileCount * BYTES_PER_TILE;
}

/** Liste des URL de tuiles, hôte réparti pour respecter la politique OpenTopoMap. */
export function tileUrls(bbox: BBox, minZoom = OFFLINE_MIN_ZOOM, maxZoom = OFFLINE_MAX_ZOOM): string[] {
  const urls: string[] = [];
  let i = 0;
  for (const r of tileRanges(bbox, minZoom, maxZoom)) {
    for (let x = r.xMin; x <= r.xMax; x += 1) {
      for (let y = r.yMin; y <= r.yMax; y += 1) {
        urls.push(`${TILE_HOSTS[i % TILE_HOSTS.length]}/${r.z}/${x}/${y}.png`);
        i += 1;
      }
    }
  }
  return urls;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0).replace(".", ",")} Mo`;
}
