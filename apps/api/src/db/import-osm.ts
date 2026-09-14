/**
 * Import du réseau de chemins OpenStreetMap dans la table `paths` (module navigation).
 *
 *   pnpm --filter @mountain-live/api geo:import-osm                          # Corse par défaut (Overpass)
 *   pnpm --filter @mountain-live/api geo:import-osm -- --bbox 8.9,42.1,9.2,42.4
 *   pnpm --filter @mountain-live/api geo:import-osm -- --file ./sentiers.json     # réponse Overpass JSON
 *   pnpm --filter @mountain-live/api geo:import-osm -- --file ./sentiers.geojson  # export GeoJSON (Overpass Turbo, QGIS…)
 *   pnpm --filter @mountain-live/api geo:import-osm -- --url https://overpass.kumi.systems/api/interpreter
 *
 * Données © les contributeurs OpenStreetMap, licence ODbL (https://www.openstreetmap.org/copyright).
 * L'emprise est découpée en dalles de 0,25° pour rester sous les limites d'Overpass ; l'import est
 * idempotent (identifiants osm_<way>) : relancer met à jour les segments existants.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BBox, PathSegment } from "@mountain-live/core";
import { ensureDatabase } from "./migrate";
import { overpassQuery, segmentsFromGeoJson, segmentsFromOverpass, type OverpassJson } from "../services/osm";
import { countPaths, upsertPaths } from "../services/paths";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(here, "..", "..", "data", "osm");
const DEFAULT_URL = "https://overpass-api.de/api/interpreter";
/** Corse (territoire pilote). */
const CORSICA: BBox = { west: 8.5, south: 41.3, east: 9.6, north: 43.1 };
const TILE_DEG = 0.25;

interface Options {
  bbox: BBox;
  file: string | null;
  url: string;
  tile: number;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { bbox: CORSICA, file: null, url: DEFAULT_URL, tile: TILE_DEG };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = (): string => {
      const eq = a.indexOf("=");
      if (eq >= 0) return a.slice(eq + 1);
      i += 1;
      return argv[i] ?? "";
    };
    if (a.startsWith("--bbox")) {
      const parts = value().split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error("--bbox attend ouest,sud,est,nord");
      opts.bbox = { west: parts[0], south: parts[1], east: parts[2], north: parts[3] };
    } else if (a.startsWith("--file")) opts.file = value();
    else if (a.startsWith("--url")) opts.url = value();
    else if (a.startsWith("--tile")) opts.tile = Number(value()) || TILE_DEG;
    else if (a === "--help" || a === "-h") {
      console.log("Options : --bbox ouest,sud,est,nord | --file <overpass.json|export.geojson> | --url <overpass> | --tile 0.25");
      process.exit(0);
    }
  }
  return opts;
}

function tiles(b: BBox, step: number): BBox[] {
  const out: BBox[] = [];
  for (let s = b.south; s < b.north; s += step) {
    for (let w = b.west; w < b.east; w += step) {
      out.push({ west: w, south: s, east: Math.min(b.east, w + step), north: Math.min(b.north, s + step) });
    }
  }
  return out;
}

async function fetchTile(url: string, b: BBox): Promise<OverpassJson> {
  const key = `${b.west.toFixed(3)}_${b.south.toFixed(3)}_${b.east.toFixed(3)}_${b.north.toFixed(3)}.json`;
  const cached = path.join(CACHE_DIR, key);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, "utf8")) as OverpassJson;
  const body = `data=${encodeURIComponent(overpassQuery(b))}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MountainLive/0.1 (import OSM)" }, body });
      if (res.status === 429 || res.status === 504) throw new Error(`Overpass ${res.status}`);
      if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
      const json = (await res.json()) as OverpassJson;
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cached, JSON.stringify(json));
      return json;
    } catch (err) {
      lastError = err;
      const wait = 5000 * 2 ** attempt;
      console.warn(`[osm] ${String(err)} — nouvel essai dans ${wait / 1000} s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function loadFile(file: string): PathSegment[] {
  const raw = fs.readFileSync(file, "utf8");
  const json = JSON.parse(raw) as { type?: string; elements?: unknown[]; features?: unknown[] };
  if (json.type === "FeatureCollection") return segmentsFromGeoJson(json as Parameters<typeof segmentsFromGeoJson>[0]);
  if (Array.isArray(json.elements)) return segmentsFromOverpass(json as OverpassJson);
  throw new Error("Format non reconnu : attendu une réponse Overpass JSON (elements) ou un GeoJSON (FeatureCollection).");
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  await ensureDatabase();
  const before = countPaths();
  let total = 0;
  if (opts.file) {
    const segments = loadFile(opts.file);
    total += upsertPaths(segments);
    console.log(`[osm] ${segments.length} segments lus dans ${opts.file}.`);
  } else {
    const all = tiles(opts.bbox, opts.tile);
    console.log(`[osm] ${all.length} dalles à interroger sur ${opts.url} (cache : ${path.relative(process.cwd(), CACHE_DIR)}).`);
    for (const [i, b] of all.entries()) {
      const json = await fetchTile(opts.url, b);
      const segments = segmentsFromOverpass(json);
      total += upsertPaths(segments);
      console.log(`[osm] dalle ${i + 1}/${all.length} : ${segments.length} segments.`);
    }
  }
  console.log(`[osm] Terminé : ${total} segments importés ou mis à jour. La base compte ${countPaths()} segments (${before} avant).`);
}

main().catch((err) => {
  console.error(`[osm] Échec : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
