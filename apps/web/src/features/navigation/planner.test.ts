import { describe, expect, it } from "vitest";
import { fr, type RouteOption, type RoutePlanResponse } from "@mountain-live/core";
import { offsetPoint } from "@mountain-live/core";
import { interpretPlan, planSource, refusalMessage } from "./planner";

const FROM = { lat: 42.2261, lng: 9.0453 };
const TO = { lat: 42.2117, lng: 9.0183 };
const REQUEST = { from: FROM, to: TO, activity: "hiking" as const, name: "Lac de Melo" };

/** Polyligne fine et sinueuse : ce à quoi ressemble un vrai chemin relevé. */
function realPath(points = 80, stepM = 20): [number, number][] {
  const out: [number, number][] = [[FROM.lng, FROM.lat]];
  let p = FROM;
  for (let i = 1; i < points; i++) {
    p = offsetPoint(p, stepM, 240 + (i % 2 === 0 ? 15 : -15));
    out.push([p.lng, p.lat]);
  }
  return out;
}

function option(over: Partial<RouteOption> = {}): RouteOption {
  return {
    criterion: "recommended",
    legs: [],
    coordinates: realPath(),
    sources: ["osm"],
    distanceM: 1580,
    durationMs: 1_800_000,
    elevationGainM: 210,
    elevationLossM: 30,
    passages30d: 12,
    popularityScore: 40,
    difficulty: 0.4,
    observedWeight: 0.5,
    timeConfidence: "high",
    ...over,
  };
}

function response(over: Partial<RoutePlanResponse> = {}): RoutePlanResponse {
  return { options: [option()], unreachable: false, note: null, ...over };
}

describe("itinéraire sur le réseau réel", () => {
  it("accepte un itinéraire relevé et détaillé", () => {
    const r = interpretPlan(response(), REQUEST);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.route.coordinates.length).toBeGreaterThan(50);
    expect(r.route.name).toBe("Lac de Melo");
  });

  it("refuse — sans dessiner quoi que ce soit — quand aucun chemin ne relie les deux points", () => {
    const r = interpretPlan(response({ options: [], unreachable: true, note: null }), REQUEST);
    expect(r.status).toBe("refused");
    if (r.status !== "refused") return;
    expect(r.refusal).toBe("unreachable");
    expect(r.message).toBe(fr.navigation.unavailable.noRoute);
    expect(r.message).toContain("Aucun itinéraire pédestre fiable");
  });

  it("refuse quand aucun chemin n'est connu dans le secteur", () => {
    const r = interpretPlan(response({ options: [], unreachable: false, note: null }), REQUEST);
    expect(r.status === "refused" && r.refusal).toBe("no_network");
  });

  it("refuse un itinéraire calculé sur des segments de démonstration", () => {
    const r = interpretPlan(response({ options: [option({ sources: ["seed"] })] }), REQUEST);
    expect(r.status === "refused" && r.refusal).toBe("not_surveyed");
  });

  it("refuse dès qu'UN SEUL maillon n'est pas relevé", () => {
    expect(planSource(["osm", "seed"])).toBe("seed");
    const r = interpretPlan(response({ options: [option({ sources: ["osm", "seed"] })] }), REQUEST);
    expect(r.status === "refused" && r.refusal).toBe("not_surveyed");
  });

  it("refuse une suite de points de passage, même annoncée comme itinéraire", () => {
    // Deux points distants de 2 km : exactement la ligne droite que l'on bannit.
    const straight: [number, number][] = [[FROM.lng, FROM.lat], [TO.lng, TO.lat]];
    const r = interpretPlan(response({ options: [option({ coordinates: straight })] }), REQUEST);
    expect(r.status === "refused" && r.refusal).toBe("schematic_geometry");
  });

  it("donne une phrase explicative pour chaque refus", () => {
    for (const refusal of ["no_geometry", "schematic_geometry", "not_surveyed", "no_network", "unreachable"] as const) {
      expect(refusalMessage(refusal).length).toBeGreaterThan(10);
    }
  });
});
