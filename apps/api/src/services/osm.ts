/**
 * Conversion des données OpenStreetMap (réponse Overpass JSON ou GeoJSON) en
 * segments du réseau de chemins. Règles d'accès par défaut selon `highway`,
 * affinées par les tags `foot`, `bicycle`, `horse`, `access`, `ford`, etc.
 */
import type { LngLat, PathKind, PathSegment } from "@mountain-live/core";
import { splitAtSharedNodes, type RawWay } from "./paths";

export interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}
export interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}
export interface OverpassJson {
  elements: (OverpassNode | OverpassWay | { type: string })[];
}

/** Types `highway` retenus par l'import (sentiers, pistes, liaisons). */
export const HIGHWAY_FILTER = ["path", "track", "footway", "bridleway", "cycleway", "steps", "via_ferrata", "unclassified", "living_street", "pedestrian", "service"] as const;

export function kindFromHighway(highway: string | undefined): PathKind {
  switch (highway) {
    case "path":
    case "footway":
    case "bridleway":
    case "cycleway":
    case "steps":
    case "track":
    case "via_ferrata":
      return highway;
    case "pedestrian":
      return "footway";
    case "unclassified":
    case "living_street":
    case "service":
    case "residential":
    case "tertiary":
      return "road";
    default:
      return "unknown";
  }
}

const NO = new Set(["no", "private", "discouraged", "use_sidepath"]);
const YES = new Set(["yes", "designated", "permissive", "official", "dismount"]);

function accessFlag(tags: Record<string, string>, key: string, fallback: boolean): boolean {
  const v = tags[key];
  if (v && NO.has(v)) return false;
  if (v && YES.has(v)) return true;
  const access = tags.access;
  if (access && NO.has(access) && !(v && YES.has(v))) return false;
  return fallback;
}

export function parseWidth(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.replace(",", ".").match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

/** Métadonnées d'un chemin à partir des tags OSM. */
export function metaFromTags(tags: Record<string, string>): RawWay["meta"] {
  const highway = tags.highway;
  const kind = kindFromHighway(highway);
  const defaults = {
    foot: kind !== "cycleway" || tags.foot !== undefined ? true : true,
    bicycle: kind === "footway" || kind === "steps" || kind === "via_ferrata" ? false : true,
    horse: kind === "steps" || kind === "via_ferrata" || kind === "cycleway" ? false : true,
  };
  const status: PathSegment["status"] = tags.access === "no" && !tags.foot && !tags.bicycle && !tags.horse ? "closed" : null;
  return {
    name: tags.name ?? tags.ref ?? null,
    kind,
    surface: tags.surface ?? null,
    sacScale: tags.sac_scale ?? null,
    widthM: parseWidth(tags.width),
    foot: accessFlag(tags, "foot", defaults.foot),
    bicycle: accessFlag(tags, "bicycle", defaults.bicycle),
    horse: accessFlag(tags, "horse", defaults.horse),
    ford: tags.ford === "yes" || tags.ford === "stepping_stones",
    status,
    source: "osm",
  };
}

/** Réponse Overpass (`out body; >; out skel qt;`) → segments découpés aux intersections. */
export function segmentsFromOverpass(json: OverpassJson): PathSegment[] {
  const nodes = new Map<number, LngLat>();
  const ways: OverpassWay[] = [];
  for (const el of json.elements ?? []) {
    if (el.type === "node") {
      const n = el as OverpassNode;
      if (Number.isFinite(n.lat) && Number.isFinite(n.lon)) nodes.set(n.id, [n.lon, n.lat]);
    } else if (el.type === "way") ways.push(el as OverpassWay);
  }
  const raw: RawWay[] = [];
  for (const w of ways) {
    const tags = w.tags ?? {};
    if (!tags.highway || !(HIGHWAY_FILTER as readonly string[]).includes(tags.highway)) continue;
    const coordinates: LngLat[] = [];
    for (const id of w.nodes) {
      const c = nodes.get(id);
      if (c) coordinates.push(c);
    }
    if (coordinates.length < 2) continue;
    raw.push({ id: `osm_${w.id}`, coordinates, meta: metaFromTags(tags) });
  }
  return splitAtSharedNodes(raw);
}

interface GeoJsonFeature {
  type: "Feature";
  id?: string | number;
  properties?: Record<string, unknown> | null;
  geometry: { type: string; coordinates: unknown } | null;
}

/** GeoJSON de LineString/MultiLineString avec propriétés OSM (ex. export Overpass Turbo ou QGIS). */
export function segmentsFromGeoJson(json: { type: string; features?: GeoJsonFeature[] }): PathSegment[] {
  const raw: RawWay[] = [];
  let n = 0;
  for (const f of json.features ?? []) {
    if (!f.geometry) continue;
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.properties ?? {})) if (typeof v === "string") tags[k] = v;
    if (!tags.highway) tags.highway = "path";
    const lines: unknown[] = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as unknown[]) : [];
    for (const line of lines) {
      const coordinates = (line as number[][]).filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => [c[0], c[1]] as LngLat);
      if (coordinates.length < 2) continue;
      const base = tags["@id"] ?? tags.id ?? (f.id !== undefined ? String(f.id) : null);
      raw.push({ id: base ? `osm_${String(base).replace(/^way\//, "")}${lines.length > 1 ? `_${n}` : ""}` : `geo_${n}`, coordinates, meta: metaFromTags(tags) });
      n++;
    }
  }
  return splitAtSharedNodes(raw);
}

/** Requête Overpass QL pour une emprise `south,west,north,east`. */
export function overpassQuery(bbox: { west: number; south: number; east: number; north: number }, timeoutS = 180): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const re = `^(${HIGHWAY_FILTER.join("|")})$`;
  return `[out:json][timeout:${timeoutS}];(way["highway"~"${re}"](${b}););out body;>;out skel qt;`;
}
