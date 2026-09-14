import { nanoid } from "nanoid";
import type { BBox, GeoJsonGeometry, LatLng } from "@mountain-live/core";

export const nowIso = (): string => new Date().toISOString();
export const newId = (): string => nanoid(16);

/** Minuscules, sans accents ni ponctuation superflue : base des recherches insensibles à la casse. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Enveloppe et centroïde d'une géométrie GeoJSON (Point, LineString, Polygon). */
export function geometryExtent(g: GeoJsonGeometry): { bbox: BBox; centroid: LatLng } {
  const points: [number, number][] =
    g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.coordinates.flat();
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let sumLat = 0;
  let sumLng = 0;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    sumLat += lat;
    sumLng += lng;
  }
  const n = Math.max(1, points.length);
  return { bbox: { west, south, east, north }, centroid: { lat: sumLat / n, lng: sumLng / n } };
}

export function parseBool(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

export function formatDateFr(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  }).format(d);
}
