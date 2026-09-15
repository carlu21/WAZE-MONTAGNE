/**
 * LA CHAÎNE COMPLÈTE, DES DONNÉES OSM À L'ITINÉRAIRE.
 *
 * Ces tests couvrent les scénarios 34 à 40 du cahier des charges de
 * fiabilisation. Ils travaillent sur une relation OpenStreetMap fabriquée ici —
 * aucune requête réseau — mais qui passe par EXACTEMENT le même pipeline que
 * l'import réel : `segmentsFromOverpass` → `upsertPaths` → `routesFromOverpass`
 * → `upsertTrails` → `linkImportedTrail` → `trailGeometry`.
 *
 * Le test qui compte le plus est celui du vol d'oiseau : un itinéraire calculé
 * entre deux points doit suivre les chemins, et le test échoue si le résultat
 * ressemble à un simple segment A → B.
 */
import { describe, expect, it } from "vitest";
import { geometryFidelity, haversineM, routeVerdict, type LngLat, type RoutePlanResponse, type TrailGeometryResponse } from "@mountain-live/core";
import { call, setup } from "./helpers";
import { routesFromOverpass, segmentsFromOverpass, type OverpassJson } from "../src/services/osm";
import { upsertPaths } from "../src/services/paths";
import { upsertTrails } from "../src/services/reference";
import { linkImportedTrail, trailSegmentRows } from "../src/services/trail-segments";
import { db } from "../src/db/client";
import { trailSegments } from "../src/db/schema";

const { app } = await setup();

/* ------------------------------------------------------------------ */
/* Un petit territoire OSM fabriqué : trois ways en arc de cercle       */
/* ------------------------------------------------------------------ */

/**
 * Arc de cercle : le contraire d'une ligne droite, et donc exactement ce qu'il
 * faut pour prouver qu'un itinéraire suit le terrain. Un segment A→B en ligne
 * droite serait bien plus court que cet arc — un routeur qui coupe se voit.
 *
 * L'échantillonnage (45 sommets pour 60° d'arc, soit un point tous les ~50 m)
 * n'est pas cosmétique : plus grossier, le jeu d'essai serait lui-même jugé
 * schématique par `geometryFidelity`, et le test vérifierait le contraire de ce
 * qu'il croit vérifier. Un vrai way OpenStreetMap de montagne est à cette échelle.
 */
function arc(centre: LngLat, radiusDeg: number, fromDeg: number, toDeg: number, points = 45): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i < points; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / (points - 1)) * Math.PI) / 180;
    out.push([centre[0] + radiusDeg * Math.cos(a), centre[1] + radiusDeg * Math.sin(a) * 0.74]);
  }
  return out;
}

const CENTRE: LngLat = [9.06, 42.0];
/** Trois ways bout à bout décrivant un demi-cercle : 0° → 60° → 120° → 180°. */
const WAY_A = arc(CENTRE, 0.02, 0, 60);
const WAY_B = arc(CENTRE, 0.02, 60, 120);
const WAY_C = arc(CENTRE, 0.02, 120, 180);

let nodeId = 1;
function overpassWays(ways: { id: number; coords: LngLat[] }[], tags: Record<string, string> = { highway: "path" }): OverpassJson {
  const elements: OverpassJson["elements"] = [];
  for (const w of ways) {
    const ids: number[] = [];
    for (const [lon, lat] of w.coords) {
      const id = nodeId++;
      ids.push(id);
      elements.push({ type: "node", id, lat, lon } as never);
    }
    elements.push({ type: "way", id: w.id, nodes: ids, tags } as never);
  }
  return { elements };
}

/** Relation `route=hiking` reprenant des ways déjà décrits, avec leurs nœuds. */
function overpassRelation(relId: number, ways: { id: number; coords: LngLat[] }[], tags: Record<string, string>): OverpassJson {
  const base = overpassWays(ways);
  return {
    elements: [
      ...(base.elements ?? []),
      {
        type: "relation",
        id: relId,
        members: ways.map((w) => ({ type: "way", ref: w.id, role: "" })),
        tags: { type: "route", route: "hiking", ...tags },
      } as never,
    ],
  };
}

/* ------------------------------------------------------------------ */

describe("Import OSM — provenance et liaison au réseau", () => {
  it("conserve l'identifiant du way source sur chacun de ses segments (§8, §9)", () => {
    const segments = segmentsFromOverpass(overpassWays([{ id: 891234, coords: WAY_A }]));
    expect(segments.length).toBeGreaterThanOrEqual(1);
    for (const s of segments) {
      expect(s.sourceFeatureId).toBe("way/891234");
      expect(s.source).toBe("osm");
    }
  });

  it("associe une randonnée à TOUS les segments issus d'un way découpé (§38)", () => {
    /*
     * Deux ways qui se croisent en leur milieu : le découpage aux intersections
     * transforme le way 700 en plusieurs segments. La relation ne cite pourtant
     * que le way — elle doit récupérer tous ses morceaux.
     */
    const horizontal: LngLat[] = [
      [9.2, 41.6],
      [9.21, 41.6],
      [9.22, 41.6],
      [9.23, 41.6],
      [9.24, 41.6],
    ];
    const crossing: LngLat[] = [
      [9.22, 41.59],
      [9.22, 41.6],
      [9.22, 41.61],
    ];
    const segments = segmentsFromOverpass(
      overpassWays([
        { id: 700, coords: horizontal },
        { id: 701, coords: crossing },
      ]),
    );
    upsertPaths(segments);
    const pieces = segments.filter((s) => s.sourceFeatureId === "way/700");
    expect(pieces.length).toBeGreaterThanOrEqual(2);

    upsertTrails([
      {
        id: "osm_rel_700",
        name: "Traversée",
        type: "hiking",
        difficulty: "easy",
        distanceKm: 3,
        elevationGainM: 0,
        geometry: { type: "LineString", coordinates: horizontal.map((c) => [c[0], c[1]] as [number, number]) },
        description: null,
        source: "osm",
      },
    ]);
    const result = linkImportedTrail({ trailId: "osm_rel_700", geometry: horizontal, memberWayIds: [700], source: "osm" });
    expect(result.expectedWays).toBe(1);
    expect(result.resolvedWays).toBe(1);
    expect(result.linkedSegments).toBe(pieces.length);
    expect(result.coverage).toBe(1);

    const rows = trailSegmentRows("osm_rel_700");
    expect(rows.map((r) => r.path.id).sort()).toEqual(pieces.map((p) => p.id).sort());
    // L'ordre de parcours est reconstruit : les séquences se suivent sans trou.
    expect(rows.map((r) => r.link.sequence)).toEqual(rows.map((_, i) => i));
  });

  it("laisse un même segment appartenir à deux randonnées sans que l'une efface l'autre (§37)", () => {
    const shared: LngLat[] = [
      [8.7, 42.5],
      [8.71, 42.505],
      [8.72, 42.51],
    ];
    upsertPaths(segmentsFromOverpass(overpassWays([{ id: 900, coords: shared }])));
    for (const id of ["osm_rel_A", "osm_rel_B"]) {
      upsertTrails([
        {
          id,
          name: id,
          type: "hiking",
          difficulty: "easy",
          distanceKm: 2,
          elevationGainM: 0,
          geometry: { type: "LineString", coordinates: shared.map((c) => [c[0], c[1]] as [number, number]) },
          description: null,
          source: "osm",
        },
      ]);
      linkImportedTrail({ trailId: id, geometry: shared, memberWayIds: [900], source: "osm" });
    }
    const rowsA = trailSegmentRows("osm_rel_A");
    const rowsB = trailSegmentRows("osm_rel_B");
    expect(rowsA.length).toBeGreaterThan(0);
    expect(rowsB.length).toBeGreaterThan(0);
    // Le MÊME segment, deux associations distinctes.
    expect(rowsA[0].path.id).toBe(rowsB[0].path.id);
    const all = db.select().from(trailSegments).all().filter((l) => l.segmentId === rowsA[0].path.id);
    expect(new Set(all.map((l) => l.trailId))).toEqual(new Set(["osm_rel_A", "osm_rel_B"]));
  });

  it("écrit la provenance « osm » et la restitue jusqu'au frontend (§36)", async () => {
    const json = overpassRelation(4242, [{ id: 1001, coords: WAY_A }, { id: 1002, coords: WAY_B }, { id: 1003, coords: WAY_C }], { name: "Arc de démonstration" });
    upsertPaths(segmentsFromOverpass(json));
    const [trail] = routesFromOverpass(json, { minLengthM: 100 });
    expect(trail).toBeDefined();
    // La provenance est PORTÉE par l'import, pas déduite du préfixe d'identifiant.
    expect(trail.source).toBe("osm");
    expect(trail.memberWayIds).toEqual([1001, 1002, 1003]);

    upsertTrails([{ ...trail, gapCount: trail.gaps }]);
    const link = linkImportedTrail({ trailId: trail.id, geometry: trail.geometry.coordinates, memberWayIds: trail.memberWayIds, source: trail.source, gaps: trail.gaps });
    expect(link.coverage).toBe(1);

    const res = await call<TrailGeometryResponse>(app, "GET", `/trails/${trail.id}/geometry`);
    expect(res.status).toBe(200);
    expect(res.body.trailSource).toBe("osm");
    expect(res.body.source).toBe("osm");
    expect(res.body.geometryFrom).toBe("segments");
    expect(res.body.segmentCount).toBeGreaterThan(0);
    expect(res.body.linkCoverage).toBe(1);
  });

  it("déclare la géométrie détaillée affichable, et la schématique non (§39, §40)", async () => {
    const detailed = await call<TrailGeometryResponse>(app, "GET", "/trails/osm_rel_4242/geometry");
    const real = routeVerdict({ coordinates: detailed.body.coordinates, source: detailed.body.source, declaredLengthM: detailed.body.declaredLengthM });
    expect(geometryFidelity(detailed.body.coordinates).level).toBe("detailed");
    expect(real.drawable).toBe(true);
    expect(real.refusal).toBeNull();

    // Une randonnée de 90 km décrite par une poignée de points reste un schéma.
    const schematic = routeVerdict({
      coordinates: [
        [8.85, 42.5],
        [8.92, 42.44],
        [8.92, 42.37],
        [8.94, 42.26],
        [9.02, 42.24],
        [9.08, 42.18],
        [9.13, 42.13],
      ],
      source: "osm",
      declaredLengthM: 90_000,
    });
    expect(schematic.drawable).toBe(false);
    expect(schematic.refusal).toBe("schematic_geometry");
  });
});

describe("Routage sur le réseau réel", () => {
  it("relie deux points du réseau en suivant les chemins (§34)", async () => {
    const from = { lng: WAY_A[0][0], lat: WAY_A[0][1] };
    const to = { lng: WAY_C[WAY_C.length - 1][0], lat: WAY_C[WAY_C.length - 1][1] };
    const res = await call<RoutePlanResponse>(app, "POST", "/network/routes", { body: { from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng }, activity: "hiking" } });
    expect(res.status).toBe(200);
    expect(res.body.unreachable).toBe(false);
    const option = res.body.options[0];
    expect(option).toBeDefined();
    // Les segments empruntés sont ceux du réseau, et leur provenance est OSM.
    expect(option.sources).toEqual(["osm"]);
    expect(option.legs.length).toBeGreaterThanOrEqual(3);
  });

  it("NE COUPE PAS À VOL D'OISEAU entre les deux points (§35)", async () => {
    const from = { lat: WAY_A[0][1], lng: WAY_A[0][0] };
    const to = { lat: WAY_C[WAY_C.length - 1][1], lng: WAY_C[WAY_C.length - 1][0] };
    const res = await call<RoutePlanResponse>(app, "POST", "/network/routes", { body: { from, to, activity: "hiking" } });
    const option = res.body.options[0];
    expect(option).toBeDefined();

    // 1. Le tracé n'est pas un simple [A, B].
    expect(option.coordinates.length).toBeGreaterThan(10);

    // 2. Il est nettement plus long que la ligne droite : l'arc fait π/2 fois
    //    le diamètre. Un itinéraire proche de la corde signerait une coupe.
    const straightM = haversineM(from, to);
    expect(option.distanceM).toBeGreaterThan(straightM * 1.3);

    // 3. Aucun bond rectiligne : la géométrie reste celle de chemins réels.
    const fidelity = geometryFidelity(option.coordinates);
    expect(fidelity.level).toBe("detailed");
    expect(fidelity.maxGapM).toBeLessThan(600);

    // 4. Et le milieu du parcours s'écarte franchement de la corde — la preuve
    //    qu'on a bien contourné, et non traversé.
    const middle = option.coordinates[Math.floor(option.coordinates.length / 2)];
    const chordMiddle = { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
    expect(haversineM({ lng: middle[0], lat: middle[1] }, chordMiddle)).toBeGreaterThan(500);
  });
});
