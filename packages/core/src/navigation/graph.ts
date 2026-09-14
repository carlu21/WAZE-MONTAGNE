/**
 * Graphe du réseau de chemins : nœuds aux extrémités des segments (une
 * intersection est un nœud partagé par ≥ 3 segments), index spatial par
 * grille pour retrouver rapidement les segments voisins d'une position.
 *
 * Le graphe est incrémental : les segments arrivent par zones (bundle hors
 * connexion, requêtes par emprise) et s'ajoutent sans reconstruction.
 */
import type { BBox, LatLng } from "../types";
import { METERS_PER_DEG_LAT, bboxFromCenter, type LngLat } from "../geo";
import type { ActivityMode, PathSegment } from "./types";

/** Pas de la grille spatiale (~550 m en latitude). */
export const GRID_CELL_DEG = 0.005;

export interface PathGraph {
  segments: Map<string, PathSegment>;
  /** Clé de nœud → identifiants des segments qui y aboutissent. */
  nodes: Map<string, string[]>;
  /** Segment → clés de ses deux nœuds (départ, arrivée). */
  ends: Map<string, [string, string]>;
  /** Emprise de chaque segment (accélère le filtrage). */
  bboxes: Map<string, BBox>;
  /** Cellule de grille → identifiants de segments. */
  grid: Map<string, string[]>;
}

/** Clé de nœud : coordonnées arrondies à 1e-5° (≈ 1 m), assez pour souder les extrémités OSM. */
export function nodeKey(c: LngLat): string {
  return `${Math.round(c[0] * 1e5)}:${Math.round(c[1] * 1e5)}`;
}

export function nodePosition(key: string): LatLng {
  const [x, y] = key.split(":").map(Number);
  return { lng: x / 1e5, lat: y / 1e5 };
}

function cellKey(lng: number, lat: number): string {
  return `${Math.floor(lng / GRID_CELL_DEG)}:${Math.floor(lat / GRID_CELL_DEG)}`;
}

function segmentBBox(seg: PathSegment): BBox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of seg.coordinates) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

function cellsOf(b: BBox): string[] {
  const out: string[] = [];
  const x0 = Math.floor(b.west / GRID_CELL_DEG);
  const x1 = Math.floor(b.east / GRID_CELL_DEG);
  const y0 = Math.floor(b.south / GRID_CELL_DEG);
  const y1 = Math.floor(b.north / GRID_CELL_DEG);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x}:${y}`);
  return out;
}

export function createPathGraph(): PathGraph {
  return { segments: new Map(), nodes: new Map(), ends: new Map(), bboxes: new Map(), grid: new Map() };
}

/** Ajoute des segments (les identifiants déjà présents sont ignorés). Renvoie le nombre ajouté. */
export function addSegments(graph: PathGraph, segments: readonly PathSegment[]): number {
  let added = 0;
  for (const seg of segments) {
    if (graph.segments.has(seg.id) || seg.coordinates.length < 2) continue;
    graph.segments.set(seg.id, seg);
    const start = nodeKey(seg.coordinates[0]);
    const end = nodeKey(seg.coordinates[seg.coordinates.length - 1]);
    graph.ends.set(seg.id, [start, end]);
    for (const key of start === end ? [start] : [start, end]) {
      const list = graph.nodes.get(key);
      if (list) list.push(seg.id);
      else graph.nodes.set(key, [seg.id]);
    }
    const b = segmentBBox(seg);
    graph.bboxes.set(seg.id, b);
    for (const cell of cellsOf(b)) {
      const list = graph.grid.get(cell);
      if (list) list.push(seg.id);
      else graph.grid.set(cell, [seg.id]);
    }
    added++;
  }
  return added;
}

export function buildPathGraph(segments: readonly PathSegment[]): PathGraph {
  const g = createPathGraph();
  addSegments(g, segments);
  return g;
}

/** Segments dont l'emprise croise le disque de rayon `radiusM` autour de `point`. */
export function segmentsNear(graph: PathGraph, point: LatLng, radiusM: number): PathSegment[] {
  const q = bboxFromCenter(point, radiusM);
  const seen = new Set<string>();
  const out: PathSegment[] = [];
  for (const cell of cellsOf(q)) {
    const ids = graph.grid.get(cell);
    if (!ids) continue;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const b = graph.bboxes.get(id);
      if (!b || b.west > q.east || b.east < q.west || b.south > q.north || b.north < q.south) continue;
      const seg = graph.segments.get(id);
      if (seg) out.push(seg);
    }
  }
  return out;
}

/** Deux segments partagent-ils un nœud ? */
export function areConnected(graph: PathGraph, a: string, b: string): boolean {
  if (a === b) return true;
  const ea = graph.ends.get(a);
  const eb = graph.ends.get(b);
  if (!ea || !eb) return false;
  return ea[0] === eb[0] || ea[0] === eb[1] || ea[1] === eb[0] || ea[1] === eb[1];
}

export function nodeDegree(graph: PathGraph, key: string): number {
  return graph.nodes.get(key)?.length ?? 0;
}

export interface Junction {
  key: string;
  position: LatLng;
  degree: number;
  segmentIds: string[];
}

/** Intersections (degré ≥ 3) à moins de `radiusM` de `point`. */
export function junctionsNear(graph: PathGraph, point: LatLng, radiusM: number): Junction[] {
  const out: Junction[] = [];
  const cosLat = Math.cos((point.lat * Math.PI) / 180);
  for (const seg of segmentsNear(graph, point, radiusM)) {
    const ends = graph.ends.get(seg.id);
    if (!ends) continue;
    for (const key of ends) {
      const ids = graph.nodes.get(key) ?? [];
      if (ids.length < 3 || out.some((j) => j.key === key)) continue;
      const p = nodePosition(key);
      const dx = (p.lng - point.lng) * METERS_PER_DEG_LAT * cosLat;
      const dy = (p.lat - point.lat) * METERS_PER_DEG_LAT;
      if (Math.hypot(dx, dy) <= radiusM) out.push({ key, position: p, degree: ids.length, segmentIds: [...ids] });
    }
  }
  return out;
}

/** Densité locale : nombre de segments distincts dans le rayon (sert à adapter les seuils). */
export function pathDensity(graph: PathGraph, point: LatLng, radiusM = 100): number {
  return segmentsNear(graph, point, radiusM).length;
}

/** Le segment est-il praticable pour cette activité ? (`steps` exclut VTT et cheval.) */
export function isSegmentAllowed(seg: PathSegment, activity: ActivityMode): boolean {
  if (seg.status === "closed") return false;
  switch (activity) {
    case "mtb":
      return seg.bicycle && seg.kind !== "steps" && seg.kind !== "via_ferrata";
    case "equestrian":
      return seg.horse && seg.kind !== "steps" && seg.kind !== "via_ferrata";
    default:
      return seg.foot;
  }
}

/** Construit un segment à partir d'une géométrie et de métadonnées partielles. */
export function makeSegment(id: string, coordinates: LngLat[], meta: Partial<Omit<PathSegment, "id" | "coordinates" | "lengthM">> = {}): PathSegment {
  let lengthM = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const cosLat = Math.cos((coordinates[i][1] * Math.PI) / 180);
    const dx = (coordinates[i][0] - coordinates[i - 1][0]) * METERS_PER_DEG_LAT * cosLat;
    const dy = (coordinates[i][1] - coordinates[i - 1][1]) * METERS_PER_DEG_LAT;
    lengthM += Math.hypot(dx, dy);
  }
  return {
    id,
    name: meta.name ?? null,
    kind: meta.kind ?? "path",
    surface: meta.surface ?? null,
    sacScale: meta.sacScale ?? null,
    widthM: meta.widthM ?? null,
    foot: meta.foot ?? true,
    bicycle: meta.bicycle ?? true,
    horse: meta.horse ?? true,
    ford: meta.ford ?? false,
    status: meta.status ?? null,
    coordinates,
    elevations: meta.elevations ?? null,
    lengthM: Math.round(lengthM),
    source: meta.source ?? "local",
  };
}
