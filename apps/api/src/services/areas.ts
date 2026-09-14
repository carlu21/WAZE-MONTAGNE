import { and, gte, lte, sql } from "drizzle-orm";
import { bboxFromCenter, haversineM, inBBox, type BBox, type LatLng } from "@mountain-live/core";
import { db } from "../db/client";
import { areas, type AreaRow } from "../db/schema";
import { normalizeText } from "./util";

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
  const typeOrder: Record<AreaRow["type"], number> = {
    commune: 0,
    massif: 1,
    summit: 2,
    trail: 3,
    pass: 4,
    refuge: 5,
    lake: 6,
    place: 7,
  };
  return rows
    .sort((a, b) => {
      const sa = a.nameNormalized.startsWith(q) ? 0 : 1;
      const sb = b.nameNormalized.startsWith(q) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (typeOrder[a.type] !== typeOrder[b.type]) return typeOrder[a.type] - typeOrder[b.type];
      return a.name.localeCompare(b.name, "fr");
    })
    .slice(0, limit);
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
