/**
 * Import du réseau de chemins OpenStreetMap dans la table `paths` (module navigation).
 *
 *   pnpm --filter @mountain-live/api geo:import-osm                          # Corse par défaut (Overpass)
 *   pnpm --filter @mountain-live/api geo:import-osm -- --bbox 8.9,42.1,9.2,42.4
 *   pnpm --filter @mountain-live/api geo:import-osm -- --file ./sentiers.json     # réponse Overpass JSON
 *   pnpm --filter @mountain-live/api geo:import-osm -- --file ./sentiers.geojson  # export GeoJSON (Overpass Turbo, QGIS…)
 *   pnpm --filter @mountain-live/api geo:import-osm -- --url https://overpass.kumi.systems/api/interpreter
 *   pnpm --filter @mountain-live/api geo:import-osm -- --preset bastelica     # petite zone de test
 *   pnpm --filter @mountain-live/api geo:import-osm -- --relink-only          # ré-associe sans rien retélécharger
 *
 *   pnpm --filter @mountain-live/api geo:import-osm -- --routes-only   # itinéraires balisés seulement (GR, PR, VTT…)
 *   pnpm --filter @mountain-live/api geo:import-osm -- --paths-only    # réseau de chemins seulement
 *
 * Deux phases : le réseau de chemins (ways `highway=path|track|…`, par dalles de 0,25°) puis les
 * itinéraires balisés (relations `route=hiking|foot|mtb|horse|running`, par dalles de 0,5°) dont la
 * géométrie est assemblée et enregistrée dans `trails` (GR 20, Mare a Mare, boucles locales…).
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
import { overpassQuery, overpassRoutesQuery, routesFromOverpass, segmentsFromGeoJson, segmentsFromOverpass, type OverpassJson } from "../services/osm";
import { countPaths, upsertPaths } from "../services/paths";
import { networkStats, upsertTrails } from "../services/reference";
import { linkImportedTrail, listTrailsForRelink, relinkTrailByGeometry } from "../services/trail-segments";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(here, "..", "..", "data", "osm");
/**
 * Instances Overpass, essayées DANS CET ORDRE et une seule à la fois. Ce sont
 * des services bénévoles : on ne les interroge jamais en parallèle, et on ne
 * passe à la suivante qu'après épuisement des tentatives sur la précédente.
 * `--url` remplace toute la liste.
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
] as const;
/** Corse (territoire pilote). */
const CORSICA: BBox = { west: 8.5, south: 41.3, east: 9.6, north: 43.1 };
const TILE_DEG = 0.25;

/**
 * Petites emprises de travail : importer toute la Corse pour vérifier une
 * correction prend une demi-heure, ces zones prennent une minute.
 */
const PRESETS: Record<string, BBox> = {
  bastelica: { west: 9.02, south: 41.93, east: 9.18, north: 42.06 },
  corte: { west: 9.05, south: 42.26, east: 9.22, north: 42.36 },
  restonica: { west: 8.98, south: 42.18, east: 9.12, north: 42.26 },
  bavella: { west: 9.18, south: 41.75, east: 9.30, north: 41.84 },
  vizzavona: { west: 9.08, south: 42.08, east: 9.20, north: 42.18 },
  "porto-vecchio": { west: 9.20, south: 41.53, east: 9.40, north: 41.68 },
};

interface Options {
  bbox: BBox;
  file: string | null;
  /** Liste d'instances à essayer dans l'ordre. */
  urls: string[];
  tile: number;
  paths: boolean;
  routes: boolean;
  /** Ne rien télécharger : ré-associer les itinéraires déjà en base au réseau. */
  relinkOnly: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { bbox: CORSICA, file: null, urls: [...OVERPASS_ENDPOINTS], tile: TILE_DEG, paths: true, routes: true, relinkOnly: false };
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
    } else if (a.startsWith("--preset")) {
      const name = value().trim().toLowerCase();
      const box = PRESETS[name];
      if (!box) throw new Error(`--preset inconnu : ${name}. Disponibles : ${Object.keys(PRESETS).join(", ")}`);
      opts.bbox = box;
    } else if (a.startsWith("--file")) opts.file = value();
    else if (a.startsWith("--url")) opts.urls = [value()];
    else if (a.startsWith("--tile")) opts.tile = Number(value()) || TILE_DEG;
    else if (a === "--routes-only") opts.paths = false;
    else if (a === "--paths-only") opts.routes = false;
    else if (a === "--relink-only") opts.relinkOnly = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Options :
  --bbox ouest,sud,est,nord    emprise explicite
  --preset <nom>               ${Object.keys(PRESETS).join(" | ")}
  --file <overpass.json|.geojson>
  --url <overpass>             remplace la liste d'instances
  --tile 0.25                  taille des dalles (degrés)
  --paths-only | --routes-only
  --relink-only                ré-associe les itinéraires au réseau, sans téléchargement`);
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

function tileCachePath(b: BBox, kind: "paths" | "routes"): string {
  const key = `${kind === "routes" ? "routes_" : ""}${b.west.toFixed(3)}_${b.south.toFixed(3)}_${b.east.toFixed(3)}_${b.north.toFixed(3)}.json`;
  return path.join(CACHE_DIR, key);
}

/**
 * Une dalle. Le cache disque est consulté d'abord : une dalle déjà téléchargée
 * n'est JAMAIS redemandée, ce qui rend l'import reprenable après une erreur —
 * relancer la commande repart de là où elle s'était arrêtée.
 *
 * Chaque instance Overpass a droit à trois tentatives espacées (5 s, 10 s,
 * 20 s) avant qu'on passe à la suivante. Jamais deux instances en parallèle :
 * ce sont des services bénévoles.
 */
async function fetchTile(urls: readonly string[], b: BBox, kind: "paths" | "routes" = "paths"): Promise<{ json: OverpassJson; cached: boolean }> {
  const cachedPath = tileCachePath(b, kind);
  if (fs.existsSync(cachedPath)) return { json: JSON.parse(fs.readFileSync(cachedPath, "utf8")) as OverpassJson, cached: true };
  const body = `data=${encodeURIComponent(kind === "routes" ? overpassRoutesQuery(b) : overpassQuery(b))}`;
  let lastError: unknown = null;
  for (const url of urls) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "MountainLive/0.1 (import OSM)" }, body });
        if (res.status === 429 || res.status === 504) throw new Error(`Overpass ${res.status} (surcharge)`);
        if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
        const json = (await res.json()) as OverpassJson;
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cachedPath, JSON.stringify(json));
        return { json, cached: false };
      } catch (err) {
        lastError = err;
        const wait = 5000 * 2 ** attempt;
        console.warn(`[osm] ${new URL(url).host} : ${String(err)} — nouvel essai dans ${wait / 1000} s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    console.warn(`[osm] ${new URL(url).host} injoignable — instance suivante.`);
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

  if (opts.relinkOnly) {
    const n = relinkAll();
    report(n);
    return;
  }

  if (opts.file) {
    const segments = loadFile(opts.file);
    total += upsertPaths(segments);
    console.log(`[osm] ${segments.length} segments lus dans ${opts.file}.`);
  } else {
    /*
     * L'ORDRE COMPTE. Les chemins d'abord, les itinéraires ensuite : une
     * relation ne peut être associée qu'à des segments déjà présents en base.
     * Inverser les deux phases produirait des randonnées orphelines.
     */
    if (opts.paths) {
      const all = tiles(opts.bbox, opts.tile);
      console.log(`[osm] Réseau de chemins : ${all.length} dalle${all.length > 1 ? "s" : ""} (cache : ${path.relative(process.cwd(), CACHE_DIR)}).`);
      for (const [i, b] of all.entries()) {
        const { json, cached } = await fetchTile(opts.urls, b, "paths");
        const segments = segmentsFromOverpass(json);
        total += upsertPaths(segments);
        console.log(`[osm] dalle ${i + 1}/${all.length} : ${segments.length} segments${cached ? " (cache)" : ""}.`);
      }
    }

    if (opts.routes) {
      const all = tiles(opts.bbox, Math.max(opts.tile, 0.5));
      console.log(`[osm] Itinéraires balisés : ${all.length} dalle${all.length > 1 ? "s" : ""}.`);
      const seen = new Set<string>();
      let routes = 0;
      let linkedSegments = 0;
      let coverageSum = 0;
      let partial = 0;
      for (const [i, b] of all.entries()) {
        const { json, cached } = await fetchTile(opts.urls, b, "routes");
        const found = routesFromOverpass(json).filter((t) => !seen.has(t.id));
        for (const t of found) seen.add(t.id);
        routes += upsertTrails(found.map((t) => ({ ...t, gapCount: t.gaps })));

        /*
         * ÉTAPE DÉCISIVE : relier chaque relation aux segments réels du réseau.
         * C'est ce qui transforme « une géométrie stockée » en « un parcours
         * dont on connaît les chemins ». Sans elle, l'application saurait qu'un
         * GR existe sans savoir par où il passe.
         */
        for (const t of found) {
          const link = linkImportedTrail({
            trailId: t.id,
            geometry: t.geometry.coordinates,
            memberWayIds: t.memberWayIds,
            source: t.source,
            gaps: t.gaps,
          });
          linkedSegments += link.linkedSegments;
          coverageSum += link.coverage;
          if (link.coverage < 1) {
            partial++;
            console.log(`[osm]   ${t.name} : ${link.resolvedWays}/${link.expectedWays} membres résolus (${Math.round(link.coverage * 100)} %), ${link.linkedSegments} segments.`);
          }
        }
        console.log(`[osm] dalle ${i + 1}/${all.length} : ${found.length} itinéraires${cached ? " (cache)" : ""}.`);
      }
      const meanCoverage = routes > 0 ? coverageSum / routes : 0;
      console.log(`[osm] ${routes} itinéraires importés, ${linkedSegments} associations randonnée ↔ segment.`);
      console.log(`[osm] Couverture moyenne des membres : ${Math.round(meanCoverage * 100)} %${partial > 0 ? ` — ${partial} itinéraire${partial > 1 ? "s" : ""} partiellement résolu${partial > 1 ? "s" : ""} (élargissez l'emprise pour les compléter).` : "."}`);
    }
  }
  report(total, before);
}

/**
 * Ré-associe TOUS les itinéraires déjà en base au réseau, sans rien
 * retélécharger. Utile après un import de chemins supplémentaire : les
 * randonnées qui n'avaient pas retrouvé leurs segments peuvent enfin le faire.
 *
 * Les membres d'origine ne sont pas conservés pour les itinéraires importés
 * avant cette version : on les redéduit alors de la géométrie enregistrée, en
 * passant par les segments que cette géométrie longe.
 */
function relinkAll(): number {
  const rows = listTrailsForRelink();
  let linked = 0;
  let touched = 0;
  for (const row of rows) {
    const result = relinkTrailByGeometry(row);
    if (result.linkedSegments === 0) continue;
    touched++;
    linked += result.linkedSegments;
    console.log(`[osm] ${row.name} : ${result.linkedSegments} segments associés (${Math.round(result.coverage * 100)} % du tracé).`);
  }
  console.log(`[osm] Ré-association terminée : ${touched}/${rows.length} itinéraires reliés, ${linked} associations.`);
  return linked;
}

function report(total: number, before?: number): void {
  const stats = networkStats();
  const after = countPaths();
  console.log(
    `[osm] Terminé : ${total} éléments traités. Base : ${after} segments${before === undefined ? "" : ` (${before} avant)`}, ` +
      `dont ${stats.paths.osm} OpenStreetMap et ${stats.paths.seed} de démonstration ; ` +
      `${stats.trails.total} itinéraires dont ${stats.trails.osm} OpenStreetMap ; ` +
      `${stats.links.trailSegments} associations. Réseau réel disponible : ${stats.realDataReady ? "oui" : "non"}.`,
  );
  console.log("[osm] Données © les contributeurs OpenStreetMap, licence ODbL.");
}

main().catch((err) => {
  console.error(`[osm] Échec : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
