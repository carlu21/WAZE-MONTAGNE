import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { areaTypeForFeature, collectCommuneNames, extractFromZip, listZipEntries, parseGeoNamesLine, toImportedArea } from "../src/services/geonames";
import { areaTypeForCategories, geocodedId, mapGeocoderFeature } from "../src/services/geocoder";
import { mergeAreaResults, sortAreaResults } from "../src/services/areas";

/** Archive zip minimale mais conforme : en-têtes locaux (sans tailles, drapeau 3), répertoire central, EOCD. */
function buildZip(files: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const payload = f.deflate ? deflateRawSync(f.data) : f.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x08, 6); // descripteur de données : tailles absentes de l'en-tête local
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(payload.length, 8);
    descriptor.writeUInt32LE(f.data.length, 12);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(f.deflate ? 8 : 0, 10);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    const chunk = Buffer.concat([local, name, payload, descriptor]);
    parts.push(chunk);
    offset += chunk.length;
  }
  const cdStart = offset;
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

const line = (id: string, name: string, alt: string, lat: number, lng: number, cls: string, code: string, dep: string, elev = "", dem = "", admin4 = "") =>
  [id, name, name, alt, lat, lng, cls, code, "FR", "", "94", dep, "", admin4, "0", elev, dem, "Europe/Paris", "2025-01-01"].join("\t");

describe("import GeoNames", () => {
  it("analyse une ligne et fait correspondre les codes", () => {
    const rec = parseGeoNamesLine(line("1", "Bergeries de Grotelle", "Grotelle,Grottelle", 42.2288, 9.0578, "P", "PPLX", "2B", "", "1370"))!;
    expect(rec.name).toBe("Bergeries de Grotelle");
    expect(rec.admin2).toBe("2B");
    const area = toImportedArea(rec, { departements: ["2A", "2B"] })!;
    expect(area.id).toBe("gn_1");
    expect(area.type).toBe("hamlet");
    expect(area.elevation).toBe(1370);
    expect(area.nameNormalized).toContain("grottelle");
  });
  it("rattache chaque lieu à sa commune (codes INSEE des entrées ADM4)", () => {
    const records = [line("10", "Corte", "", 42.3061, 9.1497, "A", "ADM4", "2B", "", "", "2B096"), line("11", "Bergeries de Grotelle", "", 42.2288, 9.0578, "P", "PPLX", "2B", "", "1370", "2B096"), line("12", "Corte", "", 42.3061, 9.1497, "P", "PPL", "2B", "", "", "2B096")]
      .map(parseGeoNamesLine)
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const communes = collectCommuneNames(records);
    expect(communes.get("2B096")).toBe("Corte");
    const hamlet = toImportedArea(records[1], { departements: [] }, communes)!;
    expect(hamlet.commune).toBe("Corte");
    expect(hamlet.nameNormalized).toContain("corte");
    // La commune elle-même n'est pas rattachée à elle-même.
    expect(toImportedArea(records[2], { departements: [] }, communes)!.commune).toBeNull();
  });

  it("départage les homonymes par la distance à l'utilisateur", () => {
    const rows = [
      { name: "Pietra Rossa", nameNormalized: "pietra rossa", type: "hamlet" as const, lat: 41.9, lng: 8.8, commune: "Ajaccio" },
      { name: "Pietra Rossa", nameNormalized: "pietra rossa", type: "hamlet" as const, lat: 42.31, lng: 9.16, commune: "Corte" },
    ];
    expect(sortAreaResults([...rows], "pietra", { lat: 42.3, lng: 9.15 })[0].commune).toBe("Corte");
    expect(sortAreaResults([...rows], "pietra", { lat: 41.92, lng: 8.75 })[0].commune).toBe("Ajaccio");
  });

  it("filtre par département et ignore les entités administratives", () => {
    const rec = parseGeoNamesLine(line("2", "Ailleurs", "", 45, 5, "P", "PPL", "38"))!;
    expect(toImportedArea(rec, { departements: ["2A", "2B"] })).toBeNull();
    expect(toImportedArea(rec, { departements: [] })?.type).toBe("commune");
    expect(areaTypeForFeature("A", "ADM2")).toBeNull();
    expect(areaTypeForFeature("T", "PK")).toBe("summit");
    expect(areaTypeForFeature("T", "PASS")).toBe("pass");
    expect(areaTypeForFeature("H", "SPNG")).toBe("spring");
    expect(areaTypeForFeature("S", "HUT")).toBe("refuge");
    expect(areaTypeForFeature("H", "LK")).toBe("lake");
    expect(areaTypeForFeature("L", "LCTY")).toBe("hamlet");
  });
  it("extrait FR.txt d'une archive zip (deflate, tailles dans le répertoire central)", () => {
    const content = Buffer.from("42\tTest\tTest\t\t42.0\t9.0\tT\tPK\tFR\t\t94\t2B\t\t\t0\t1200\t1200\tEurope/Paris\t2025-01-01\n", "utf8");
    const zip = buildZip([{ name: "readme.txt", data: Buffer.from("GeoNames"), deflate: false }, { name: "FR.txt", data: content, deflate: true }]);
    expect(listZipEntries(zip).map((e) => e.name)).toEqual(["readme.txt", "FR.txt"]);
    expect(extractFromZip(zip, "FR.txt").toString("utf8")).toBe(content.toString("utf8"));
    expect(() => extractFromZip(zip, "absent.txt")).toThrow(/introuvable/);
  });
});

describe("géocodeur IGN", () => {
  it("convertit un lieu-dit de l'index poi et une commune de l'index address", () => {
    const poi = mapGeocoderFeature({ geometry: { type: "Point", coordinates: [9.0578, 42.2288] }, properties: { toponym: "Grotelle", category: ["lieu-dit habité"], city: ["Corte"], postcode: ["20250"] } })!;
    expect(poi.type).toBe("hamlet");
    expect(poi.name).toBe("Grotelle");
    expect(poi.commune).toBe("Corte");
    expect(poi.id).toBe(geocodedId("Grotelle", 42.2288, 9.0578));
    const commune = mapGeocoderFeature({ geometry: { type: "Point", coordinates: [9.1497, 42.3061] }, properties: { label: "Corte", name: "Corte", type: "municipality", city: "Corte", postcode: "20250" } })!;
    expect(commune.type).toBe("commune");
    expect(mapGeocoderFeature({ geometry: { type: "Point", coordinates: [9.1, 42.3] }, properties: { label: "3 Rue Test", type: "housenumber" } })).toBeNull();
    expect(areaTypeForCategories(["sommet"], null)).toBe("summit");
    expect(areaTypeForCategories(["col"], null)).toBe("pass");
    expect(areaTypeForCategories(["source"], null)).toBe("spring");
  });
  it("fusionne sans doublon les résultats en ligne avec les résultats locaux", () => {
    const local = [{ id: "a_corte", name: "Corte", nameNormalized: "corte", type: "commune" as const, lat: 42.3061, lng: 9.1497, bbox: null, elevation: 400, description: null, commune: null }];
    const online = [
      { id: "g_1", name: "Corte", nameNormalized: "corte", type: "commune" as const, lat: 42.3065, lng: 9.15, elevation: null, description: "IGN", commune: null },
      { id: "g_2", name: "Corte-Dessus", nameNormalized: "corte dessus", type: "hamlet" as const, lat: 42.5, lng: 9.2, elevation: null, description: "IGN", commune: "Corte" },
    ];
    const merged = mergeAreaResults(local, online, "cort");
    expect(merged.map((a) => a.id)).toEqual(["a_corte", "g_2"]);
  });
});
