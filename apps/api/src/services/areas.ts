import { and, gte, lte, sql } from "drizzle-orm";
import { bboxFromCenter, haversineM, inBBox, type BBox, type LatLng } from "@mountain-live/core";
import { db } from "../db/client";
import { areas, type AreaRow } from "../db/schema";
import { normalizeText } from "./util";
import { config } from "../config";
import { geocodeOnline, type GeocodedPlace } from "./geocoder";

/** Lieu de référence le plus proche (commune, massif, sommet…) dans un rayon donné. */
export function nearestArea(p: LatLng, maxDistanceM: number): { area: AreaRow; distanceM: number } | null {
  const box = bboxFromCenter(p, maxDistanceM);
  const candidates = db
    .select()
    .from(areas)
    .where(and(gte(areas.lat, box.south), lte(areas.lat, box.north), gte(areas.lng, box.west), lte(areas.lng, box.east)))
    .all();
  let best: { area: AreaRow; distanceM: number } | null = null;
  for (const area of candidates) {
    const d = haversineM(p, { lat: area.lat, lng: area.lng });
    if (d <= maxDistanceM && (!best || d < best.distanceM)) best = { area, distanceM: d };
  }
  return best;
}

/** Nom de zone déduit (section 25 « zone ») : lieu le plus proche ou null. */
export function deriveZoneName(p: LatLng, maxDistanceM: number): string | null {
  const nearest = nearestArea(p, maxDistanceM);
  if (!nearest) return null;
  // On privilégie une commune ou un massif quand un tel lieu est à portée raisonnable :
  // c'est plus parlant qu'un refuge ou un lac, sans pour autant être trop loin.
  const box = bboxFromCenter(p, maxDistanceM);
  const named = db
    .select()
    .from(areas)
    .where(
      and(
        sql`${areas.type} IN ('commune', 'massif')`,
        gte(areas.lat, box.south),
        lte(areas.lat, box.north),
        gte(areas.lng, box.west),
        lte(areas.lng, box.east),
      ),
    )
    .all()
    .map((a) => ({ area: a, distanceM: haversineM(p, { lat: a.lat, lng: a.lng }) }))
    .filter((x) => x.distanceM <= maxDistanceM)
    .sort((a, b) => a.distanceM - b.distanceM)[0];
  if (named && named.distanceM <= nearest.distanceM * 2.5) return named.area.name;
  return nearest.area.name;
}

/**
 * Recherche insensible à la casse et aux accents (normalisation NFD), 15 résultats max,
 * les correspondances en début de nom d'abord.
 */
export function searchAreas(query: string, limit = 15): AreaRow[] {
  const q = normalizeText(query);
  if (!q) return [];
  const escaped = q.replace(/[%_]/g, (m) => `\\${m}`);
  const rows = db
    .select()
    .from(areas)
    .where(sql`${areas.nameNormalized} LIKE ${`%${escaped}%`} ESCAPE '\\'`)
    .limit(60)
    .all();
  return dedupeAreaRows(sortAreaResults(rows, q)).slice(0, limit);
}

/** Supprime les doublons (même nom normalisé à moins d'un kilomètre), en gardant le premier dans l'ordre de tri. */
export function dedupeAreaRows<T extends Pick<AreaRow, "name" | "lat" | "lng">>(rows: readonly T[]): T[] {
  const kept: T[] = [];
  for (const row of rows) {
    const key = normalizeText(row.name);
    const duplicate = kept.some((k) => normalizeText(k.name) === key && haversineM({ lat: k.lat, lng: k.lng }, { lat: row.lat, lng: row.lng }) < 1000);
    if (!duplicate) kept.push(row);
  }
  return kept;
}

const TYPE_ORDER: Record<AreaRow["type"], number> = {
  commune: 0,
  massif: 1,
  summit: 2,
  hamlet: 3,
  trail: 4,
  pass: 5,
  refuge: 6,
  lake: 7,
  spring: 8,
  place: 9,
};

/** Tri commun : nom commençant par la requête d'abord, puis type, puis ordre alphabétique. */
export function sortAreaResults<T extends Pick<AreaRow, "name" | "nameNormalized" | "type">>(rows: T[], normalizedQuery: string): T[] {
  return rows.sort((a, b) => {
    const sa = a.nameNormalized.startsWith(normalizedQuery) ? 0 : 1;
    const sb = b.nameNormalized.startsWith(normalizedQuery) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    if (TYPE_ORDER[a.type] !== TYPE_ORDER[b.type]) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
    return a.name.localeCompare(b.name, "fr");
  });
}

/** Fusion des résultats locaux et en ligne : un lieu en ligne est ignoré s'il double un lieu local (même nom à moins d'un kilomètre). */
export function mergeAreaResults(local: readonly AreaRow[], online: readonly GeocodedPlace[], query: string, limit = 15): AreaRow[] {
  const q = normalizeText(query);
  const merged: AreaRow[] = [...local];
  for (const p of online) {
    const key = normalizeText(p.name);
    const duplicate = merged.some((a) => {
      const an = normalizeText(a.name);
      return (an === key || an.startsWith(key) || key.startsWith(an)) && haversineM({ lat: a.lat, lng: a.lng }, { lat: p.lat, lng: p.lng }) < 1000;
    });
    if (duplicate) continue;
    merged.push({ id: p.id, name: p.name, nameNormalized: p.nameNormalized, type: p.type, lat: p.lat, lng: p.lng, bbox: null, elevation: p.elevation, description: p.description });
  }
  return sortAreaResults(merged, q).slice(0, limit);
}

/**
 * Recherche complète : base locale (jeu de démonstration + référentiel importé), complétée par le
 * géocodeur en ligne quand la base répond peu (lieux-dits absents, autre région…).
 */
export async function searchAreasWithFallback(query: string, opts: { lat?: number; lng?: number; limit?: number } = {}): Promise<AreaRow[]> {
  const limit = opts.limit ?? 15;
  const local = searchAreas(query, limit);
  const q = normalizeText(query);
  if (!config.geocoder.enabled || q.length < 3 || local.length >= 8) return local;
  const online = await geocodeOnline(query, { lat: opts.lat, lng: opts.lng, limit: 10 });
  if (online.length === 0) return local;
  return mergeAreaResults(local, online, query, limit);
}

export function listAreasInBBox(box: BBox): AreaRow[] {
  return db
    .select()
    .from(areas)
    .where(and(gte(areas.lat, box.south), lte(areas.lat, box.north), gte(areas.lng, box.west), lte(areas.lng, box.east)))
    .all()
    .filter((a) => inBBox({ lat: a.lat, lng: a.lng }, box));
}

/** Boîte englobante d'un lieu : sa bbox déclarée ou un rayon par défaut autour du centre. */
export function areaBBox(area: AreaRow, fallbackRadiusM: number): BBox {
  return area.bbox ?? bboxFromCenter({ lat: area.lat, lng: area.lng }, fallbackRadiusM);
}
