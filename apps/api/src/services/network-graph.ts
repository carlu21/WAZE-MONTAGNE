/**
 * Chargement du réseau de chemins en mémoire pour les traitements du moteur
 * cartographique (map matching différé, routage, apprentissage).
 *
 * SQLite n'a pas d'index spatial : les segments sont filtrés par leur emprise
 * (colonnes min/max lat/lng, indexées) puis assemblés dans le graphe en
 * mémoire de @mountain-live/core, qui porte sa propre grille spatiale. Le jour
 * où la base passera sur PostGIS, seule cette fonction changera : tout le
 * reste du moteur travaille sur `PathGraph`, jamais sur SQL.
 */
import { and, gte, lte } from "drizzle-orm";
import { buildPathGraph, expandBBox, type BBox, type PathGraph, type PathSegment } from "@mountain-live/core";
import { db } from "../db/client";
import { paths, type PathRow } from "../db/schema";
import { toPathSegment } from "./paths";

/** Marge ajoutée autour de l'emprise demandée (facteur) : les segments débordent. */
const BBOX_MARGIN = 1.4;

export function segmentRowsInBBox(box: BBox, limit = 20_000): PathRow[] {
  const b = expandBBox(box, BBOX_MARGIN);
  return db
    .select()
    .from(paths)
    .where(and(lte(paths.minLat, b.north), gte(paths.maxLat, b.south), lte(paths.minLng, b.east), gte(paths.maxLng, b.west)))
    .limit(limit)
    .all();
}

export function segmentsInBBox(box: BBox, limit = 20_000): PathSegment[] {
  return segmentRowsInBBox(box, limit).map(toPathSegment);
}

/** Graphe de la zone demandée (rechargé à chaque appel : les traitements sont ponctuels). */
export function graphForBBox(box: BBox, limit = 20_000): PathGraph {
  return buildPathGraph(segmentsInBBox(box, limit));
}

/** Index segmentId → segment, pour les traitements qui n'ont pas besoin du graphe. */
export function segmentIndex(segments: readonly PathSegment[]): Map<string, PathSegment> {
  return new Map(segments.map((s) => [s.id, s]));
}

/** Emprise d'une suite de positions, avec une marge minimale d'environ 500 m. */
export function boundsOf(points: readonly { lat: number; lng: number }[]): BBox | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  return { west: west - 0.005, south: south - 0.004, east: east + 0.005, north: north + 0.004 };
}
