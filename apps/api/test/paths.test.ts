import { describe, expect, it } from "vitest";
import type { NetworkStats, OfflineBundle, PathSegment, Trail, TrailSummary } from "@mountain-live/core";
import { call, setup } from "./helpers";
import { chainWays, kindFromHighway, mergeParts, metaFromTags, overpassQuery, overpassRoutesQuery, parseWidth, routesFromOverpass, segmentsFromGeoJson, segmentsFromOverpass } from "../src/services/osm";
import { upsertTrails } from "../src/services/reference";
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

describe("Import des itinéraires balisés (relations OSM)", () => {
  const n = (id: number, lat: number, lon: number) => ({ type: "node", id, lat, lon });
  const routes = {
    elements: [
      { type: "relation", id: 9000, tags: { type: "superroute", route: "hiking", name: "GR 20", ref: "GR 20", operator: "FFRandonnée" }, members: [{ type: "relation", ref: 9001, role: "" }, { type: "relation", ref: 9002, role: "" }] },
      { type: "relation", id: 9001, tags: { type: "route", route: "hiking", name: "GR 20 — Étape 1", from: "Calenzana", to: "Ortu di u Piobbu", ascent: "1450 m" }, members: [{ type: "way", ref: 1, role: "" }, { type: "way", ref: 2, role: "" }, { type: "way", ref: 5, role: "alternative" }] },
      { type: "relation", id: 9002, tags: { type: "route", route: "hiking", name: "GR 20 — Étape 2" }, members: [{ type: "way", ref: 3, role: "" }, { type: "way", ref: 4, role: "" }] },
      { type: "relation", id: 9003, tags: { type: "route", route: "mtb", name: "Boucle VTT" }, members: [{ type: "way", ref: 6, role: "" }] },
      { type: "relation", id: 9004, tags: { type: "route", route: "bus", name: "Ligne 3" }, members: [{ type: "way", ref: 1, role: "" }] },
      // Étape 1 : chemins 1 puis 2 (le 2 est décrit à l'envers) ; étape 2 : 4 puis 3 (ordre inversé, raccordés par extrémités).
      { type: "way", id: 1, nodes: [10, 11, 12], tags: { highway: "path", sac_scale: "mountain_hiking" } },
      { type: "way", id: 2, nodes: [14, 13, 12], tags: { highway: "path", sac_scale: "demanding_mountain_hiking" } },
      { type: "way", id: 3, nodes: [15, 16], tags: { highway: "path" } },
      { type: "way", id: 4, nodes: [14, 15], tags: { highway: "path" } },
      { type: "way", id: 5, nodes: [10, 20], tags: { highway: "path" } },
      { type: "way", id: 6, nodes: [30, 31], tags: { highway: "track" } },
      n(10, 42.5, 8.85), n(11, 42.49, 8.86), n(12, 42.48, 8.87), n(13, 42.47, 8.88), n(14, 42.46, 8.89), n(15, 42.45, 8.9), n(16, 42.44, 8.91), n(20, 42.51, 8.84), n(30, 42.3, 8.9), n(31, 42.31, 8.9),
    ],
  };

  it("assemble les relations (et super-relations) en itinéraires continus", () => {
    const trails = routesFromOverpass(routes as never, { minLengthM: 500 });
    const ids = trails.map((t) => t.id);
    expect(ids).toContain("osm_rel_9000");
    expect(ids).toContain("osm_rel_9001");
    expect(ids).toContain("osm_rel_9003");
    expect(ids).not.toContain("osm_rel_9004");
    const gr = trails.find((t) => t.id === "osm_rel_9000")!;
    expect(gr.name).toBe("GR 20");
    expect(gr.type).toBe("hiking");
    expect(gr.difficulty).toBe("hard");
    // 10 → 11 → 12 → 13 → 14 → 15 → 16 sans doublon ni saut.
    expect(gr.geometry.coordinates).toHaveLength(7);
    expect(gr.geometry.coordinates[0]).toEqual([8.85, 42.5]);
    expect(gr.geometry.coordinates[6]).toEqual([8.91, 42.44]);
    expect(gr.gaps).toBe(0);
    expect(gr.distanceKm).toBeGreaterThan(8);
    expect(gr.description).toContain("Balisage : FFRandonnée");
    const e1 = trails.find((t) => t.id === "osm_rel_9001")!;
    expect(e1.elevationGainM).toBe(1450);
    expect(e1.geometry.coordinates).toHaveLength(5); // la variante (rôle alternative) est ignorée
    expect(e1.description).toBe("Calenzana → Ortu di u Piobbu");
    const vtt = trails.find((t) => t.id === "osm_rel_9003")!;
    expect(vtt.type).toBe("mtb");
    expect(vtt.difficulty).toBe("moderate");
  });

  it("enchaîne des tronçons dans le désordre et compte les écarts", () => {
    const a: [number, number][] = [[9, 42], [9.001, 42]];
    const b: [number, number][] = [[9.002, 42], [9.001, 42]];
    const c: [number, number][] = [[9.01, 42], [9.011, 42]];
    const parts = chainWays([c, a, b]);
    expect(parts).toHaveLength(2);
    const merged = mergeParts(parts);
    expect(merged.gaps).toBe(1);
    expect(merged.line[0]).toEqual([9.01, 42]);
    expect(overpassRoutesQuery({ west: 9, south: 42, east: 9.1, north: 42.1 })).toContain('relation["type"~"^(route|superroute)$"]');
  });

  it("enregistre les itinéraires importés et les résume sans géométrie", async () => {
    const trails = routesFromOverpass(routes as never, { minLengthM: 500 });
    expect(upsertTrails(trails)).toBe(trails.length);
    expect(upsertTrails(trails)).toBe(trails.length);
    const res = await call<{ trails: TrailSummary[] }>(app, "GET", "/trails?bbox=8.8,42.4,9.0,42.6&summary=1");
    const gr = res.body.trails.find((t) => t.id === "osm_rel_9000")!;
    expect(gr).toBeDefined();
    expect((gr as unknown as { geometry?: unknown }).geometry).toBeUndefined();
    expect(gr.start).toEqual({ lng: 8.85, lat: 42.5 });
    expect(gr.points).toBe(7);
    const stats = await call<NetworkStats>(app, "GET", "/paths/stats");
    expect(stats.body.trails.osm).toBeGreaterThanOrEqual(3);
    expect(stats.body.paths.seed).toBeGreaterThan(0);
    expect(stats.body.paths.osm).toBe(0);
  });
});
