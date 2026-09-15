/**
 * Réseau de chemins (module navigation) : lecture par emprise, insertion en
 * lot, et découpage des lignes aux nœuds partagés pour que chaque intersection
 * soit une extrémité de segment (hypothèse du graphe côté client).
 */
import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { makeSegment, nodeKey, type BBox, type LngLat, type PathSegment } from "@mountain-live/core";
import { db } from "../db/client";
import { paths, type PathRow } from "../db/schema";
import { nowIso } from "./util";

export function toPathSegment(row: PathRow): PathSegment {
  return {
    id: row.id,
    name: row.name ?? null,
    kind: row.kind,
    surface: row.surface ?? null,
    sacScale: row.sacScale ?? null,
    widthM: row.widthM ?? null,
    foot: row.foot,
    bicycle: row.bicycle,
    horse: row.horse,
    ford: row.ford,
    status: row.status ?? null,
    coordinates: row.coordinates,
    elevations: row.elevations ?? null,
    lengthM: row.lengthM,
    source: row.source,
    sourceFeatureId: row.sourceFeatureId ?? null,
  };
}

/** Segments dont l'emprise croise la bbox (au plus `limit`, les plus courts d'abord ne sont pas privilégiés). */
export function listPathsInBBox(box: BBox, limit = 5000): PathRow[] {
  return db
    .select()
    .from(paths)
    .where(and(lte(paths.minLat, box.north), gte(paths.maxLat, box.south), lte(paths.minLng, box.east), gte(paths.maxLng, box.west)))
    .limit(limit)
    .all();
}

export function countPaths(): number {
  const row = db.select({ n: sql<number>`count(*)` }).from(paths).get();
  return row?.n ?? 0;
}

function extent(coords: readonly LngLat[]): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of coords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, minLng, maxLat, maxLng };
}

/** Insère ou remplace des segments (lots de 500 dans une transaction). Renvoie le nombre traité. */
export function upsertPaths(segments: readonly PathSegment[]): number {
  const now = nowIso();
  let n = 0;
  for (let i = 0; i < segments.length; i += 500) {
    const batch = segments.slice(i, i + 500).filter((s) => s.coordinates.length >= 2);
    if (batch.length === 0) continue;
    db.transaction((tx) => {
      for (const s of batch) {
        const e = extent(s.coordinates);
        tx.insert(paths)
          .values({
            id: s.id,
            name: s.name,
            kind: s.kind,
            surface: s.surface,
            sacScale: s.sacScale,
            widthM: s.widthM,
            foot: s.foot,
            bicycle: s.bicycle,
            horse: s.horse,
            ford: s.ford,
            status: s.status,
            coordinates: s.coordinates.map((c) => [c[0], c[1]] as [number, number]),
            elevations: s.elevations,
            lengthM: s.lengthM,
            source: s.source,
            sourceFeatureId: s.sourceFeatureId,
            ...e,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: paths.id,
            set: { name: s.name, kind: s.kind, surface: s.surface, sacScale: s.sacScale, widthM: s.widthM, foot: s.foot, bicycle: s.bicycle, horse: s.horse, ford: s.ford, status: s.status, coordinates: s.coordinates.map((c) => [c[0], c[1]] as [number, number]), elevations: s.elevations, lengthM: s.lengthM, source: s.source, sourceFeatureId: s.sourceFeatureId, ...e, updatedAt: now },
          })
          .run();
      }
    });
    n += batch.length;
  }
  return n;
}

export function deletePathsBySource(source: PathSegment["source"]): number {
  const res = db.delete(paths).where(sql`${paths.source} = ${source}`).run();
  return Number(res.changes ?? 0);
}

export interface RawWay {
  id: string;
  coordinates: LngLat[];
  meta: Partial<Omit<PathSegment, "id" | "coordinates" | "lengthM">>;
}

/**
 * UN OBJET SOURCE → TOUS LES SEGMENTS QUI EN SONT ISSUS.
 *
 * Un way OpenStreetMap découpé à ses intersections donne plusieurs segments.
 * Cette fonction est le SEUL endroit qui sait faire la correspondance : elle
 * interroge `source_feature_id`, et ne devine rien à partir des identifiants.
 * Tout le reste du code passe par elle.
 */
export function segmentRowsByFeatureIds(featureIds: readonly string[]): Map<string, PathRow[]> {
  const out = new Map<string, PathRow[]>();
  const unique = [...new Set(featureIds)].filter((id) => id.length > 0);
  if (unique.length === 0) return out;
  // SQLite plafonne le nombre de paramètres d'une requête : on interroge par lots.
  for (let i = 0; i < unique.length; i += 400) {
    const batch = unique.slice(i, i + 400);
    const rows = db.select().from(paths).where(inArray(paths.sourceFeatureId, batch)).all();
    for (const row of rows) {
      const key = row.sourceFeatureId;
      if (key === null) continue;
      const list = out.get(key);
      if (list) list.push(row);
      else out.set(key, [row]);
    }
  }
  return out;
}

/** Identifiant d'objet source OpenStreetMap, dans la forme retenue partout : `way/891234`. */
export function osmFeatureId(wayId: number | string): string {
  return `way/${String(wayId).replace(/^way\//, "")}`;
}

/**
 * Découpe des lignes aux nœuds partagés par plusieurs lignes (ou visités deux
 * fois par la même) : chaque intersection devient une extrémité de segment.
 * Les identifiants sont suffixés `_0`, `_1`… uniquement quand une ligne est découpée.
 */
export function splitAtSharedNodes(ways: readonly RawWay[]): PathSegment[] {
  const usage = new Map<string, number>();
  for (const w of ways) {
    const seen = new Set<string>();
    for (const c of w.coordinates) {
      const k = nodeKey(c);
      usage.set(k, (usage.get(k) ?? 0) + 1);
      if (seen.has(k)) usage.set(k, (usage.get(k) ?? 0) + 1);
      seen.add(k);
    }
  }
  const out: PathSegment[] = [];
  for (const w of ways) {
    if (w.coordinates.length < 2) continue;
    const parts: LngLat[][] = [];
    let current: LngLat[] = [w.coordinates[0]];
    for (let i = 1; i < w.coordinates.length; i++) {
      const c = w.coordinates[i];
      current.push(c);
      const shared = (usage.get(nodeKey(c)) ?? 0) >= 2;
      if (shared && i < w.coordinates.length - 1) {
        parts.push(current);
        current = [c];
      }
    }
    parts.push(current);
    parts.forEach((coords, idx) => {
      if (coords.length < 2) return;
      const id = parts.length === 1 ? w.id : `${w.id}_${idx}`;
      // Tous les morceaux d'un way gardent l'identifiant de CE way : c'est ce
      // qui permettra de retrouver l'ensemble, découpage compris.
      out.push(makeSegment(id, coords, w.meta));
    });
  }
  return out;
}
