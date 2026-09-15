import { describe, expect, it } from "vitest";
import { buildRoute, haversineM, projectOnPolyline, type LngLat } from "@mountain-live/core";
import { cellBBox, cellKey, cellsAlongRoute, cellsAround } from "./network";
import { SimulationSource } from "./sources";
import { headingFromEvent } from "./compass";
import { accuracyLabel, qualityLabel, trailLabel } from "./format";
import { gpxFileName, trackName } from "./tracks";
import { routeBBox } from "./data";
import { EMPTY_LIVE, useNavigationStore } from "./store";

const LINE: LngLat[] = [
  [9.0453, 42.2261],
  [9.0412, 42.2236],
  [9.0355, 42.2203],
  [9.0305, 42.2168],
];
const route = buildRoute({ id: "r", name: "Restonica", coordinates: LINE, source: "trail" });

describe("cellules du réseau", () => {
  it("indexe par cellule de 0,05° et couvre le rayon demandé", () => {
    expect(cellKey(9.0453, 42.2261)).toBe("180:844");
    const b = cellBBox("180:844");
    expect(b.west).toBeCloseTo(9.0, 5);
    expect(b.north).toBeCloseTo(42.25, 5);
    const cells = cellsAround({ lat: 42.2261, lng: 9.0453 }, 2500);
    expect(cells).toContain("180:844");
    expect(cells.length).toBeGreaterThanOrEqual(2);
    expect(cellsAlongRoute(route).length).toBeGreaterThanOrEqual(1);
    expect(routeBBox(LINE).west).toBeLessThan(9.03);
  });
});

describe("simulation GPS", () => {
  it("rejoue l'itinéraire avec un bruit borné et s'arrête à l'arrivée", () => {
    let t = 0;
    const src = new SimulationSource(route, { speedMs: 100, intervalMs: 1000, noiseM: 5, random: () => 0.5, now: () => (t += 1000) });
    const fixes = [];
    while (!src.finished) fixes.push(src.next());
    fixes.push(src.next());
    expect(fixes.length).toBeGreaterThan(route.lengthM / 100);
    for (const f of fixes) {
      expect(projectOnPolyline(f, LINE)!.distanceM).toBeLessThan(6);
      expect(f.accuracy).toBeGreaterThanOrEqual(9);
      expect(f.speed).toBe(100);
    }
    const last = fixes[fixes.length - 1];
    expect(haversineM(last, { lng: LINE[3][0], lat: LINE[3][1] })).toBeLessThan(6);
    expect(fixes[1].at - fixes[0].at).toBe(1000);
  });

  it("applique un écart volontaire entre deux abscisses", () => {
    const src = new SimulationSource(route, { speedMs: 50, intervalMs: 1000, noiseM: 0, random: () => 0.5, detour: { fromAlong: 200, toAlong: 400, offsetM: 60 } });
    const fixes = [];
    while (!src.finished) fixes.push(src.next());
    const far = fixes.filter((f) => projectOnPolyline(f, LINE)!.distanceM > 40);
    expect(far.length).toBeGreaterThanOrEqual(3);
    expect(far.length).toBeLessThan(fixes.length / 2);
  });
});

describe("boussole et formats", () => {
  it("lit le cap absolu (Android) ou webkitCompassHeading (iOS)", () => {
    expect(headingFromEvent({ alpha: 90, absolute: true } as never)).toBe(270);
    expect(headingFromEvent({ alpha: 90, absolute: false } as never)).toBeNull();
    expect(headingFromEvent({ alpha: null, webkitCompassHeading: 45 } as never)).toBe(45);
  });
  it("ne dit JAMAIS « Hors sentier » avant d'avoir une position fiable", () => {
    // Aucun relevé, aucun réseau : la seule phrase permise est l'attente.
    expect(trailLabel({ output: null, trust: "unavailable", networkSegments: 0, consecutiveOffTrail: 0 })).toBe("Position en cours d'acquisition");
    expect(trailLabel({ output: null, trust: "acquiring", networkSegments: 40, consecutiveOffTrail: 99 })).toBe("Position en cours d'acquisition");
    // Position fiable mais réseau absent : on n'affiche rien plutôt que d'accuser.
    expect(trailLabel({ output: null, trust: "reliable", networkSegments: 0, consecutiveOffTrail: 99 })).toBeNull();
  });

  it("décrit la qualité GPS et la précision, sans promettre de certitude", () => {
    expect(accuracyLabel(6)).toBe("GPS ± 6 m");
    expect(accuracyLabel(null)).toBe("GPS");
    expect(qualityLabel("poor", 60)).toBe("Signal GPS faible");
    expect(qualityLabel("lost", null)).toBe("Signal GPS perdu");
    expect(qualityLabel("good", 8)).toBe("Précision ±8 m");
    expect(gpxFileName("Boucle du Lac de Melo — été")).toBe("boucle-du-lac-de-melo-ete.gpx");
    expect(trackName("mtb", new Date(2026, 5, 1, 9, 5))).toMatch(/^VTT du 01\/06\/2026 à 09:05$/);
  });
});

describe("store de navigation", () => {
  it("gère démarrage, pause, changement d'itinéraire et fin", () => {
    const s = useNavigationStore.getState();
    s.start({ mode: "route", route, originalRoute: null, simulate: true });
    expect(useNavigationStore.getState().status).toBe("running");
    expect(useNavigationStore.getState().live).toEqual(EMPTY_LIVE);
    s.pause();
    expect(useNavigationStore.getState().status).toBe("paused");
    s.resume();
    s.setLive({ offRoute: true, offRouteDistanceM: 80 });
    s.switchRoute(null, "free");
    expect(useNavigationStore.getState().session?.mode).toBe("free");
    expect(useNavigationStore.getState().live.offRoute).toBe(false);
    s.finish([]);
    expect(useNavigationStore.getState().status).toBe("finished");
    s.reset();
    expect(useNavigationStore.getState().session).toBeNull();
  });
});
