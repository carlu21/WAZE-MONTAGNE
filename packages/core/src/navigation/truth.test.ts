import { describe, expect, it } from "vitest";
import { offsetPoint } from "../geo";
import {
  DIRECTION_INDICATOR_M,
  SCHEMATIC_MEAN_SPACING_M,
  TRACE_BREAK_DISTANCE_M,
  TRAIL_MIN_CONSECUTIVE,
  canJudgeTrail,
  directionIndicator,
  drawableTraceSegments,
  geometryFidelity,
  isSurveyed,
  positionTrust,
  routeVerdict,
  splitTrace,
  trailVerdict,
} from "./truth";
import type { LngLat } from "../geo";
import type { TrackPoint } from "./types";

const ORIGIN = { lat: 42.2261, lng: 9.0453 };

/** Polyligne d'un sommet tous les `stepM` mètres, en tournant un peu (un vrai sentier tourne). */
function line(stepM: number, count: number): LngLat[] {
  const out: LngLat[] = [[ORIGIN.lng, ORIGIN.lat]];
  let p = ORIGIN;
  for (let i = 1; i < count; i++) {
    p = offsetPoint(p, stepM, 90 + (i % 2 === 0 ? 12 : -12));
    out.push([p.lng, p.lat]);
  }
  return out;
}

function track(points: { d: number; dtMs: number }[]): TrackPoint[] {
  let p = ORIGIN;
  let at = 1_700_000_000_000;
  const out: TrackPoint[] = [{ lat: p.lat, lng: p.lng, alt: null, at, accuracy: 8 }];
  for (const step of points) {
    p = offsetPoint(p, step.d, 90);
    at += step.dtMs;
    out.push({ lat: p.lat, lng: p.lng, alt: null, at, accuracy: 8 });
  }
  return out;
}

describe("fidélité géométrique", () => {
  it("accepte une polyligne relevée finement", () => {
    const f = geometryFidelity(line(20, 60));
    expect(f.level).toBe("detailed");
    expect(f.meanSpacingM).toBeLessThan(SCHEMATIC_MEAN_SPACING_M);
    expect(f.reason).toBeNull();
  });

  it("refuse une suite de points de passage espacés de kilomètres", () => {
    // Le GR20 du jeu de démonstration : 11 sommets pour 96 km.
    const f = geometryFidelity(line(9000, 11));
    expect(f.level).toBe("schematic");
    expect(f.reason).toBe("mean_spacing");
  });

  it("refuse une géométrie percée d'un seul bond trop long", () => {
    const pts = line(30, 20);
    const far = offsetPoint({ lng: pts[19][0], lat: pts[19][1] }, 900, 90);
    const f = geometryFidelity([...pts, [far.lng, far.lat]]);
    expect(f.level).toBe("schematic");
    expect(f.reason).toBe("max_gap");
  });

  it("refuse une ligne bien plus courte que la longueur annoncée (raccourci à vol d'oiseau)", () => {
    const f = geometryFidelity(line(20, 60), 5600);
    expect(f.level).toBe("schematic");
    expect(f.reason).toBe("shorter_than_declared");
  });

  it("ne voit aucune géométrie dans moins de deux points", () => {
    expect(geometryFidelity([[9, 42]]).level).toBe("empty");
    expect(geometryFidelity(null).level).toBe("empty");
  });
});

describe("droit de tracer un itinéraire", () => {
  it("accepte une géométrie relevée et détaillée", () => {
    const v = routeVerdict({ coordinates: line(20, 60), source: "osm" });
    expect(v.drawable).toBe(true);
    expect(v.refusal).toBeNull();
  });

  it("refuse une géométrie de démonstration, même densifiée", () => {
    // La densification interpole des points SUR une ligne droite : elle rend la
    // ligne jolie, elle ne la rend pas vraie.
    const v = routeVerdict({ coordinates: line(25, 200), source: "seed" });
    expect(v.drawable).toBe(false);
    expect(v.refusal).toBe("not_surveyed");
  });

  it("refuse une géométrie schématique même relevée", () => {
    const v = routeVerdict({ coordinates: line(9000, 11), source: "osm" });
    expect(v.drawable).toBe(false);
    expect(v.refusal).toBe("schematic_geometry");
  });

  it("distingue « rien à tracer » de « aucun chemin connu dans le secteur »", () => {
    expect(routeVerdict({ coordinates: [], source: "osm" }).refusal).toBe("no_geometry");
    expect(routeVerdict({ coordinates: [], source: "osm", networkSegments: 0 }).refusal).toBe("no_network");
  });

  it("refuse une géométrie de provenance inconnue", () => {
    expect(routeVerdict({ coordinates: line(20, 60), source: null }).refusal).toBe("not_surveyed");
    expect(isSurveyed("local")).toBe(false);
    expect(isSurveyed("ign")).toBe(true);
  });
});

describe("direction indicative", () => {
  it("s'arrête à la longueur bornée, quelle que soit la distance à la cible", () => {
    const target = offsetPoint(ORIGIN, 4000, 90);
    const d = directionIndicator(ORIGIN, target);
    expect(d.coordinates).toHaveLength(2);
    expect(d.distanceM).toBe(4000);
    const drawn = geometryFidelity(d.coordinates);
    expect(drawn.lengthM).toBeLessThanOrEqual(DIRECTION_INDICATOR_M + 1);
    expect(d.bearing).toBe(90);
  });

  it("ne dépasse pas la cible quand elle est proche", () => {
    const target = offsetPoint(ORIGIN, 30, 180);
    const d = directionIndicator(ORIGIN, target);
    expect(geometryFidelity(d.coordinates).lengthM).toBeLessThanOrEqual(31);
  });
});

describe("confiance dans la position", () => {
  it("n'affiche rien sans relevé", () => {
    expect(positionTrust(null)).toBe("unavailable");
    expect(positionTrust({ accuracy: 5, quality: "good", fixes: 0 })).toBe("unavailable");
  });

  it("reste en acquisition quand le signal est perdu, cherché ou trop imprécis", () => {
    expect(positionTrust({ accuracy: 5, quality: "good", fixes: 9, searching: true })).toBe("acquiring");
    expect(positionTrust({ accuracy: 5, quality: "lost", fixes: 9 })).toBe("acquiring");
    expect(positionTrust({ accuracy: 120, quality: "fair", fixes: 9 })).toBe("acquiring");
  });

  it("ne confond pas précision inconnue et bonne précision", () => {
    expect(positionTrust({ accuracy: null, quality: "good", fixes: 9 })).toBe("coarse");
  });

  it("affiche un premier relevé précis sans prétendre pouvoir en juger", () => {
    // Une position à 5 m est une position : on l'affiche. Ce qui manque, c'est
    // l'historique — donc « approximative », jamais « fiable ».
    expect(positionTrust({ accuracy: 5, quality: "good", fixes: 1 })).toBe("coarse");
    expect(positionTrust({ accuracy: 5, quality: "good", fixes: 2 })).toBe("coarse");
    expect(positionTrust({ accuracy: 5, quality: "good", fixes: 3 })).toBe("reliable");
  });

  it("n'accorde « fiable » qu'à une position précise et stable", () => {
    expect(positionTrust({ accuracy: 40, quality: "fair", fixes: 9 })).toBe("coarse");
    expect(positionTrust({ accuracy: 8, quality: "poor", fixes: 9 })).toBe("coarse");
    expect(positionTrust({ accuracy: 8, quality: "good", fixes: 9 })).toBe("reliable");
  });
});

describe("verdict sur le sentier", () => {
  const base = { matchAttempted: true, matched: false, confidence: 0, distanceToPathM: 200, consecutiveOff: 10, networkSegments: 40 } as const;

  it("exige les trois conditions préalables avant tout jugement", () => {
    expect(canJudgeTrail({ trust: "coarse", networkSegments: 40, matchAttempted: true })).toBe(false);
    expect(canJudgeTrail({ trust: "reliable", networkSegments: 0, matchAttempted: true })).toBe(false);
    expect(canJudgeTrail({ trust: "reliable", networkSegments: 40, matchAttempted: false })).toBe(false);
    expect(canJudgeTrail({ trust: "reliable", networkSegments: 40, matchAttempted: true })).toBe(true);
  });

  it("ne dit JAMAIS « hors sentier » avec un GPS incertain", () => {
    expect(trailVerdict({ ...base, trust: "acquiring" })).toBe("unknown");
    expect(trailVerdict({ ...base, trust: "coarse" })).toBe("unknown");
    expect(trailVerdict({ ...base, trust: "unavailable" })).toBe("unknown");
  });

  it("ne dit rien tant que le réseau n'est pas chargé", () => {
    expect(trailVerdict({ ...base, trust: "reliable", networkSegments: 0 })).toBe("unknown");
  });

  it("tolère quelques mètres d'écart sans rien annoncer", () => {
    expect(trailVerdict({ ...base, trust: "reliable", distanceToPathM: 12, consecutiveOff: 0 })).toBe("uncertain");
  });

  it("exige plusieurs mesures successives au-delà du seuil", () => {
    const off = { ...base, trust: "reliable" as const, distanceToPathM: 140 };
    expect(trailVerdict({ ...off, consecutiveOff: TRAIL_MIN_CONSECUTIVE - 1 })).toBe("uncertain");
    expect(trailVerdict({ ...off, consecutiveOff: TRAIL_MIN_CONSECUTIVE })).toBe("off_trail");
  });

  it("nomme le chemin quand le rattachement est franc", () => {
    expect(trailVerdict({ ...base, trust: "reliable", matched: true, confidence: 0.8, distanceToPathM: 4 })).toBe("on_trail");
    expect(trailVerdict({ ...base, trust: "reliable", matched: true, confidence: 0.1, distanceToPathM: 4 })).toBe("uncertain");
  });
});

describe("découpage de la trace brute", () => {
  it("garde un seul tronçon quand la marche est continue", () => {
    const t = track(Array.from({ length: 20 }, () => ({ d: 6, dtMs: 5000 })));
    const s = splitTrace(t);
    expect(s.segments).toHaveLength(1);
    expect(s.breaks).toHaveLength(0);
  });

  it("interrompt la trace sur un bond invraisemblable plutôt que de la rafistoler", () => {
    const t = track([{ d: 6, dtMs: 5000 }, { d: 6, dtMs: 5000 }, { d: TRACE_BREAK_DISTANCE_M + 200, dtMs: 6000 }, { d: 6, dtMs: 5000 }]);
    const s = splitTrace(t);
    expect(s.segments).toHaveLength(2);
    expect(s.breaks[0].reason).toBe("distance");
    expect(s.segments[0]).toHaveLength(3);
    expect(s.segments[1]).toHaveLength(2);
  });

  it("interrompt après un long silence (veille, tunnel)", () => {
    const t = track([{ d: 6, dtMs: 5000 }, { d: 50, dtMs: 20 * 60_000 }, { d: 6, dtMs: 5000 }]);
    const s = splitTrace(t);
    expect(s.breaks.map((b) => b.reason)).toEqual(["gap"]);
  });

  it("interrompt sur une vitesse impossible à pied", () => {
    const t = track([{ d: 6, dtMs: 5000 }, { d: 300, dtMs: 4000 }, { d: 6, dtMs: 5000 }]);
    const s = splitTrace(t);
    expect(s.breaks.map((b) => b.reason)).toEqual(["speed"]);
  });

  it("ne dessine pas un tronçon d'un seul point", () => {
    const t = track([{ d: 6, dtMs: 5000 }, { d: TRACE_BREAK_DISTANCE_M + 200, dtMs: 6000 }]);
    expect(drawableTraceSegments(t)).toHaveLength(1);
  });

  it("supporte une trace vide", () => {
    expect(splitTrace([]).segments).toHaveLength(0);
    expect(drawableTraceSegments([])).toHaveLength(0);
  });
});
