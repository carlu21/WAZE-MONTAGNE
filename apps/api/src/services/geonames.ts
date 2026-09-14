/**
 * Import du référentiel toponymique GeoNames (licence CC BY 4.0, https://www.geonames.org) :
 * lieux-dits, hameaux, communes, sommets, cols, refuges, lacs, sources, sentiers…
 * Fonctions pures (analyse, correspondance des codes) testées unitairement ; l'import
 * en base est dans src/db/import-geonames.ts.
 */
import { inflateRawSync } from "node:zlib";
import type { AreaType } from "@mountain-live/core";
import { normalizeText } from "./util";

/** Colonnes du fichier FR.txt (séparateur tabulation). */
export interface GeoNamesRecord {
  geonameid: string;
  name: string;
  asciiname: string;
  alternatenames: string;
  lat: number;
  lng: number;
  featureClass: string;
  featureCode: string;
  admin1: string;
  admin2: string;
  /** Code de la commune (INSEE) dans le découpage GeoNames de la France. */
  admin4: string;
  elevation: number | null;
  dem: number | null;
}

export interface ImportedArea {
  id: string;
  name: string;
  nameNormalized: string;
  type: AreaType;
  lat: number;
  lng: number;
  elevation: number | null;
  description: string | null;
  commune: string | null;
}

/** Table code INSEE (admin4) → nom de commune, construite à partir des entrées ADM4 du fichier. */
export function collectCommuneNames(records: Iterable<GeoNamesRecord>): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of records) {
    if (r.featureClass === "A" && r.featureCode === "ADM4" && r.admin4 && r.name) map.set(r.admin4, r.name.trim());
  }
  return map;
}

/** Correspondance code GeoNames → type de lieu Mountain Live (null = ignoré). */
export function areaTypeForFeature(featureClass: string, featureCode: string): AreaType | null {
  const code = featureCode.toUpperCase();
  switch (featureClass.toUpperCase()) {
    case "P": // lieux peuplés
      if (/^PPL(A\d?|C|G|S)?$/.test(code)) return "commune"; // chef-lieu, ville, village
      if (["PPLX", "PPLL", "PPLQ", "PPLH", "PPLF", "PPLR", "PPLW", "STLMT"].includes(code)) return "hamlet";
      return null;
    case "T": // relief
      if (["PK", "PKS", "MT", "PROM", "HLL", "HLLS", "RDGE", "CRQ", "SPUR", "NTK", "NTKS", "CLF", "CLDA", "VLC"].includes(code)) return "summit";
      if (["MTS", "UPLD", "PLAT", "PLTN"].includes(code)) return "massif";
      if (["PASS", "GAP", "SDL"].includes(code)) return "pass";
      if (["VAL", "GRGE", "CNYN", "CAPE", "PT", "BCH", "ISL", "ISLS", "DUNE", "PEN", "SLP", "BUTE", "BLDR", "ROCK", "ROCKS", "HDLD", "LEV", "PLN", "TRR", "DPR", "FORD"].includes(code)) return "place";
      return null;
    case "H": // hydrographie
      if (["LK", "LKS", "LKN", "LKI", "LKO", "RSV", "PND", "PNDS", "LGN"].includes(code)) return "lake";
      if (["SPNG", "SPNT", "SPNS", "WLL", "FLLS", "FLLSX"].includes(code)) return "spring";
      return null;
    case "S": // installations
      if (["HUT", "HUTS", "SHEL", "RHSE", "HSTS", "MNMT"].includes(code)) return code === "MNMT" || code === "HSTS" ? "place" : "refuge";
      if (["RSTN", "CH", "CMTY", "CTRR", "TOWR", "BDG", "DAM", "MFGM", "MLWND", "RUIN", "CSTL", "FRM", "FRMS", "EST"].includes(code)) return "place";
      return null;
    case "L": // zones
      if (["LCTY", "AREA", "PRK", "RES", "RESN", "RESF", "RESW", "PRT", "CMN", "GRAZ", "FLD", "FLDI", "CST"].includes(code)) return "hamlet";
      return null;
    case "V": // végétation
      if (["FRST", "FRSTF", "GRVE", "HTH", "MDW", "SCRB", "WOOD"].includes(code)) return "place";
      return null;
    case "R": // routes et sentiers
      if (["TRL", "RD", "RDJCT"].includes(code)) return code === "TRL" ? "trail" : null;
      return null;
    default:
      return null;
  }
}

/** Analyse une ligne de FR.txt ; null si la ligne est vide ou mal formée. */
export function parseGeoNamesLine(line: string): GeoNamesRecord | null {
  if (!line || line.startsWith("#")) return null;
  const c = line.split("\t");
  if (c.length < 19) return null;
  const lat = Number(c[4]);
  const lng = Number(c[5]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const elevation = c[15] === "" ? null : Number(c[15]);
  const dem = c[16] === "" ? null : Number(c[16]);
  return {
    geonameid: c[0],
    name: c[1],
    asciiname: c[2],
    alternatenames: c[3],
    lat,
    lng,
    featureClass: c[6],
    featureCode: c[7],
    admin1: c[10],
    admin2: c[11],
    admin4: c[13],
    elevation: Number.isFinite(elevation as number) ? (elevation as number) : null,
    dem: Number.isFinite(dem as number) ? (dem as number) : null,
  };
}

export interface ImportFilter {
  /** Codes de département (admin2 GeoNames, ex. « 2A », « 2B ») ; vide = toute la France. */
  departements: readonly string[];
}

const TYPE_LABEL: Record<AreaType, string> = {
  commune: "Commune",
  massif: "Massif",
  trail: "Sentier",
  summit: "Sommet",
  pass: "Col",
  place: "Lieu",
  refuge: "Refuge",
  lake: "Lac",
  hamlet: "Lieu-dit",
  spring: "Source",
};

/** Transforme un enregistrement GeoNames en lieu importable ; null s'il est hors filtre ou sans type. */
export function toImportedArea(r: GeoNamesRecord, filter: ImportFilter, communeNames: ReadonlyMap<string, string> = new Map()): ImportedArea | null {
  if (filter.departements.length > 0 && !filter.departements.includes(r.admin2)) return null;
  const type = areaTypeForFeature(r.featureClass, r.featureCode);
  if (!type) return null;
  const name = r.name.trim();
  if (!name) return null;
  // Les noms alternatifs (corse, ancien nom…) participent à la recherche mais pas à l'affichage.
  const alternates = r.alternatenames
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^https?:/.test(s) && s.length <= 60)
    .slice(0, 8);
  const communeName = communeNames.get(r.admin4) ?? null;
  // La commune elle-même n'a pas de « commune de rattachement » ; les autres lieux y sont associés,
  // et son nom participe à la recherche (« Grotelle Corte »).
  const commune = communeName && normalizeText(communeName) !== normalizeText(name) ? communeName : null;
  const nameNormalized = normalizeText([name, ...alternates, commune ?? ""].join(" ")).slice(0, 300);
  const elevation = r.elevation && r.elevation > 0 ? Math.round(r.elevation) : r.dem && r.dem > 0 && ["summit", "pass", "refuge", "lake", "spring", "hamlet"].includes(type) ? Math.round(r.dem) : null;
  return {
    id: `gn_${r.geonameid}`,
    name,
    nameNormalized,
    type,
    lat: r.lat,
    lng: r.lng,
    elevation,
    description: `${TYPE_LABEL[type]}${commune ? ` · ${commune}` : ""}${r.admin2 ? ` (${r.admin2})` : ""} · Source : GeoNames`,
    commune,
  };
}

/**
 * Extrait un fichier d'une archive zip simple (entrées « stored » ou « deflate »), sans dépendance.
 * Suffisant pour les exports GeoNames (FR.zip contient FR.txt et readme.txt).
 */
export function extractFromZip(zip: Buffer, fileName: string): Buffer {
  let offset = 0;
  while (offset + 30 <= zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature !== 0x04034b50) break; // fin des entrées locales
    const method = zip.readUInt16LE(offset + 8);
    const flags = zip.readUInt16LE(offset + 6);
    let compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    if ((flags & 0x08) !== 0 || compressedSize === 0xffffffff) {
      // Taille inconnue dans l'en-tête local : on la lit dans le répertoire central.
      compressedSize = sizeFromCentralDirectory(zip, name) ?? compressedSize;
    }
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    if (name === fileName || name.endsWith(`/${fileName}`)) {
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`Méthode de compression zip non prise en charge : ${method}`);
    }
    offset = dataStart + compressedSize;
  }
  throw new Error(`Fichier ${fileName} introuvable dans l'archive`);
}

function sizeFromCentralDirectory(zip: Buffer, fileName: string): number | null {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  let p = zip.readUInt32LE(eocd + 16);
  while (p + 46 <= zip.length && zip.readUInt32LE(p) === 0x02014b50) {
    const compressedSize = zip.readUInt32LE(p + 20);
    const n = zip.readUInt16LE(p + 28);
    const e = zip.readUInt16LE(p + 30);
    const k = zip.readUInt16LE(p + 32);
    const name = zip.subarray(p + 46, p + 46 + n).toString("utf8");
    if (name === fileName) return compressedSize;
    p += 46 + n + e + k;
  }
  return null;
}
