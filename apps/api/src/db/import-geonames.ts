/**
 * Import du référentiel toponymique GeoNames dans la table `areas` (lieux-dits, hameaux,
 * communes, sommets, cols, refuges, lacs, sources, sentiers…).
 *
 *   pnpm --filter @mountain-live/api geo:import                      # Corse (2A, 2B) par défaut
 *   pnpm --filter @mountain-live/api geo:import -- --departements 04,05,06
 *   pnpm --filter @mountain-live/api geo:import -- --all             # toute la France (~10 min, ~400 000 lieux)
 *   pnpm --filter @mountain-live/api geo:import -- --file ./FR.txt   # fichier déjà téléchargé (FR.txt ou FR.zip)
 *
 * Source : https://download.geonames.org/export/dump/FR.zip — licence CC BY 4.0 (https://www.geonames.org).
 * L'import est idempotent (identifiants gn_<geonameid>) et n'écrase pas les lieux du jeu de démonstration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "./client";
import { ensureDatabase } from "./migrate";
import { areas } from "./schema";
import { collectCommuneNames, extractFromZip, parseGeoNamesLine, toImportedArea, type GeoNamesRecord, type ImportedArea } from "../services/geonames";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, "..", "..", "data", "geonames");
const DEFAULT_URL = "https://download.geonames.org/export/dump/FR.zip";

interface Options {
  departements: string[];
  file: string | null;
  url: string;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { departements: ["2A", "2B"], file: null, url: DEFAULT_URL };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = (): string => {
      const eq = a.indexOf("=");
      if (eq >= 0) return a.slice(eq + 1);
      i += 1;
      return argv[i] ?? "";
    };
    if (a === "--all") opts.departements = [];
    else if (a.startsWith("--departements")) opts.departements = value().split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a.startsWith("--file")) opts.file = value();
    else if (a.startsWith("--url")) opts.url = value();
    else if (a === "--help" || a === "-h") {
      console.log("Options : --departements 2A,2B | --all | --file <FR.txt|FR.zip> | --url <url>");
      process.exit(0);
    }
  }
  return opts;
}

async function download(url: string, target: string): Promise<void> {
  console.log(`[geo] Téléchargement de ${url} …`);
  const res = await fetch(url, { headers: { "User-Agent": "MountainLive/0.1 (import GeoNames)" } });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status} ${res.statusText}). Téléchargez FR.zip manuellement puis relancez avec --file <chemin>.`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  console.log(`[geo] ${(buf.length / 1024 / 1024).toFixed(1)} Mo enregistrés dans ${target}`);
}

function readText(file: string): string {
  const raw = fs.readFileSync(file);
  if (file.toLowerCase().endsWith(".zip")) return extractFromZip(raw, "FR.txt").toString("utf8");
  return raw.toString("utf8");
}

export async function importGeoNames(opts: Options): Promise<Record<string, number>> {
  await ensureDatabase();
  let file = opts.file;
  if (!file) {
    file = path.join(DATA_DIR, "FR.zip");
    if (!fs.existsSync(file)) await download(opts.url, file);
    else console.log(`[geo] Archive déjà présente : ${file} (supprimez-la pour la retélécharger)`);
  }
  console.log(`[geo] Lecture de ${file} …`);
  const text = readText(file);
  const lines = text.split("\n");
  const filter = { departements: opts.departements };
  // Première passe : noms des communes (entrées ADM4) pour rattacher chaque lieu à sa commune.
  const records: GeoNamesRecord[] = [];
  for (const line of lines) {
    const rec = parseGeoNamesLine(line);
    if (rec) records.push(rec);
  }
  const communeNames = collectCommuneNames(records);
  console.log(`[geo] ${records.length} entrées lues, ${communeNames.size} communes identifiées.`);
  const batch: ImportedArea[] = [];
  const counts: Record<string, number> = {};
  for (const rec of records) {
    const area = toImportedArea(rec, filter, communeNames);
    if (!area) continue;
    batch.push(area);
    counts[area.type] = (counts[area.type] ?? 0) + 1;
  }
  console.log(`[geo] ${batch.length} lieux retenus (${opts.departements.length ? `départements ${opts.departements.join(", ")}` : "toute la France"}) ; écriture en base…`);
  const BATCH = 2000;
  for (let i = 0; i < batch.length; i += BATCH) {
    const slice = batch.slice(i, i + BATCH);
    db.transaction((tx) => {
      for (const a of slice) {
        tx.insert(areas)
          .values({ id: a.id, name: a.name, nameNormalized: a.nameNormalized, type: a.type, lat: a.lat, lng: a.lng, bbox: null, elevation: a.elevation, description: a.description, commune: a.commune })
          .onConflictDoUpdate({ target: areas.id, set: { name: a.name, nameNormalized: a.nameNormalized, type: a.type, lat: a.lat, lng: a.lng, elevation: a.elevation, description: a.description, commune: a.commune } })
          .run();
      }
    });
  }
  const total = (db.select({ n: sql<number>`count(*)` }).from(areas).get() as { n: number } | undefined)?.n ?? 0;
  console.log(`[geo] Terminé : ${batch.length} lieux importés ou mis à jour. La base compte ${total} lieux.`);
  for (const [type, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  - ${type.padEnd(8)} ${n}`);
  return counts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  importGeoNames(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error(`[geo] Échec : ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
