import { describe, expect, it } from "vitest";
import type { OfflineBundle, PathSegment, Trail } from "@mountain-live/core";
import { call, setup } from "./helpers";
import { kindFromHighway, metaFromTags, overpassQuery, parseWidth, segmentsFromGeoJson, segmentsFromOverpass } from "../src/services/osm";
import { splitAtSharedNodes } from "../src/services/paths";

const { app, seedReference } = await setup();
const ref = seedReference();

describe("Réseau de chemins (navigation)", () => {
  it("le jeu de démonstration crée un réseau découpé aux intersections", async () => {
    expect(ref.paths).toBeGreaterThan(15);
    // Restonica : la variante de Capitello part d'un sommet du sentier de Melo → le sentier est coupé là.
    const res = await call<{ paths: PathSegment[]; truncated: boolean }>(app, "GET", "/paths?bbox=9.0,42.2,9.06,42.24");
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    const ids = res.body.paths.map((p) => p.id);
    expect(ids.some((id) => id.startsWith("d_t_restonica_melo_"))).toBe(true);
    expect(ids).toContain("d_variante_capitello");
    const restonica = res.body.paths.filter((p) => p.id.startsWith("d_t_restonica_melo"));
    expect(restonica.length).toBeGreaterThanOrEqual(3);
    for (const p of restonica) {
      expect(p.kind).toBe("path");
      expect(p.source).toBe("seed");
      expect(p.lengthM).toBeGreaterThan(0);
      expect(p.coordinates.length).toBeGreaterThanOrEqual(2);
    }
    // Densification : un sommet tous les ~25 m.
    const total = restonica.reduce((n, p) => n + p.coordinates.length, 0);
    expect(total).toBeGreaterThan(100);
    const gue = res.body.paths.find((p) => p.id === "d_gue_agnone");
    expect(gue).toBeUndefined(); // hors emprise
    const bbox = await call<{ error: { code: string } }>(app, "GET", "/paths");
    expect(bbox.status).toBe(400);
  });

  it("expose un gué et un escalier avec leurs restrictions", async () => {
    const res = await call<{ paths: PathSegment[] }>(app, "GET", "/paths?bbox=9.1,42.1,9.16,42.14");
    const gue = res.body.paths.find((p) => p.id === "d_gue_agnone");
    expect(gue?.ford).toBe(true);
    const corte = await call<{ paths: PathSegment[] }>(app, "GET", "/paths?bbox=9.14,42.30,9.16,42.31");
    const steps = corte.body.paths.find((p) => p.id === "d_escalier_tavignano");
    expect(steps?.kind).toBe("steps");
    expect(steps?.bicycle).toBe(false);
    expect(steps?.horse).toBe(false);
  });

  it("sert un itinéraire par identifiant et l'inclut avec les chemins dans le bundle hors connexion", async () => {
    const trail = await call<{ trail: Trail }>(app, "GET", "/trails/t_restonica_melo");
    expect(trail.status).toBe(200);
    expect(trail.body.trail.geometry.type).toBe("LineString");
    expect((await call(app, "GET", "/trails/inconnu")).status).toBe(404);
    const bundle = await call<OfflineBundle>(app, "GET", "/offline/bundle?bbox=9.0,42.2,9.06,42.24");
    expect(bundle.status).toBe(200);
    expect(bundle.body.paths.length).toBeGreaterThan(3);
    expect(bundle.body.trails.some((t) => t.id === "t_restonica_melo")).toBe(true);
  });
});

describe("Import OpenStreetMap", () => {
  const overpass = {
    elements: [
      { type: "node", id: 1, lat: 42.0, lon: 9.0 },
      { type: "node", id: 2, lat: 42.001, lon: 9.0 },
      { type: "node", id: 3, lat: 42.002, lon: 9.0 },
      { type: "node", id: 4, lat: 42.001, lon: 9.001 },
      { type: "node", id: 5, lat: 42.001, lon: 9.002 },
      { type: "node", id: 6, lat: 42.003, lon: 9.0 },
      { type: "way", id: 100, nodes: [1, 2, 3], tags: { highway: "path", name: "Sentier principal", sac_scale: "mountain_hiking", surface: "ground", width: "1.5 m" } },
      { type: "way", id: 200, nodes: [2, 4, 5], tags: { highway: "steps", ford: "yes" } },
      { type: "way", id: 300, nodes: [3, 6], tags: { highway: "track", access: "no" } },
      { type: "way", id: 400, nodes: [5, 6], tags: { highway: "residential" } },
      { type: "way", id: 500, nodes: [6], tags: { highway: "path" } },
    ],
  };

  it("convertit une réponse Overpass en segments découpés aux nœuds partagés", () => {
    const segs = segmentsFromOverpass(overpass);
    const ids = segs.map((s) => s.id).sort();
    // Le chemin 100 est coupé au nœud 2 (départ du 200) ; 300 relie 3 → 6 sans coupure ; 400 (residential) exclu.
    expect(ids).toEqual(["osm_100_0", "osm_100_1", "osm_200", "osm_300"]);
    const main = segs.find((s) => s.id === "osm_100_0")!;
    expect(main.name).toBe("Sentier principal");
    expect(main.kind).toBe("path");
    expect(main.sacScale).toBe("mountain_hiking");
    expect(main.widthM).toBe(1.5);
    expect(main.lengthM).toBeCloseTo(111, -1);
    expect(main.coordinates[main.coordinates.length - 1]).toEqual([9.0, 42.001]);
    const steps = segs.find((s) => s.id === "osm_200")!;
    expect(steps.kind).toBe("steps");
    expect(steps.ford).toBe(true);
    expect(steps.bicycle).toBe(false);
    expect(steps.horse).toBe(false);
    expect(steps.foot).toBe(true);
    const closed = segs.find((s) => s.id === "osm_300")!;
    expect(closed.status).toBe("closed");
    expect(closed.foot).toBe(false);
  });

  it("interprète les tags d'accès et de largeur", () => {
    expect(kindFromHighway("pedestrian")).toBe("footway");
    expect(kindFromHighway("unclassified")).toBe("road");
    expect(kindFromHighway("motorway")).toBe("unknown");
    expect(parseWidth("2,5")).toBe(2.5);
    expect(parseWidth("narrow")).toBeNull();
    const m = metaFromTags({ highway: "path", bicycle: "no", horse: "designated", access: "private", foot: "yes" });
    expect(m.bicycle).toBe(false);
    expect(m.horse).toBe(true);
    expect(m.foot).toBe(true);
    expect(m.status).toBeNull();
    const cycle = metaFromTags({ highway: "cycleway" });
    expect(cycle.horse).toBe(false);
    expect(cycle.bicycle).toBe(true);
    expect(overpassQuery({ west: 9, south: 42, east: 9.1, north: 42.1 })).toContain("(42,9,42.1,9.1)");
  });

  it("lit un GeoJSON de lignes", () => {
    const segs = segmentsFromGeoJson({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { "@id": "way/42", highway: "track", name: "Piste" }, geometry: { type: "LineString", coordinates: [[9, 42], [9.001, 42]] } },
        { type: "Feature", properties: null, geometry: { type: "MultiLineString", coordinates: [[[9.002, 42], [9.003, 42]], [[9.004, 42], [9.005, 42]]] } },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [9, 42] } },
      ],
    });
    expect(segs.map((s) => s.id)).toEqual(["osm_42", "geo_1", "geo_2"]);
    expect(segs[0].kind).toBe("track");
    expect(segs[1].kind).toBe("path");
  });

  it("coupe une boucle qui repasse par un de ses sommets", () => {
    const segs = splitAtSharedNodes([{ id: "loop", coordinates: [[9, 42], [9.001, 42], [9.001, 42.001], [9, 42.001], [9.001, 42], [9.002, 42]], meta: {} }]);
    expect(segs.map((s) => s.id)).toEqual(["loop_0", "loop_1", "loop_2"]);
  });
});
