/**
 * Tests de l'ingestion des fichiers de trace (sections 7, 8, 17 et 18).
 *
 * Toutes les données sont manifestement fictives : « example.org », « Sentier
 * de démonstration », « Commune fictive ». Aucun fichier n'est attribué à une
 * plateforme réelle, aucune licence n'est présentée comme vérifiée — seules
 * les formes de fichier (GPX 1.0/1.1, KML, GeoJSON) sont authentiques,
 * puisque c'est précisément ce que le module doit savoir lire.
 */
import { describe, expect, it } from "vitest";
import { haversineM } from "../geo";
import type { ParsedTrace, TracePoint } from "./types";
import {
  INGEST_CLEANING_FLAGS,
  INGEST_DEFAULT_ROUTE_USAGE,
  INGEST_DUPLICATE_TOLERANCE_M,
  INGEST_ELEVATION_HYSTERESIS_M,
  INGEST_EXTENSION_FORMATS,
  INGEST_FORMATS,
  INGEST_HASH_PRECISION,
  INGEST_HASH_PREFIX,
  INGEST_HASH_SAMPLE_M,
  INGEST_MAX_GEOJSON_DEPTH,
  INGEST_MIN_POINTS,
  INGEST_NULL_ISLAND_TOLERANCE_DEG,
  INGEST_SPIKE_MAX_SPEED_M_S,
  INGEST_SPIKE_MIN_EXCURSION_M,
  INGEST_SPIKE_RATIO,
  INGEST_TIME_DISORDER_TOLERANCE_MS,
  detectTraceFormat,
  normalizeTrace,
  parseGeoJsonDocument,
  parseGpxDocument,
  parseKmlDocument,
  parseTraceFile,
  traceHash,
} from "./ingest";

/* ------------------------------------------------------------------ */
/* Fabriques locales (tout est inventé)                                */
/* ------------------------------------------------------------------ */

/** 1er juin 2024, 8 h UTC : instant de référence des traces de démonstration. */
const T0 = Date.UTC(2024, 5, 1, 8, 0, 0);

/** Date ISO située `seconds` secondes après `T0`. */
const isoAt = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString();

/** Point de trace, tout facultatif restant `null` tant qu'on ne le donne pas. */
function pt(lat: number, lng: number, ele: number | null = null, at: number | null = null): TracePoint {
  return { lat, lng, ele, at };
}

/** Trace analysée fabriquée de toutes pièces, sans passer par un fichier. */
function parsedFrom(
  segments: readonly TracePoint[][],
  extra: { routes?: readonly TracePoint[][] } = {},
): ParsedTrace {
  return {
    format: "gpx",
    metadata: {
      name: "Sentier de démonstration",
      description: null,
      author: null,
      copyright: null,
      link: null,
      creator: null,
      time: null,
      keywords: [],
    },
    tracks:
      segments.length === 0
        ? []
        : [{ name: "Trace de démonstration", description: null, segments: segments.map((points) => ({ points })) }],
    routes: (extra.routes ?? []).map((points, index) => ({ name: `Itinéraire ${index + 1}`, points })),
    waypoints: [],
  };
}

/** Balise `<trkpt>` fictive. */
function trkpt(lat: number, lng: number, ele: number | null = null, seconds: number | null = null): string {
  const parts = [
    ele === null ? "" : `<ele>${ele}</ele>`,
    seconds === null ? "" : `<time>${isoAt(seconds)}</time>`,
  ].join("");
  return `<trkpt lat="${lat}" lon="${lng}">${parts}</trkpt>`;
}

/** GPX 1.1 minimal : une trace, un segment, les points donnés. */
function gpxWith(points: string, metadata = "<metadata><name>Sentier de démonstration</name></metadata>"): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Export de démonstration" xmlns="http://www.topografix.com/GPX/1/1">',
    metadata,
    "<trk><name>Trace de démonstration</name><trkseg>",
    points,
    "</trkseg></trk>",
    "</gpx>",
  ].join("\n");
}

/** Ligne droite est-ouest de `count` points, espacés de `stepDeg` en longitude. */
function straightLine(count: number, stepDeg: number, lat = 42, lng0 = 9): TracePoint[] {
  const out: TracePoint[] = [];
  for (let i = 0; i < count; i++) out.push(pt(lat, lng0 + i * stepDeg));
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. GPX                                                              */
/* ------------------------------------------------------------------ */

describe("parseGpxDocument", () => {
  it("lit un GPX minimal : nom, points, altitude et horodatage", () => {
    const parsed = parseGpxDocument(gpxWith([trkpt(42, 9, 1000, 0), trkpt(42.001, 9, 1010, 60)].join("")));
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    expect(parsed.format).toBe("gpx");
    expect(parsed.metadata.name).toBe("Sentier de démonstration");
    expect(parsed.metadata.creator).toBe("Export de démonstration");
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0].name).toBe("Trace de démonstration");
    expect(parsed.tracks[0].segments[0].points).toEqual([
      { lat: 42, lng: 9, ele: 1000, at: T0 },
      { lat: 42.001, lng: 9, ele: 1010, at: T0 + 60_000 },
    ]);
  });

  it("conserve séparément plusieurs traces et plusieurs segments", () => {
    const xml = [
      '<gpx version="1.1">',
      "<trk><name>Première</name>",
      `<trkseg>${trkpt(42, 9)}${trkpt(42.001, 9)}</trkseg>`,
      `<trkseg>${trkpt(42.1, 9.1)}${trkpt(42.101, 9.1)}</trkseg>`,
      "</trk>",
      `<trk><name>Seconde</name><trkseg>${trkpt(42.2, 9.2)}</trkseg></trk>`,
      "</gpx>",
    ].join("");
    const parsed = parseGpxDocument(xml);
    expect(parsed?.tracks).toHaveLength(2);
    expect(parsed?.tracks[0].segments).toHaveLength(2);
    expect(parsed?.tracks[0].segments[1].points[0].lat).toBe(42.1);
    expect(parsed?.tracks[1].name).toBe("Seconde");
  });

  it("lit les métadonnées, dont le copyright — indice de licence", () => {
    const metadata = [
      "<metadata>",
      "<name>Trace avec droits</name>",
      "<desc>Fichier de démonstration</desc>",
      "<author><name>Auteur de démonstration</name></author>",
      '<copyright author="Commune fictive"><year>2023</year><license>https://example.org/licence</license></copyright>',
      '<link href="https://example.org/fiche"><text>Fiche</text></link>',
      `<time>${isoAt(0)}</time>`,
      "<keywords>randonnée, démonstration, randonnée</keywords>",
      "</metadata>",
    ].join("");
    const parsed = parseGpxDocument(gpxWith(trkpt(42, 9) + trkpt(42.001, 9), metadata));
    expect(parsed?.metadata.name).toBe("Trace avec droits");
    expect(parsed?.metadata.description).toBe("Fichier de démonstration");
    expect(parsed?.metadata.author).toBe("Auteur de démonstration");
    expect(parsed?.metadata.copyright).toBe("Commune fictive, 2023, https://example.org/licence");
    expect(parsed?.metadata.link).toBe("https://example.org/fiche");
    expect(parsed?.metadata.time).toBe(T0);
    expect(parsed?.metadata.keywords).toEqual(["randonnée", "démonstration"]);
  });

  it("distingue un itinéraire (rte) d'un relevé (trk)", () => {
    const xml = [
      '<gpx version="1.1">',
      "<rte><name>Itinéraire projeté</name>",
      '<rtept lat="42" lon="9"></rtept><rtept lat="42.01" lon="9.01"></rtept>',
      "</rte></gpx>",
    ].join("");
    const parsed = parseGpxDocument(xml);
    expect(parsed?.tracks).toHaveLength(0);
    expect(parsed?.routes).toHaveLength(1);
    expect(parsed?.routes[0].name).toBe("Itinéraire projeté");
    expect(parsed?.routes[0].points).toHaveLength(2);
  });

  it("lit les waypoints avec leur nom et leur description", () => {
    const xml = [
      '<gpx version="1.1">',
      '<wpt lat="42.05" lon="9.05"><ele>1200</ele><name>Refuge fictif</name><desc>Point d\'eau</desc></wpt>',
      `<trk><trkseg>${trkpt(42, 9)}${trkpt(42.001, 9)}</trkseg></trk>`,
      "</gpx>",
    ].join("");
    const parsed = parseGpxDocument(xml);
    expect(parsed?.waypoints).toEqual([
      { lat: 42.05, lng: 9.05, ele: 1200, name: "Refuge fictif", description: "Point d'eau" },
    ]);
  });

  it("tolère les espaces de noms préfixés", () => {
    const xml = [
      '<gpx:gpx xmlns:gpx="http://www.topografix.com/GPX/1/1" creator="Outil fictif">',
      "<gpx:metadata><gpx:name>Trace préfixée</gpx:name></gpx:metadata>",
      "<gpx:trk><gpx:trkseg>",
      '<gpx:trkpt lat="42" lon="9"><gpx:ele>800</gpx:ele></gpx:trkpt>',
      '<gpx:trkpt lat="42.001" lon="9"><gpx:ele>820</gpx:ele></gpx:trkpt>',
      "</gpx:trkseg></gpx:trk></gpx:gpx>",
    ].join("");
    const parsed = parseGpxDocument(xml);
    expect(parsed?.metadata.name).toBe("Trace préfixée");
    expect(parsed?.metadata.creator).toBe("Outil fictif");
    expect(parsed?.tracks[0].segments[0].points).toHaveLength(2);
    expect(parsed?.tracks[0].segments[0].points[0].ele).toBe(800);
  });

  it("tolère les attributs en désordre, les guillemets simples et les CDATA", () => {
    const xml = [
      "<gpx version='1.1'>",
      "<metadata><name><![CDATA[Sentier <b>démo</b>]]></name></metadata>",
      "<trk><trkseg>",
      "<trkpt lon='9.000' lat='42.000'/>",
      '<trkpt lon="9.001" lat="42.000"/>',
      "</trkseg></trk></gpx>",
    ].join("");
    const parsed = parseGpxDocument(xml);
    expect(parsed?.metadata.name).toBe("Sentier démo");
    expect(parsed?.tracks[0].segments[0].points).toEqual([
      { lat: 42, lng: 9, ele: null, at: null },
      { lat: 42, lng: 9.001, ele: null, at: null },
    ]);
  });

  it("ignore les extensions inconnues, y compris leurs ele et time", () => {
    const point =
      '<trkpt lat="42" lon="9">' +
      "<extensions><ele>9999</ele><time>1999-01-01T00:00:00Z</time><hr>140</hr></extensions>" +
      `<ele>1000</ele><time>${isoAt(0)}</time></trkpt>`;
    const parsed = parseGpxDocument(gpxWith(point + trkpt(42.001, 9, 1010, 60)));
    expect(parsed?.tracks[0].segments[0].points[0]).toEqual({ lat: 42, lng: 9, ele: 1000, at: T0 });
  });

  it("rend null, ele et at quand le fichier ne porte ni altitude ni horodatage", () => {
    const parsed = parseGpxDocument(gpxWith(trkpt(42, 9) + trkpt(42.001, 9)));
    const points = parsed?.tracks[0].segments[0].points ?? [];
    expect(points.every((p) => p.ele === null && p.at === null)).toBe(true);
  });

  it("lit un GPX 1.0, dont les métadonnées sont posées à la racine", () => {
    const xml = [
      '<gpx version="1.0" creator="Outil fictif 1.0">',
      "<name>Trace 1.0</name>",
      "<desc>Ancien format</desc>",
      "<author>Association de démonstration</author>",
      "<url>https://example.org/trace</url>",
      `<time>${isoAt(0)}</time>`,
      `<trk><name>Relevé</name><trkseg>${trkpt(42, 9)}${trkpt(42.001, 9)}</trkseg></trk>`,
      "</gpx>",
    ].join("");
    const parsed = parseGpxDocument(xml);
    expect(parsed?.metadata.name).toBe("Trace 1.0");
    expect(parsed?.metadata.description).toBe("Ancien format");
    expect(parsed?.metadata.author).toBe("Association de démonstration");
    expect(parsed?.metadata.link).toBe("https://example.org/trace");
    expect(parsed?.tracks[0].name).toBe("Relevé");
  });

  it("récupère les points d'un document tronqué dont les balises sont complètes", () => {
    const xml = '<gpx version="1.1"><trk><trkseg><trkpt lat="42" lon="9"/><trkpt lat="42.001" lon="9"/>';
    const parsed = parseGpxDocument(xml);
    expect(parsed?.tracks[0].segments[0].points).toHaveLength(2);
  });

  it("renvoie null sur un XML tronqué en plein point, sans rien inventer", () => {
    expect(parseGpxDocument('<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="42" lon="9"><ele>10')).toBeNull();
  });

  it("renvoie null sur un contenu vide, non GPX, ou sans géométrie", () => {
    expect(parseGpxDocument("")).toBeNull();
    expect(parseGpxDocument("bonjour")).toBeNull();
    expect(parseGpxDocument('<kml><Document></Document></kml>')).toBeNull();
    expect(parseGpxDocument('<gpx version="1.1"><metadata><name>Vide</name></metadata></gpx>')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 2. KML                                                              */
/* ------------------------------------------------------------------ */

describe("parseKmlDocument", () => {
  it("lit un LineString en respectant l'ordre lng,lat du KML", () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
      "<name>Parcours de démonstration</name><description>Fichier fictif</description>",
      "<Placemark><name>Montée fictive</name><description>Deux points</description>",
      "<LineString><coordinates>9.0,42.0,1000 9.001,42.0,1010</coordinates></LineString>",
      "</Placemark></Document></kml>",
    ].join("");
    const parsed = parseKmlDocument(xml);
    expect(parsed?.format).toBe("kml");
    expect(parsed?.metadata.name).toBe("Parcours de démonstration");
    expect(parsed?.metadata.description).toBe("Fichier fictif");
    expect(parsed?.tracks[0].name).toBe("Montée fictive");
    // Le piège classique : 9 est la longitude, 42 la latitude.
    expect(parsed?.tracks[0].segments[0].points[0]).toEqual({ lat: 42, lng: 9, ele: 1000, at: null });
  });

  it("fait un segment par LineString d'un MultiGeometry", () => {
    const xml = [
      "<kml><Document><Placemark><name>Deux tronçons</name><MultiGeometry>",
      "<LineString><coordinates>9.0,42.0 9.001,42.0</coordinates></LineString>",
      "<LineString><coordinates>9.01,42.01 9.011,42.01</coordinates></LineString>",
      "</MultiGeometry></Placemark></Document></kml>",
    ].join("");
    const parsed = parseKmlDocument(xml);
    expect(parsed?.tracks).toHaveLength(1);
    expect(parsed?.tracks[0].segments).toHaveLength(2);
    expect(parsed?.tracks[0].segments[1].points[0].lat).toBe(42.01);
  });

  it("transforme un Point en waypoint portant le nom du Placemark", () => {
    const xml = [
      "<kml><Document>",
      "<Placemark><name>Refuge fictif</name><description>Point d'eau</description>",
      "<Point><coordinates>9.05,42.05,1200</coordinates></Point></Placemark>",
      "<Placemark><LineString><coordinates>9.0,42.0 9.001,42.0</coordinates></LineString></Placemark>",
      "</Document></kml>",
    ].join("");
    const parsed = parseKmlDocument(xml);
    expect(parsed?.waypoints).toEqual([
      { lat: 42.05, lng: 9.05, ele: 1200, name: "Refuge fictif", description: "Point d'eau" },
    ]);
  });

  it("lit un gx:Track et ses instants", () => {
    const xml = [
      '<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark><name>Suivi daté</name>',
      "<gx:Track>",
      `<when>${isoAt(0)}</when><when>${isoAt(600)}</when>`,
      "<gx:coord>9.0 42.0 1000</gx:coord><gx:coord>9.001 42.0 1010</gx:coord>",
      "</gx:Track></Placemark></Document></kml>",
    ].join("");
    const parsed = parseKmlDocument(xml);
    expect(parsed?.tracks[0].name).toBe("Suivi daté");
    expect(parsed?.tracks[0].segments[0].points).toEqual([
      { lat: 42, lng: 9, ele: 1000, at: T0 },
      { lat: 42, lng: 9.001, ele: 1010, at: T0 + 600_000 },
    ]);
  });

  it("absorbe les espaces et les retours à la ligne des coordonnées", () => {
    const xml = [
      "<kml><Document><Placemark><LineString><coordinates>",
      "        9.0, 42.0, 1000",
      "        9.001, 42.0, 1010",
      "      </coordinates></LineString></Placemark></Document></kml>",
    ].join("\n");
    const parsed = parseKmlDocument(xml);
    expect(parsed?.tracks[0].segments[0].points).toHaveLength(2);
    expect(parsed?.tracks[0].segments[0].points[1]).toEqual({ lat: 42, lng: 9.001, ele: 1010, at: null });
  });

  it("renvoie null sur un contenu vide, non KML, ou sans géométrie", () => {
    expect(parseKmlDocument("")).toBeNull();
    expect(parseKmlDocument('<gpx version="1.1"></gpx>')).toBeNull();
    expect(parseKmlDocument("<kml><Document><name>Vide</name></Document></kml>")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 3. GeoJSON                                                          */
/* ------------------------------------------------------------------ */

describe("parseGeoJsonDocument", () => {
  it("lit un Feature LineString, son nom et ses altitudes", () => {
    const json = JSON.stringify({
      type: "Feature",
      properties: { name: "Sentier de démonstration", description: "Fichier fictif" },
      geometry: {
        type: "LineString",
        coordinates: [
          [9, 42, 1000],
          [9.001, 42, 1010],
        ],
      },
    });
    const parsed = parseGeoJsonDocument(json);
    expect(parsed?.format).toBe("geojson");
    expect(parsed?.tracks[0].name).toBe("Sentier de démonstration");
    expect(parsed?.tracks[0].description).toBe("Fichier fictif");
    expect(parsed?.tracks[0].segments[0].points[0]).toEqual({ lat: 42, lng: 9, ele: 1000, at: null });
  });

  it("fait un segment par ligne d'un MultiLineString", () => {
    const parsed = parseGeoJsonDocument({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Deux tronçons" },
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [9, 42],
                [9.001, 42],
              ],
              [
                [9.01, 42.01],
                [9.011, 42.01],
              ],
            ],
          },
        },
      ],
    });
    expect(parsed?.tracks).toHaveLength(1);
    expect(parsed?.tracks[0].segments).toHaveLength(2);
    expect(parsed?.tracks[0].segments[1].points[0]).toEqual({ lat: 42.01, lng: 9.01, ele: null, at: null });
  });

  it("accepte une géométrie nue et transforme un Point en waypoint", () => {
    const line = parseGeoJsonDocument({
      type: "LineString",
      coordinates: [
        [9, 42],
        [9.001, 42],
      ],
    });
    expect(line?.tracks[0].segments[0].points).toHaveLength(2);
    const point = parseGeoJsonDocument({ type: "Point", coordinates: [9.05, 42.05, 1200] });
    expect(point?.waypoints).toEqual([
      { lat: 42.05, lng: 9.05, ele: 1200, name: null, description: null },
    ]);
  });

  it("utilise properties.coordTimes quand la convention est présente", () => {
    const parsed = parseGeoJsonDocument({
      type: "Feature",
      properties: { coordTimes: [isoAt(0), isoAt(60)] },
      geometry: {
        type: "LineString",
        coordinates: [
          [9, 42],
          [9.001, 42],
        ],
      },
    });
    expect(parsed?.tracks[0].segments[0].points.map((p) => p.at)).toEqual([T0, T0 + 60_000]);
  });

  it("renvoie null sur un JSON invalide, vide ou sans géométrie", () => {
    expect(parseGeoJsonDocument("{ceci n'est pas du JSON")).toBeNull();
    expect(parseGeoJsonDocument("")).toBeNull();
    expect(parseGeoJsonDocument("[]")).toBeNull();
    expect(parseGeoJsonDocument({ type: "FeatureCollection", features: [] })).toBeNull();
    expect(parseGeoJsonDocument({ type: "LineString", coordinates: "9,42" })).toBeNull();
  });

  it("cesse d'explorer au-delà de INGEST_MAX_GEOJSON_DEPTH", () => {
    const nest = (depth: number): object => {
      let node: object = {
        type: "LineString",
        coordinates: [
          [9, 42],
          [9.001, 42],
        ],
      };
      for (let i = 0; i < depth; i++) node = { type: "GeometryCollection", geometries: [node] };
      return node;
    };
    expect(parseGeoJsonDocument(nest(2))).not.toBeNull();
    expect(parseGeoJsonDocument(nest(INGEST_MAX_GEOJSON_DEPTH + 2))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 4. Aiguillage (sections 17, 18)                                     */
/* ------------------------------------------------------------------ */

describe("parseTraceFile et detectTraceFormat", () => {
  it("reconnaît les trois formats sans le moindre indice", () => {
    expect(parseTraceFile(gpxWith(trkpt(42, 9) + trkpt(42.001, 9)))?.format).toBe("gpx");
    expect(
      parseTraceFile("<kml><Document><Placemark><LineString><coordinates>9,42 9.001,42</coordinates></LineString></Placemark></Document></kml>")
        ?.format,
    ).toBe("kml");
    expect(
      parseTraceFile(JSON.stringify({ type: "LineString", coordinates: [[9, 42], [9.001, 42]] }))?.format,
    ).toBe("geojson");
  });

  it("déduit le format de l'extension quand le contenu ne le dit pas", () => {
    expect(detectTraceFormat("", "trace.gpx")).toBe("gpx");
    expect(detectTraceFormat("   ", "TRACE.KML")).toBe("kml");
    expect(detectTraceFormat("", "export.json")).toBe(INGEST_EXTENSION_FORMATS.json);
    expect(detectTraceFormat("", "archive.kmz")).toBeNull();
    expect(detectTraceFormat("bonjour")).toBeNull();
  });

  it("n'est pas bloqué par un indice de format erroné", () => {
    const kml =
      "<kml><Document><Placemark><LineString><coordinates>9,42 9.001,42</coordinates></LineString></Placemark></Document></kml>";
    const parsed = parseTraceFile(kml, { format: "gpx", fileName: "trace.gpx" });
    expect(parsed?.format).toBe("kml");
    expect(INGEST_FORMATS).toContain("kml");
  });

  it("renvoie null sur un fichier vide ou illisible", () => {
    expect(parseTraceFile("")).toBeNull();
    expect(parseTraceFile("   \n  ")).toBeNull();
    expect(parseTraceFile("ceci n'est ni du GPX, ni du KML, ni du GeoJSON")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 5. Normalisation (section 8)                                        */
/* ------------------------------------------------------------------ */

describe("normalizeTrace — chaîne nominale", () => {
  it("mesure longueur, dénivelés et emprise", () => {
    const points = [pt(42, 9, 1000), pt(42, 9.001, 1010), pt(42, 9.002, 1020)];
    const normalized = normalizeTrace(parsedFrom([points]));
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    const step = haversineM({ lat: 42, lng: 9 }, { lat: 42, lng: 9.001 });
    expect(normalized.coordinates).toEqual([
      [9, 42],
      [9.001, 42],
      [9.002, 42],
    ]);
    expect(normalized.lengthM).toBeCloseTo(2 * step, 0);
    expect(normalized.elevations).toEqual([1000, 1010, 1020]);
    expect(normalized.elevationGainM).toBe(20);
    expect(normalized.elevationLossM).toBe(0);
    expect(normalized.bbox).toEqual({ west: 9, south: 42, east: 9.002, north: 42 });
    expect(normalized.removed).toEqual({});
    expect(normalized.segments).toBe(1);
    expect(normalized.breaks).toEqual([]);
  });

  it("conserve les coupures et ne compte jamais le saut dans la longueur", () => {
    const first = [pt(42, 9), pt(42, 9.001)];
    const second = [pt(42.05, 9.05), pt(42.05, 9.051)];
    const normalized = normalizeTrace(parsedFrom([first, second]));
    expect(normalized?.segments).toBe(2);
    expect(normalized?.breaks).toEqual([2]);
    const step = haversineM({ lat: 42, lng: 9 }, { lat: 42, lng: 9.001 });
    // Sans la coupure, la longueur inclurait les ~7 km séparant les segments.
    expect(normalized?.lengthM ?? 0).toBeLessThan(4 * step);
    expect(normalized?.coordinates).toHaveLength(4);
  });

  it("n'expose les altitudes et les instants que si le fichier les portait tous", () => {
    const partialElevation = normalizeTrace(parsedFrom([[pt(42, 9, 1000), pt(42, 9.001), pt(42, 9.002, 1020)]]));
    expect(partialElevation?.elevations).toBeNull();
    expect(partialElevation?.elevationGainM).toBeNull();
    expect(partialElevation?.elevationLossM).toBeNull();

    const partialTime = normalizeTrace(parsedFrom([[pt(42, 9, null, T0), pt(42, 9.001), pt(42, 9.002, null, T0 + 60_000)]]));
    expect(partialTime?.times).toBeNull();

    const complete = normalizeTrace(parsedFrom([[pt(42, 9, 1000, T0), pt(42, 9.001, 1010, T0 + 60_000)]]));
    expect(complete?.times).toEqual([T0, T0 + 60_000]);
  });

  it("n'utilise les itinéraires qu'à défaut de relevé (INGEST_DEFAULT_ROUTE_USAGE)", () => {
    expect(INGEST_DEFAULT_ROUTE_USAGE).toBe("fallback");
    const route = [pt(42, 9), pt(42, 9.01)];
    const track = [pt(42.1, 9), pt(42.1, 9.001)];

    const onlyRoute = normalizeTrace(parsedFrom([], { routes: [route] }));
    expect(onlyRoute?.coordinates).toHaveLength(2);

    const both = normalizeTrace(parsedFrom([track], { routes: [route] }));
    expect(both?.segments).toBe(1);
    expect(both?.coordinates[0]).toEqual([9, 42.1]);

    expect(normalizeTrace(parsedFrom([track], { routes: [route] }), { routeUsage: "always" })?.segments).toBe(2);
    expect(normalizeTrace(parsedFrom([], { routes: [route] }), { routeUsage: "never" })).toBeNull();
  });
});

describe("normalizeTrace — validation", () => {
  it("écarte les coordonnées hors Terre", () => {
    const normalized = normalizeTrace(parsedFrom([[pt(42, 9), pt(999, 999), pt(42, 9.001)]]));
    expect(normalized?.coordinates).toHaveLength(2);
    expect(normalized?.removed).toEqual({ out_of_bounds: 1 });
  });

  it("écarte le point (0, 0) — « null island » — dans sa tolérance", () => {
    const inside = normalizeTrace(
      parsedFrom([[pt(0.001, 0.001), pt(0.0011, 0.001), pt(INGEST_NULL_ISLAND_TOLERANCE_DEG / 2, 0)]]),
    );
    expect(inside?.coordinates).toHaveLength(2);
    expect(inside?.removed).toEqual({ null_island: 1 });

    // Juste au-delà de la tolérance, le point est une position comme une autre.
    const outside = normalizeTrace(
      parsedFrom([[pt(0.001, 0.001), pt(0.0011, 0.001), pt(INGEST_NULL_ISLAND_TOLERANCE_DEG * 10, 0)]]),
    );
    expect(outside?.coordinates).toHaveLength(3);
    expect(outside?.removed).toEqual({});
  });

  it("remet à l'endroit une inversion latitude/longitude manifeste", () => {
    // Seul le cas manifeste est réparé : latitude hors [-90, 90] alors que
    // l'échange rend le point valide.
    const swapped = [pt(142.1, 9), pt(142.101, 9), pt(142.102, 9)];
    const normalized = normalizeTrace(parsedFrom([swapped]));
    expect(normalized?.coordinates).toEqual([
      [142.1, 9],
      [142.101, 9],
      [142.102, 9],
    ]);
    expect(normalized?.removed).toEqual({});
  });

  it("écarte ces mêmes points quand la correction est refusée", () => {
    const swapped = [pt(142.1, 9), pt(142.101, 9), pt(142.102, 9)];
    expect(normalizeTrace(parsedFrom([swapped]), { fixSwappedCoordinates: false })).toBeNull();
  });
});

describe("normalizeTrace — nettoyage", () => {
  it("retire les doublons exacts et compte chaque retrait", () => {
    const normalized = normalizeTrace(parsedFrom([[pt(42, 9), pt(42, 9), pt(42, 9), pt(42, 9.001)]]));
    expect(normalized?.coordinates).toHaveLength(2);
    expect(normalized?.removed).toEqual({ duplicate: 2 });
  });

  it("respecte la tolérance de doublon demandée", () => {
    const points = [pt(42, 9), pt(42, 9.001), pt(42, 9.01)];
    const step = haversineM({ lat: 42, lng: 9 }, { lat: 42, lng: 9.001 });
    expect(step).toBeGreaterThan(INGEST_DUPLICATE_TOLERANCE_M);
    const normalized = normalizeTrace(parsedFrom([points]), { duplicateToleranceM: step + 1 });
    expect(normalized?.coordinates).toHaveLength(2);
    expect(normalized?.removed).toEqual({ duplicate: 1 });
  });

  it("retire un aller-retour instantané (pic) sans toucher aux points voisins", () => {
    const points = [pt(42, 9), pt(42, 9.001), pt(42.005, 9.0015), pt(42, 9.002), pt(42, 9.003)];
    const normalized = normalizeTrace(parsedFrom([points]));
    expect(normalized?.removed).toEqual({ spike: 1 });
    expect(normalized?.coordinates).toEqual([
      [9, 42],
      [9.001, 42],
      [9.002, 42],
      [9.003, 42],
    ]);
  });

  it("épargne une excursion sous INGEST_SPIKE_MIN_EXCURSION_M", () => {
    // ~22 m d'écart latéral : sous le seuil, c'est du bruit GPS, pas un saut.
    const points = [pt(42, 9), pt(42.0002, 9.00005), pt(42, 9.0001)];
    expect(INGEST_SPIKE_MIN_EXCURSION_M).toBeGreaterThan(20);
    expect(normalizeTrace(parsedFrom([points]))?.coordinates).toHaveLength(3);
    const stricter = normalizeTrace(parsedFrom([points]), { spikeMinExcursionM: 10 });
    expect(stricter?.removed).toEqual({ spike: 1 });
  });

  it("épargne un crochet dont le rapport reste sous INGEST_SPIKE_RATIO", () => {
    expect(INGEST_SPIKE_RATIO).toBeGreaterThan(1);
    const points = [pt(42, 9), pt(42.001, 9.005), pt(42, 9.01)];
    expect(normalizeTrace(parsedFrom([points]))?.coordinates).toHaveLength(3);
    const stricter = normalizeTrace(parsedFrom([points]), { spikeRatio: 1.01 });
    expect(stricter?.removed).toEqual({ spike: 1 });
  });

  it("retire un crochet daté qui exigerait une vitesse impossible", () => {
    const fast = [pt(42, 9, null, T0), pt(42.001, 9.005, null, T0 + 1000), pt(42, 9.01, null, T0 + 2000)];
    expect(normalizeTrace(parsedFrom([fast]))?.removed).toEqual({ spike: 1 });

    // Les mêmes positions parcourues en une heure : plus rien d'impossible.
    const slow = [pt(42, 9, null, T0), pt(42.001, 9.005, null, T0 + 1_800_000), pt(42, 9.01, null, T0 + 3_600_000)];
    expect(normalizeTrace(parsedFrom([slow]))?.coordinates).toHaveLength(3);
    expect(INGEST_SPIKE_MAX_SPEED_M_S).toBeGreaterThan(0);
  });

  it("retire un horodatage antérieur au précédent, tolère un recul infime", () => {
    const disordered = [
      pt(42, 9, null, T0),
      pt(42, 9.001, null, T0 - 3_600_000),
      pt(42, 9.002, null, T0 + 120_000),
    ];
    const normalized = normalizeTrace(parsedFrom([disordered]));
    expect(normalized?.removed).toEqual({ time_disorder: 1 });
    expect(normalized?.times).toEqual([T0, T0 + 120_000]);

    const jitter = [
      pt(42, 9, null, T0),
      pt(42, 9.001, null, T0 - INGEST_TIME_DISORDER_TOLERANCE_MS / 2),
      pt(42, 9.002, null, T0 + 120_000),
    ];
    // Le recul toléré est conservé tel quel : rien n'est réécrit.
    expect(normalizeTrace(parsedFrom([jitter]))?.times).toHaveLength(3);
  });

  it("applique l'hystérésis altimétrique contre le bruit", () => {
    const points = [pt(42, 9, 1000), pt(42, 9.001, 1003), pt(42, 9.002, 1000), pt(42, 9.003, 1010)];
    const normalized = normalizeTrace(parsedFrom([points]));
    expect(INGEST_ELEVATION_HYSTERESIS_M).toBe(5);
    expect(normalized?.elevationGainM).toBe(10);
    expect(normalized?.elevationLossM).toBe(0);

    const raw = normalizeTrace(parsedFrom([points]), { elevationHysteresisM: 0 });
    expect(raw?.elevationGainM).toBe(13);
    expect(raw?.elevationLossM).toBe(3);
  });

  it("énumère les motifs de retrait dans l'ordre de INGEST_CLEANING_FLAGS", () => {
    const points = [pt(42, 9), pt(42, 9), pt(0, 0), pt(42, 9.001)];
    const normalized = normalizeTrace(parsedFrom([points]));
    expect(Object.keys(normalized?.removed ?? {})).toEqual(["null_island", "duplicate"]);
    expect(INGEST_CLEANING_FLAGS).toContain("spike");
  });
});

describe("normalizeTrace — cas dégénérés", () => {
  it("renvoie null en dessous de INGEST_MIN_POINTS", () => {
    expect(INGEST_MIN_POINTS).toBe(2);
    expect(normalizeTrace(parsedFrom([[pt(42, 9)]]))).toBeNull();
    expect(normalizeTrace(parsedFrom([[]]))).toBeNull();
    expect(normalizeTrace(parsedFrom([]))).toBeNull();
  });

  it("ne jette pas sur des coordonnées toutes identiques", () => {
    const identical = [pt(42, 9), pt(42, 9), pt(42, 9)];
    expect(normalizeTrace(parsedFrom([identical]))).toBeNull();
  });

  it("ne produit ni NaN ni Infinity sur des champs incohérents", () => {
    const wild = [
      pt(42, 9, Number.NaN, Number.NaN),
      pt(42, 9.001, Number.POSITIVE_INFINITY, T0),
      pt(42, 9.002, 1000, T0 + 60_000),
    ];
    const normalized = normalizeTrace(parsedFrom([wild]));
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    expect(Number.isFinite(normalized.lengthM)).toBe(true);
    // Les altitudes et les instants sont incomplets : rien n'est publié.
    expect(normalized.elevations).toBeNull();
    expect(normalized.times).toBeNull();
    for (const value of Object.values(normalized.bbox)) expect(Number.isFinite(value)).toBe(true);
  });

  it("supporte une trace de deux points confondus à la tolérance près", () => {
    const normalized = normalizeTrace(parsedFrom([[pt(42, 9), pt(42, 9.0000001), pt(42, 9.5)]]));
    expect(normalized?.coordinates).toHaveLength(2);
    expect(normalized?.lengthM ?? 0).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Empreinte géométrique                                            */
/* ------------------------------------------------------------------ */

describe("traceHash", () => {
  it("produit une empreinte préfixée, stable d'un appel à l'autre", () => {
    const normalized = normalizeTrace(parsedFrom([straightLine(5, 0.002)]));
    expect(normalized).not.toBeNull();
    if (normalized === null) return;
    const hash = traceHash(normalized);
    expect(hash.startsWith(INGEST_HASH_PREFIX)).toBe(true);
    expect(hash).toBe(traceHash(normalized));
    expect(hash).toHaveLength(INGEST_HASH_PREFIX.length + 16);
  });

  it("tolère le rééchantillonnage : même parcours, fréquences différentes", () => {
    // ~830 m de ligne droite, relevés tous les ~83 m puis tous les ~17 m.
    const sparse = normalizeTrace(parsedFrom([straightLine(11, 0.001)]));
    const dense = normalizeTrace(parsedFrom([straightLine(51, 0.0002)]));
    expect(sparse).not.toBeNull();
    expect(dense).not.toBeNull();
    if (sparse === null || dense === null) return;
    expect(dense.coordinates.length).toBeGreaterThan(sparse.coordinates.length);
    expect(traceHash(dense)).toBe(traceHash(sparse));
    expect(INGEST_HASH_SAMPLE_M).toBeGreaterThan(0);
  });

  it("ignore un écart inférieur à la grille INGEST_HASH_PRECISION", () => {
    // ~2 cm de décalage : sous la grille de ~1,1 m, c'est le même parcours.
    const shift = 1 / (INGEST_HASH_PRECISION * 50);
    const base = normalizeTrace(parsedFrom([straightLine(9, 0.002)]));
    const nudged = normalizeTrace(parsedFrom([straightLine(9, 0.002, 42 + shift, 9 + shift)]));
    expect(base).not.toBeNull();
    expect(nudged).not.toBeNull();
    if (base === null || nudged === null) return;
    expect(nudged.coordinates).not.toEqual(base.coordinates);
    expect(traceHash(nudged)).toBe(traceHash(base));
  });

  it("neutralise le sens de parcours", () => {
    const forward = normalizeTrace(parsedFrom([straightLine(9, 0.0015)]));
    const backward = normalizeTrace(parsedFrom([[...straightLine(9, 0.0015)].reverse()]));
    expect(forward).not.toBeNull();
    expect(backward).not.toBeNull();
    if (forward === null || backward === null) return;
    expect(traceHash(backward)).toBe(traceHash(forward));
  });

  it("distingue deux parcours différents", () => {
    const first = normalizeTrace(parsedFrom([straightLine(9, 0.0015)]));
    const second = normalizeTrace(parsedFrom([straightLine(9, 0.0015, 42.5, 9.5)]));
    if (first === null || second === null) {
      expect(first).not.toBeNull();
      return;
    }
    expect(traceHash(second)).not.toBe(traceHash(first));
  });

  it("ne jette pas sur une trace dégénérée", () => {
    const empty = {
      coordinates: [],
      elevations: null,
      times: null,
      lengthM: 0,
      elevationGainM: null,
      elevationLossM: null,
      bbox: { west: 0, south: 0, east: 0, north: 0 },
      removed: {},
      segments: 0,
      breaks: [],
    };
    expect(() => traceHash(empty)).not.toThrow();
    expect(traceHash(empty).startsWith(INGEST_HASH_PREFIX)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Déterminisme                                                     */
/* ------------------------------------------------------------------ */

describe("déterminisme", () => {
  it("rend deux fois exactement la même structure pour le même fichier", () => {
    const xml = gpxWith(
      [trkpt(42, 9, 1000, 0), trkpt(42, 9), trkpt(0, 0), trkpt(42.005, 9.0015), trkpt(42, 9.002, 1020, 240)].join(""),
    );
    const first = parseTraceFile(xml, { fileName: "démonstration.gpx" });
    const second = parseTraceFile(xml, { fileName: "démonstration.gpx" });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (first === null || second === null) return;

    const a = normalizeTrace(first);
    const b = normalizeTrace(second);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if (a === null || b === null) return;
    expect(traceHash(a)).toBe(traceHash(b));
  });
});
