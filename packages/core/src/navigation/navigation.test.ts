import { describe, expect, it } from "vitest";
import { haversineM, offsetPoint, type LngLat } from "../geo";
import type { OfficialAlert, Report, WaterPoint } from "../types";
import {
  acceptTrackPoint,
  addSegments,
  areConnected,
  axisDiff,
  backtrackRoute,
  buildGpx,
  buildPathGraph,
  buildRoute,
  collectFreeEvents,
  collectRouteEvents,
  computeAheadAlerts,
  computeManeuvers,
  createMatchState,
  createNavState,
  createOffRouteState,
  currentInstruction,
  deadReckon,
  estimateEta,
  formatDurationShort,
  gpsQuality,
  headingDelta,
  isSegmentAllowed,
  junctionsNear,
  makeSegment,
  matchFix,
  maneuverText,
  navigationStep,
  offRouteThresholdM,
  parseGpx,
  pointAtAlong,
  pointInRing,
  projectOnPolyline,
  projectOnRoute,
  returnGuidance,
  routeFromGpx,
  segmentsNear,
  simplifyPoints,
  sliceAlong,
  trackStats,
  updateOffRoute,
  type GpsFix,
  type NavContext,
  type PathSegment,
  type TrackPoint,
} from "./index";

/* ------------------------------------------------------------------ */
/* Réseau synthétique : sentier est-ouest de 2 km, embranchement vers le nord à 1 km */
/* ------------------------------------------------------------------ */

const ORIGIN = { lat: 42.22, lng: 9.03 };

/** Ligne droite de `lengthM` mètres depuis `start` au cap `brg`, un point tous les `stepM`. */
function line(start: { lat: number; lng: number }, brg: number, lengthM: number, stepM = 50): LngLat[] {
  const out: LngLat[] = [];
  for (let d = 0; d <= lengthM + 1e-6; d += stepM) {
    const p = offsetPoint(start, Math.min(d, lengthM), brg);
    out.push([p.lng, p.lat]);
  }
  const last = out[out.length - 1];
  const end = offsetPoint(start, lengthM, brg);
  if (haversineM({ lng: last[0], lat: last[1] }, end) > 0.5) out.push([end.lng, end.lat]);
  return out;
}

const JUNCTION = offsetPoint(ORIGIN, 1000, 90);
const MAIN_WEST = makeSegment("main-w", line(ORIGIN, 90, 1000), { name: "Sentier de Grotelle", kind: "path", source: "seed" });
const MAIN_EAST = makeSegment("main-e", line(JUNCTION, 90, 1000), { name: "Sentier de Grotelle", kind: "path", source: "seed" });
const BRANCH = makeSegment("branch", line(JUNCTION, 0, 800), { name: "Sentier du lac", kind: "path", source: "seed" });
const STEPS = makeSegment("steps", line(offsetPoint(ORIGIN, 500, 180), 180, 200), { kind: "steps", bicycle: false, horse: false });
const NETWORK: PathSegment[] = [MAIN_WEST, MAIN_EAST, BRANCH, STEPS];

function fix(p: { lat: number; lng: number }, at: number, extra: Partial<GpsFix> = {}): GpsFix {
  return { lat: p.lat, lng: p.lng, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null, at, ...extra };
}

/** Marche le long d'une ligne de repère : positions décalées latéralement de `offsetM` (bruit GPS simulé). */
function walk(start: { lat: number; lng: number }, brg: number, lengthM: number, stepM: number, offsetM: number, startAt = 0, intervalMs = 5000): GpsFix[] {
  const out: GpsFix[] = [];
  let i = 0;
  for (let d = 0; d <= lengthM; d += stepM, i++) {
    const onLine = offsetPoint(start, d, brg);
    const p = offsetM ? offsetPoint(onLine, Math.abs(offsetM), brg + (offsetM > 0 ? 90 : -90)) : onLine;
    out.push(fix(p, startAt + i * intervalMs));
  }
  return out;
}

/* ------------------------------------------------------------------ */

describe("géométrie", () => {
  it("projette un point sur une polyligne avec abscisse curviligne", () => {
    const seg = MAIN_WEST;
    const p = offsetPoint(offsetPoint(ORIGIN, 300, 90), 8, 0);
    const proj = projectOnPolyline(p, seg.coordinates)!;
    expect(proj.distanceM).toBeCloseTo(8, 0);
    expect(proj.along).toBeCloseTo(300, -1);
    expect(Math.round(proj.segmentBearing)).toBe(90);
    expect(haversineM(proj.snapped, offsetPoint(ORIGIN, 300, 90))).toBeLessThan(1);
  });

  it("limite la recherche à une fenêtre de segments", () => {
    const seg = MAIN_WEST;
    const p = offsetPoint(ORIGIN, 900, 90);
    const proj = projectOnPolyline(p, seg.coordinates, undefined, { from: 0, to: 2 })!;
    expect(proj.index).toBe(2);
    expect(proj.along).toBeCloseTo(150, 0);
  });

  it("pointAtAlong et sliceAlong", () => {
    const route = buildRoute({ id: "r", name: "r", coordinates: MAIN_WEST.coordinates, source: "trail" });
    const p = pointAtAlong(route.coordinates, route.cumulative, 250);
    expect(haversineM(p, offsetPoint(ORIGIN, 250, 90))).toBeLessThan(1);
    const part = sliceAlong(route.coordinates, route.cumulative, 120, 380);
    expect(part.length).toBe(2 + 5);
    expect(haversineM({ lng: part[0][0], lat: part[0][1] }, offsetPoint(ORIGIN, 120, 90))).toBeLessThan(1);
    expect(haversineM({ lng: part[part.length - 1][0], lat: part[part.length - 1][1] }, offsetPoint(ORIGIN, 380, 90))).toBeLessThan(1);
  });

  it("écarts de cap et axe bidirectionnel", () => {
    expect(headingDelta(350, 10)).toBe(20);
    expect(headingDelta(10, 350)).toBe(-20);
    expect(axisDiff(90, 270)).toBe(0);
    expect(axisDiff(0, 90)).toBe(90);
    expect(axisDiff(30, 200)).toBe(10);
  });

  it("simplifie une trace bruitée et teste un polygone", () => {
    const pts = line(ORIGIN, 90, 500, 10).map(([lng, lat], i) => ({ lng: lng + (i % 2 ? 0.000005 : 0), lat }));
    const simple = simplifyPoints(pts, 3);
    expect(simple.length).toBeLessThan(pts.length / 3);
    const ring: LngLat[] = [
      [9.0, 42.0],
      [9.1, 42.0],
      [9.1, 42.1],
      [9.0, 42.1],
      [9.0, 42.0],
    ];
    expect(pointInRing({ lng: 9.05, lat: 42.05 }, ring)).toBe(true);
    expect(pointInRing({ lng: 9.2, lat: 42.05 }, ring)).toBe(false);
  });
});

describe("graphe des chemins", () => {
  const graph = buildPathGraph(NETWORK);
  it("relie les segments par leurs extrémités et détecte l'intersection", () => {
    expect(graph.segments.size).toBe(4);
    expect(areConnected(graph, "main-w", "main-e")).toBe(true);
    expect(areConnected(graph, "main-w", "branch")).toBe(true);
    expect(areConnected(graph, "main-w", "steps")).toBe(false);
    const js = junctionsNear(graph, JUNCTION, 20);
    expect(js).toHaveLength(1);
    expect(js[0].degree).toBe(3);
    expect(junctionsNear(graph, ORIGIN, 20)).toHaveLength(0);
  });
  it("retrouve les segments proches et ignore les doublons", () => {
    const near = segmentsNear(graph, offsetPoint(ORIGIN, 500, 90), 100).map((s) => s.id);
    expect(near).toContain("main-w");
    expect(near).not.toContain("branch");
    expect(addSegments(graph, [MAIN_WEST])).toBe(0);
  });
  it("praticabilité selon l'activité", () => {
    expect(isSegmentAllowed(STEPS, "hiking")).toBe(true);
    expect(isSegmentAllowed(STEPS, "mtb")).toBe(false);
    expect(isSegmentAllowed(STEPS, "equestrian")).toBe(false);
    expect(isSegmentAllowed({ ...MAIN_WEST, status: "closed" }, "hiking")).toBe(false);
  });
});

describe("map matching", () => {
  const graph = buildPathGraph(NETWORK);
  const opts = { activity: "hiking" as const };

  it("rattache une position décalée de 8 m au sentier parallèle (section 3)", () => {
    let state = createMatchState();
    const fixes = walk(ORIGIN, 90, 400, 40, 8);
    let last = null as ReturnType<typeof matchFix>["output"] | null;
    for (const f of fixes) {
      const r = matchFix(state, f, graph, opts);
      state = r.state;
      last = r.output;
    }
    expect(last!.matched).toBe(true);
    expect(last!.segment?.id).toBe("main-w");
    expect(last!.distanceToPathM).toBeCloseTo(8, 0);
    expect(haversineM(last!.position, offsetPoint(ORIGIN, 400, 90))).toBeLessThan(2);
    expect(last!.confidence).toBeGreaterThan(0.6);
    expect(Math.round(last!.heading!)).toBe(90);
    expect(last!.direction).toBe(1);
  });

  it("ne rattache pas une position à 100 m de tout chemin", () => {
    const p = offsetPoint(offsetPoint(ORIGIN, 300, 90), 100, 0);
    const r = matchFix(createMatchState(), fix(p, 0), graph, opts);
    expect(r.output.matched).toBe(false);
    expect(r.output.position).toEqual({ lat: p.lat, lng: p.lng });
    expect(r.output.confidence).toBe(0);
  });

  it("à l'intersection, garde le sentier suivi quand l'utilisateur continue tout droit", () => {
    let state = createMatchState();
    const fixes = walk(offsetPoint(ORIGIN, 700, 90), 90, 600, 30, 5);
    const ids: string[] = [];
    for (const f of fixes) {
      const r = matchFix(state, f, graph, opts);
      state = r.state;
      ids.push(r.output.segment?.id ?? "none");
    }
    expect(ids).not.toContain("branch");
    expect(ids[ids.length - 1]).toBe("main-e");
  });

  it("bascule sur l'embranchement quand l'utilisateur tourne", () => {
    let state = createMatchState();
    const approach = walk(offsetPoint(ORIGIN, 700, 90), 90, 300, 30, 4);
    const turn = walk(JUNCTION, 0, 300, 30, -4, approach[approach.length - 1].at + 5000);
    const ids: string[] = [];
    for (const f of [...approach, ...turn]) {
      const r = matchFix(state, f, graph, opts);
      state = r.state;
      ids.push(r.output.segment?.id ?? "none");
    }
    expect(ids[ids.length - 1]).toBe("branch");
    // Le basculement intervient dans les premiers relevés après le virage.
    const firstBranch = ids.indexOf("branch");
    expect(firstBranch).toBeGreaterThanOrEqual(approach.length);
    expect(firstBranch).toBeLessThanOrEqual(approach.length + 3);
  });

  it("pénalise un chemin impraticable pour l'activité sans l'exclure", () => {
    const p = offsetPoint(offsetPoint(ORIGIN, 560, 180), 3, 90);
    const r = matchFix(createMatchState(), fix(p, 0), graph, { activity: "mtb" });
    expect(r.output.segment?.id).toBe("steps");
    expect(r.output.matched).toBe(true);
  });

  it("qualité GPS et tolérance élargie", () => {
    expect(gpsQuality({ accuracy: 8, at: 0 }, 1000)).toBe("good");
    expect(gpsQuality({ accuracy: 30, at: 0 }, 1000)).toBe("fair");
    expect(gpsQuality({ accuracy: 80, at: 0 }, 1000)).toBe("poor");
    expect(gpsQuality({ accuracy: 8, at: 0 }, 60_000)).toBe("lost");
    const p = offsetPoint(offsetPoint(ORIGIN, 300, 90), 45, 0);
    const good = matchFix(createMatchState(), fix(p, 0, { accuracy: 8 }), graph, opts).output;
    const poor = matchFix(createMatchState(), fix(p, 0, { accuracy: 60 }), graph, opts).output;
    expect(good.matched).toBe(false);
    expect(poor.matched).toBe(true);
    expect(poor.quality).toBe("poor");
  });

  it("avance la position à l'estime entre deux relevés", () => {
    let state = createMatchState();
    let out = null as ReturnType<typeof matchFix>["output"] | null;
    for (const f of walk(ORIGIN, 90, 200, 40, 0)) {
      const r = matchFix(state, f, graph, opts);
      state = r.state;
      out = r.output;
    }
    // Marche simulée à 8 m/s (40 m toutes les 5 s) : 10 s plus tard, ~80 m plus loin sur le chemin.
    const est = deadReckon(out!, out!.at + 10_000);
    const moved = haversineM(out!.position, est);
    expect(moved).toBeGreaterThan(70);
    expect(moved).toBeLessThan(90);
    expect(projectOnPolyline(est, MAIN_WEST.coordinates)!.distanceM).toBeLessThan(1);
    expect(deadReckon(out!, out!.at)).toEqual(out!.position);
  });
});

describe("itinéraire et sortie de parcours", () => {
  const outAndBack = buildRoute({ id: "ab", name: "Aller-retour", coordinates: [...line(ORIGIN, 90, 1000, 100), ...line(offsetPoint(ORIGIN, 1000, 90), 270, 1000, 100).slice(1)], source: "trail" });

  it("calcule la progression et respecte la fenêtre sur un aller-retour", () => {
    expect(outAndBack.lengthM).toBeCloseTo(2000, -1);
    const p = offsetPoint(ORIGIN, 400, 90);
    const outbound = projectOnRoute(outAndBack, p, 350)!;
    expect(outbound.along).toBeCloseTo(400, -1);
    expect(outbound.remainingM).toBeCloseTo(1600, -1);
    const inbound = projectOnRoute(outAndBack, p, 1550)!;
    expect(inbound.along).toBeCloseTo(1600, -1);
    expect(inbound.fraction).toBeCloseTo(0.8, 1);
  });

  it("dénivelés restants à partir des altitudes", () => {
    const coords = line(ORIGIN, 90, 1000, 100);
    const elevations = coords.map((_, i) => 1000 + i * 20);
    const r = buildRoute({ id: "up", name: "Montée", coordinates: coords, elevations, source: "gpx" });
    expect(r.elevationGainM).toBe(200);
    const p = projectOnRoute(r, offsetPoint(ORIGIN, 500, 90), null)!;
    expect(p.gainDoneM).toBe(100);
    expect(p.gainRemainingM).toBe(100);
  });

  it("seuil adaptatif de sortie d'itinéraire", () => {
    expect(offRouteThresholdM({ accuracy: 5, density: 1, widthM: null, quality: "good" })).toBe(30);
    expect(offRouteThresholdM({ accuracy: 30, density: 1, widthM: null, quality: "fair" })).toBe(40);
    expect(offRouteThresholdM({ accuracy: 30, density: 5, widthM: 4, quality: "poor" })).toBe(67);
    expect(offRouteThresholdM({ accuracy: 200, density: 9, widthM: 40, quality: "poor" })).toBe(90);
  });

  it("n'alerte qu'après plusieurs relevés hors seuil et revient avec hystérésis", () => {
    let s = createOffRouteState();
    s = updateOffRoute(s, 45, 30, 0);
    s = updateOffRoute(s, 45, 30, 5000);
    expect(s.offRoute).toBe(false);
    s = updateOffRoute(s, 45, 30, 10_000);
    expect(s.offRoute).toBe(false); // 3 relevés mais 10 s seulement
    s = updateOffRoute(s, 45, 30, 15_000);
    expect(s.offRoute).toBe(true);
    s = updateOffRoute(s, 25, 30, 20_000); // sous le seuil mais pas sous 70 %
    expect(s.offRoute).toBe(true);
    s = updateOffRoute(s, 15, 30, 25_000);
    expect(s.offRoute).toBe(true);
    s = updateOffRoute(s, 15, 30, 30_000);
    expect(s.offRoute).toBe(false);
    // Un seul relevé aberrant ne compte pas.
    s = updateOffRoute(createOffRouteState(), 200, 30, 0);
    s = updateOffRoute(s, 5, 30, 5000);
    expect(s.consecutive).toBe(0);
  });

  it("guide vers le point le plus proche du parcours", () => {
    const p = offsetPoint(offsetPoint(ORIGIN, 400, 90), 120, 0);
    const g = returnGuidance(outAndBack, p, 380)!;
    expect(g.distanceM).toBe(120);
    expect(g.bearing).toBe(180);
  });
});

describe("instructions pas à pas", () => {
  const graph = buildPathGraph(NETWORK);
  // Itinéraire : 1 km vers l'est puis 800 m vers le nord par l'embranchement.
  const routeCoords = [...MAIN_WEST.coordinates, ...BRANCH.coordinates.slice(1)];
  const route = buildRoute({ id: "r1", name: "Vers le lac", coordinates: routeCoords, source: "trail" });

  it("détecte le virage à l'intersection et l'arrivée", () => {
    const ms = computeManeuvers(route, graph);
    const types = ms.map((m) => m.type);
    expect(types[0]).toBe("depart");
    expect(types[types.length - 1]).toBe("arrive");
    const turn = ms.find((m) => m.type === "left");
    expect(turn).toBeDefined();
    expect(turn!.atJunction).toBe(true);
    expect(turn!.along).toBeCloseTo(1000, -1);
    expect(ms.filter((m) => m.type !== "depart" && m.type !== "arrive")).toHaveLength(1);
  });

  it("formule les consignes selon la distance", () => {
    const ms = computeManeuvers(route, graph);
    expect(currentInstruction(ms, 300)!.text).toBe("Continuez sur ce sentier pendant 700 m");
    expect(currentInstruction(ms, 920)!.text).toBe("Tournez à gauche dans 80 m");
    expect(currentInstruction(ms, 990)!.text).toBe("Prenez le sentier à gauche");
    expect(currentInstruction(ms, 1650)!.text).toBe("Arrivée dans 150 m");
    expect(currentInstruction(ms, 1795)!.text).toBe("Vous êtes arrivé.");
    const turn = ms.find((m) => m.type === "left")!;
    expect(maneuverText({ ...turn, atJunction: false }, 60)).toBe("Le sentier tourne à gauche dans 60 m");
    expect(maneuverText({ ...turn, type: "sharp_right" }, 10)).toBe("Tournez franchement à droite");
  });

  it("signale « tout droit » à une intersection traversée", () => {
    const straight = buildRoute({ id: "r2", name: "Tout droit", coordinates: [...MAIN_WEST.coordinates, ...MAIN_EAST.coordinates.slice(1)], source: "trail" });
    const ms = computeManeuvers(straight, graph);
    const j = ms.find((m) => m.type === "straight");
    expect(j?.atJunction).toBe(true);
    expect(currentInstruction(ms, 980)!.text).toBe("Continuez tout droit à l'intersection");
    // Sans graphe, une ligne droite n'a aucune manœuvre intermédiaire.
    expect(computeManeuvers(straight, null).map((m) => m.type)).toEqual(["depart", "arrive"]);
  });
});

function report(id: string, p: { lat: number; lng: number }, subtype: Report["subtype"], category: Report["category"], extra: Partial<Report> = {}): Report {
  return {
    id,
    userId: null,
    authorPseudo: null,
    category,
    subtype,
    lat: p.lat,
    lng: p.lng,
    blurred: false,
    dangerLevel: null,
    description: null,
    photoUrl: null,
    photos: [],
    source: "community",
    status: "active",
    zone: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    startsAt: null,
    endsAt: null,
    confirmationsCount: 0,
    disputesCount: 0,
    resolvedVotesCount: 0,
    lastConfirmationAt: null,
    confidenceScore: 50,
    confidenceLabel: "probable",
    fade: 1,
    ...extra,
  };
}

describe("événements et alertes", () => {
  const route = buildRoute({ id: "r", name: "r", coordinates: [...MAIN_WEST.coordinates, ...MAIN_EAST.coordinates.slice(1)], source: "trail" });
  const tree = report("tree", offsetPoint(offsetPoint(ORIGIN, 1300, 90), 10, 0), "fallen_tree", "danger");
  const battue = report("battue", offsetPoint(ORIGIN, 1800, 90), "battue", "activity");
  const far = report("far", offsetPoint(offsetPoint(ORIGIN, 600, 90), 300, 0), "herd", "animals");
  const water: WaterPoint = { id: "w1", name: "Source de Grotelle", type: "spring", lat: offsetPoint(ORIGIN, 700, 90).lat, lng: offsetPoint(ORIGIN, 700, 90).lng, lastState: "active", lastStateAt: null, elevation: null };

  it("projette sur l'itinéraire les événements du couloir uniquement", () => {
    const events = collectRouteEvents(route, { reports: [tree, battue, far], waterPoints: [water] });
    expect(events.map((e) => e.key)).toEqual(["water:w1", "report:tree", "report:battue"]);
    expect(events[1].along).toBeCloseTo(1300, -1);
    expect(events[1].severity).toBe("high");
    expect(events[0].severity).toBe("low");
  });

  it("ignore ce qui est derrière et monte les paliers en approchant (sections 12 et 13)", () => {
    const events = collectRouteEvents(route, { reports: [tree] });
    const announced = new Map<string, number>();
    expect(computeAheadAlerts(events, 200, announced)).toHaveLength(0); // 1 100 m : rien
    const l1 = computeAheadAlerts(events, 400, announced); // 900 m : info discrète
    expect(l1).toHaveLength(1);
    expect(l1[0].level).toBe(1);
    expect(l1[0].tone).toBe("info");
    expect(l1[0].sound).toBe(false);
    expect(l1[0].message).toBe("Arbre tombé à 900 m devant vous");
    announced.set(l1[0].key, l1[0].level);
    expect(computeAheadAlerts(events, 500, announced)).toHaveLength(0); // même palier
    const l2 = computeAheadAlerts(events, 850, announced); // 450 m
    expect(l2[0].level).toBe(2);
    expect(l2[0].message).toBe("Attention : Arbre tombé dans 450 m");
    expect(l2[0].sound).toBe(true);
    announced.set(l2[0].key, 2);
    const l4 = computeAheadAlerts(events, 1270, announced); // 30 m : immédiat (saute le palier 3)
    expect(l4[0].level).toBe(4);
    expect(l4[0].tone).toBe("danger");
    expect(l4[0].message).toBe("Arbre tombé à proximité immédiate");
    announced.set(l4[0].key, 4);
    expect(computeAheadAlerts(events, 1400, announced)).toHaveLength(0); // dépassé
    // Derrière soi dès le départ : jamais annoncé.
    expect(computeAheadAlerts(events, 1400, new Map())).toHaveLength(0);
  });

  it("annonce une battue plus tôt et une source sans alerte sonore", () => {
    const events = collectRouteEvents(route, { reports: [battue], waterPoints: [water] });
    const a = computeAheadAlerts(events, 400, new Map());
    expect(a.map((x) => x.key)).toEqual(["water:w1", "report:battue"]);
    expect(a[1].distanceM).toBe(1400);
    expect(a[1].message).toBe("Battue à 1,4 km devant vous");
    expect(a[0].sound).toBe(false);
    expect(a[0].message).toBe("Source de Grotelle dans 300 m");
  });

  it("mode libre : cône devant soi et proximité immédiate", () => {
    const pos = offsetPoint(ORIGIN, 500, 90);
    const ahead = report("a", offsetPoint(pos, 300, 80), "rockfall", "danger");
    const behind = report("b", offsetPoint(pos, 300, 270), "rockfall", "danger");
    const close = report("c", offsetPoint(pos, 30, 270), "obstacle", "path");
    const events = collectFreeEvents(pos, 90, { reports: [ahead, behind, close] });
    expect(events.map((e) => e.key)).toEqual(["report:c", "report:a"]);
    // Sans cap : seulement la proximité.
    expect(collectFreeEvents(pos, null, { reports: [ahead, behind, close] }).map((e) => e.key)).toEqual(["report:c"]);
  });

  it("alerte officielle : entrée dans le polygone", () => {
    const c = offsetPoint(ORIGIN, 1500, 90);
    const ring: LngLat[] = [
      [c.lng - 0.002, c.lat - 0.002],
      [c.lng + 0.002, c.lat - 0.002],
      [c.lng + 0.002, c.lat + 0.002],
      [c.lng - 0.002, c.lat + 0.002],
      [c.lng - 0.002, c.lat - 0.002],
    ];
    const alert: OfficialAlert = { id: "oa", organisation: "ONF", title: "Battue administrative", body: "", category: "activity", severity: "high", geometry: { type: "Polygon", coordinates: [ring] }, centroidLat: c.lat, centroidLng: c.lng, startsAt: new Date(0).toISOString(), endsAt: null, url: null, createdAt: new Date(0).toISOString() };
    const events = collectRouteEvents(route, { officialAlerts: [alert] });
    expect(events).toHaveLength(1);
    expect(events[0].along).toBeLessThan(1400);
    expect(events[0].along).toBeGreaterThan(1250);
    const a = computeAheadAlerts(events, 200, new Map());
    expect(a[0].message).toMatch(/^Alerte officielle : Battue administrative dans 1,/);
  });
});

describe("trace, GPX et ETA", () => {
  it("filtre les relevés et calcule les statistiques", () => {
    expect(acceptTrackPoint(null, fix(ORIGIN, 0))).toBe(true);
    const last: TrackPoint = { lat: ORIGIN.lat, lng: ORIGIN.lng, alt: null, at: 0, accuracy: 10 };
    expect(acceptTrackPoint(last, fix(offsetPoint(ORIGIN, 2, 90), 3000))).toBe(false);
    expect(acceptTrackPoint(last, fix(offsetPoint(ORIGIN, 6, 90), 3000))).toBe(true);
    expect(acceptTrackPoint(last, fix(ORIGIN, 40_000))).toBe(true);
    expect(acceptTrackPoint(last, fix(offsetPoint(ORIGIN, 50, 90), 3000, { accuracy: 90 }))).toBe(false);

    const pts: TrackPoint[] = line(ORIGIN, 90, 1000, 100).map(([lng, lat], i) => ({ lat, lng, alt: 1000 + (i < 5 ? i * 20 : 80 - (i - 4) * 10 + (i % 2 ? 3 : 0)), at: i * 60_000, accuracy: 8 }));
    const s = trackStats(pts);
    expect(s.distanceM).toBeCloseTo(1000, -1);
    expect(s.durationMs).toBe(600_000);
    expect(s.gainM).toBe(80);
    expect(s.lossM).toBeGreaterThanOrEqual(50);
    expect(s.maxAltM).toBe(1080);
    expect(s.avgSpeedMs).toBeCloseTo(1000 / 600, 1);
    expect(s.points).toBe(11);
  });

  it("construit l'itinéraire de retour par la trace inversée", () => {
    const pts: TrackPoint[] = line(ORIGIN, 90, 500, 50).map(([lng, lat], i) => ({ lat, lng, alt: null, at: i * 1000, accuracy: 5 }));
    const back = backtrackRoute(pts);
    expect(back.coordinates[0]).toEqual([pts[pts.length - 1].lng, pts[pts.length - 1].lat]);
    expect(back.lengthM).toBeCloseTo(500, -1);
    expect(back.source).toBe("track");
  });

  it("analyse et exporte un GPX", () => {
    const xml = `<?xml version="1.0"?><gpx version="1.1" creator="test"><metadata><name>Meta</name></metadata>
      <wpt lat="42.1" lon="9.1"><name>Refuge &amp; source</name><ele>1500</ele></wpt>
      <trk><name>Boucle de Melo</name><trkseg>
        <trkpt lat="42.2261" lon="9.0453"><ele>1375</ele><time>2026-06-01T08:00:00Z</time></trkpt>
        <trkpt lat="42.2236" lon="9.0412"><ele>1500.5</ele></trkpt>
        <trkpt lat="42.2203" lon="9.0355" />
      </trkseg></trk></gpx>`;
    const parsed = parseGpx(xml)!;
    expect(parsed.name).toBe("Boucle de Melo");
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points[0].ele).toBe(1375);
    expect(parsed.points[0].time).toBe(Date.parse("2026-06-01T08:00:00Z"));
    expect(parsed.points[2].ele).toBeNull();
    expect(parsed.waypoints[0].name).toBe("Refuge & source");
    const route = routeFromGpx(xml, "g1")!;
    expect(route.source).toBe("gpx");
    expect(route.lengthM).toBeGreaterThan(900);
    expect(route.elevations?.[1]).toBe(1500.5);
    expect(parseGpx("<html></html>")).toBeNull();
    expect(routeFromGpx('<gpx version="1.1"><rte><rtept lat="1" lon="1"/></rte></gpx>', "x")).toBeNull();

    const out = buildGpx({ name: "Ma <trace>", points: [{ lat: 42.1, lng: 9.1, alt: 1200, at: 0, accuracy: 5 }, { lat: 42.2, lng: 9.2, alt: null, at: 60_000, accuracy: 5 }] });
    expect(out).toContain('<trkpt lat="42.100000" lon="9.100000"><ele>1200.0</ele><time>1970-01-01T00:00:00.000Z</time></trkpt>');
    expect(out).toContain("<name>Ma &lt;trace&gt;</name>");
    const round = parseGpx(out)!;
    expect(round.name).toBe("Ma <trace>");
    expect(round.points).toHaveLength(2);
  });

  it("estime la durée restante", () => {
    const flat = estimateEta({ remainingM: 4000, gainRemainingM: 0, activity: "hiking", observedSpeedMs: null, now: 0 });
    expect(Math.round(flat.remainingMs / 60_000)).toBe(60);
    const climb = estimateEta({ remainingM: 4000, gainRemainingM: 600, activity: "hiking", observedSpeedMs: null, now: 0 });
    expect(Math.round(climb.remainingMs / 60_000)).toBe(120);
    const fast = estimateEta({ remainingM: 4000, gainRemainingM: 0, activity: "hiking", observedSpeedMs: 2, now: 0 });
    expect(fast.remainingMs).toBeLessThan(flat.remainingMs);
    expect(formatDurationShort(45 * 60_000)).toBe("45 min");
    expect(formatDurationShort(85 * 60_000)).toBe("1 h 25");
    expect(formatDurationShort(180 * 60_000)).toBe("3 h");
  });
});

describe("boucle de navigation", () => {
  const graph = buildPathGraph(NETWORK);
  const route = buildRoute({ id: "r", name: "Vers le lac", coordinates: [...MAIN_WEST.coordinates, ...BRANCH.coordinates.slice(1)], source: "trail" });
  const tree = report("tree", offsetPoint(ORIGIN, 600, 90), "fallen_tree", "danger");

  function context(): NavContext {
    return { graph, activity: "hiking", route, maneuvers: computeManeuvers(route, graph), events: collectRouteEvents(route, { reports: [tree] }) };
  }

  it("suit un parcours complet : instruction, alertes, virage, arrivée", () => {
    const ctx = context();
    let state = createNavState();
    const fixes = [...walk(ORIGIN, 90, 1000, 25, 5), ...walk(JUNCTION, 0, 800, 25, -5, 41 * 5000)];
    const announcements: string[] = [];
    const alerts: string[] = [];
    let arrivedAt = -1;
    let offRouteEvents = 0;
    fixes.forEach((f, i) => {
      const step = navigationStep(state, ctx, f);
      state = step.state;
      if (step.announceInstruction && step.instruction) announcements.push(step.instruction.text);
      for (const a of step.alerts) alerts.push(a.message);
      if (step.justArrived) arrivedAt = i;
      if (step.offRouteChange) offRouteEvents++;
    });
    expect(offRouteEvents).toBe(0);
    expect(alerts).toEqual(["Arbre tombé à 600 m devant vous", "Attention : Arbre tombé dans 500 m", "Attention : Arbre tombé dans 200 m", "Arbre tombé à proximité immédiate"]);
    expect(announcements[0]).toMatch(/^Continuez sur ce sentier pendant/);
    expect(announcements).toContain("Tournez à gauche dans 80 m");
    expect(announcements).toContain("Prenez le sentier à gauche");
    expect(announcements[announcements.length - 1]).toBe("Vous êtes arrivé.");
    expect(arrivedAt).toBe(fixes.length - 1);
    expect(state.track.length).toBeGreaterThan(60);
    expect(state.progress?.remainingM).toBeLessThan(5);
    expect(state.movingSpeedMs).toBeGreaterThan(1);
  });

  it("détecte la sortie d'itinéraire puis le retour", () => {
    const ctx = context();
    let state = createNavState();
    const on = walk(ORIGIN, 90, 300, 25, 3);
    const off = walk(offsetPoint(ORIGIN, 300, 90), 45, 250, 25, 0, 13 * 5000);
    const back = walk(offsetPoint(offsetPoint(ORIGIN, 300, 90), 250, 45), 225, 250, 25, 0, 24 * 5000);
    const changes: string[] = [];
    for (const f of [...on, ...off, ...back]) {
      const step = navigationStep(state, ctx, f);
      state = step.state;
      if (step.offRouteChange) changes.push(step.offRouteChange);
    }
    expect(changes).toEqual(["left", "back"]);
  });

  it("mode libre : événements dans le cône de déplacement", () => {
    const ctx: NavContext = { graph, activity: "trail", route: null, maneuvers: [], events: [], reports: [tree] };
    let state = createNavState();
    const msgs: string[] = [];
    for (const f of walk(ORIGIN, 90, 650, 25, 0)) {
      const step = navigationStep(state, ctx, f);
      state = step.state;
      for (const a of step.alerts) msgs.push(a.message);
      expect(step.progress).toBeNull();
    }
    expect(msgs[0]).toMatch(/^Arbre tombé à .* devant vous$/);
    expect(msgs[msgs.length - 1]).toBe("Arbre tombé à proximité immédiate");
  });
});
