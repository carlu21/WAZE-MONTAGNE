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

/* ------------------------------------------------------------------ */
/* Itinéraires balisés : relations `route=hiking|foot|mtb|horse|running` */
/* ------------------------------------------------------------------ */

export interface OverpassRelation {
  type: "relation";
  id: number;
  members: { type: "node" | "way" | "relation"; ref: number; role?: string }[];
  tags?: Record<string, string>;
}

export interface ImportedTrail {
  id: string;
  name: string;
  type: "hiking" | "trail" | "mtb" | "equestrian" | "mixed";
  difficulty: "easy" | "moderate" | "hard" | "expert";
  distanceKm: number;
  elevationGainM: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  description: string | null;
  /** Nombre de tronçons non raccordés (qualité de la donnée). */
  gaps: number;
}

const ROUTE_TYPES: Record<string, ImportedTrail["type"]> = { hiking: "hiking", foot: "hiking", running: "trail", mtb: "mtb", horse: "equestrian" };
const SKIP_ROLES = /alternative|excursion|approach|connection|variant|shortcut/i;
const SAC_ORDER = ["hiking", "mountain_hiking", "demanding_mountain_hiking", "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"];

/** Requête Overpass : itinéraires balisés dont au moins un membre touche l'emprise, membres inclus (récursif). */
export function overpassRoutesQuery(bbox: { west: number; south: number; east: number; north: number }, timeoutS = 300): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:${timeoutS}];relation["type"~"^(route|superroute)$"]["route"~"^(hiking|foot|mtb|horse|running)$"](${b})->.r;.r out body;.r >> ->.m;.m out body qt;`;
}

function key(c: LngLat): string {
  return `${Math.round(c[0] * 1e6)}:${Math.round(c[1] * 1e6)}`;
}

/** Enchaîne des tronçons par leurs extrémités communes (sens inversé au besoin). */
export function chainWays(ways: readonly LngLat[][]): LngLat[][] {
  const remaining = ways.filter((w) => w.length >= 2).map((w) => w.map((c) => [c[0], c[1]] as LngLat));
  const parts: LngLat[][] = [];
  while (remaining.length) {
    const part = remaining.shift()!;
    let extended = true;
    while (extended) {
      extended = false;
      const head = key(part[0]);
      const tail = key(part[part.length - 1]);
      for (let i = 0; i < remaining.length; i++) {
        const w = remaining[i];
        const ws = key(w[0]);
        const we = key(w[w.length - 1]);
        if (ws === tail) part.push(...w.slice(1));
        else if (we === tail) part.push(...[...w].reverse().slice(1));
        else if (we === head) part.unshift(...w.slice(0, -1));
        else if (ws === head) part.unshift(...[...w].reverse().slice(0, -1));
        else continue;
        remaining.splice(i, 1);
        extended = true;
        break;
      }
    }
    parts.push(part);
  }
  return parts;
}

function distM(a: LngLat, b: LngLat): number {
  const cos = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * 111_320 * cos, (a[1] - b[1]) * 111_320);
}

/** Raccorde des tronçons dans l'ordre en choisissant l'orientation qui minimise l'écart ; renvoie le nombre d'écarts > 50 m. */
export function mergeParts(parts: readonly LngLat[][]): { line: LngLat[]; gaps: number } {
  if (parts.length === 0) return { line: [], gaps: 0 };
  const pool = parts.map((p) => [...p]);
  const line = pool.shift()!;
  let gaps = 0;
  while (pool.length) {
    const end = line[line.length - 1];
    let best = 0;
    let bestD = Infinity;
    let reverse = false;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      const d0 = distM(end, p[0]);
      const d1 = distM(end, p[p.length - 1]);
      if (d0 < bestD) {
        bestD = d0;
        best = i;
        reverse = false;
      }
      if (d1 < bestD) {
        bestD = d1;
        best = i;
        reverse = true;
      }
    }
    const [next] = pool.splice(best, 1);
    const seq = reverse ? [...next].reverse() : next;
    if (bestD > 50) gaps++;
    line.push(...(bestD < 1 ? seq.slice(1) : seq));
  }
  return { line, gaps };
}

function difficultyFromSac(scales: readonly string[]): ImportedTrail["difficulty"] {
  let max = -1;
  for (const s of scales) max = Math.max(max, SAC_ORDER.indexOf(s));
  if (max <= 0) return max === 0 ? "easy" : "moderate";
  if (max === 1) return "moderate";
  if (max === 2) return "hard";
  return "expert";
}

function lengthM(line: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += distM(line[i - 1], line[i]);
  return total;
}

/** Relations d'itinéraires → sentiers (géométrie assemblée, longueur, difficulté, description). */
export function routesFromOverpass(json: OverpassJson, opts: { minLengthM?: number } = {}): ImportedTrail[] {
  const minLength = opts.minLengthM ?? 800;
  const nodes = new Map<number, LngLat>();
  const ways = new Map<number, { coords: LngLat[]; tags: Record<string, string> }>();
  const relations = new Map<number, OverpassRelation>();
  for (const el of json.elements ?? []) {
    if (el.type === "node") {
      const n = el as OverpassNode;
      if (Number.isFinite(n.lat) && Number.isFinite(n.lon)) nodes.set(n.id, [n.lon, n.lat]);
    } else if (el.type === "way") {
      const w = el as OverpassWay;
      const coords: LngLat[] = [];
      for (const id of w.nodes) {
        const c = nodes.get(id);
        if (c) coords.push(c);
      }
      ways.set(w.id, { coords, tags: w.tags ?? {} });
    } else if (el.type === "relation") relations.set((el as OverpassRelation).id, el as OverpassRelation);
  }
  // Les nœuds peuvent arriver après les chemins (out qt) : seconde passe.
  for (const el of json.elements ?? []) {
    if (el.type !== "way") continue;
    const w = el as OverpassWay;
    const entry = ways.get(w.id);
    if (entry && entry.coords.length < w.nodes.length) entry.coords = w.nodes.map((id) => nodes.get(id)).filter((c): c is LngLat => Boolean(c));
  }

  const collect = (rel: OverpassRelation, visited: Set<number>, out: { coords: LngLat[]; tags: Record<string, string> }[]): void => {
    if (visited.has(rel.id)) return;
    visited.add(rel.id);
    for (const m of rel.members ?? []) {
      if (m.role && SKIP_ROLES.test(m.role)) continue;
      if (m.type === "way") {
        const w = ways.get(m.ref);
        if (w && w.coords.length >= 2) out.push(w);
      } else if (m.type === "relation") {
        const sub = relations.get(m.ref);
        if (sub) collect(sub, visited, out);
      }
    }
  };

  const out: ImportedTrail[] = [];
  for (const rel of relations.values()) {
    const tags = rel.tags ?? {};
    const type = ROUTE_TYPES[tags.route ?? ""];
    if (!type || !(tags.type === "route" || tags.type === "superroute")) continue;
    const members: { coords: LngLat[]; tags: Record<string, string> }[] = [];
    collect(rel, new Set(), members);
    if (members.length === 0) continue;
    const parts = chainWays(members.map((m) => m.coords));
    const { line, gaps } = mergeParts(parts);
    const total = lengthM(line);
    if (line.length < 2 || total < minLength) continue;
    const ascent = Number(String(tags.ascent ?? "").replace(/[^\d.]/g, ""));
    const name = tags.name ?? tags.ref ?? (tags.from && tags.to ? `${tags.from} → ${tags.to}` : `Itinéraire ${rel.id}`);
    const descParts = [tags.description ?? tags.note ?? null, tags.from && tags.to && !name.includes(tags.from) ? `${tags.from} → ${tags.to}` : null, tags.operator ? `Balisage : ${tags.operator}` : null].filter(Boolean);
    out.push({
      id: `osm_rel_${rel.id}`,
      name,
      type,
      difficulty: difficultyFromSac(members.map((m) => m.tags.sac_scale).filter((s): s is string => Boolean(s))),
      distanceKm: Math.round(total / 100) / 10,
      elevationGainM: Number.isFinite(ascent) && ascent > 0 ? Math.round(ascent) : 0,
      geometry: { type: "LineString", coordinates: line.map((c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]) },
      description: descParts.length ? descParts.join(" · ") : null,
      gaps,
    });
  }
  return out.sort((a, b) => b.distanceKm - a.distanceKm);
}
