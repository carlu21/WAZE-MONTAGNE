import { describe, expect, it } from "vitest";
import type { NearbyTrail } from "@mountain-live/core";
import { DEFAULT_EXPLORE_FILTERS, activeFilterCount, filterTrails, matchesDifficulty, matchesDuration } from "./filters";

const HOUR = 3_600_000;

function trail(over: Partial<NearbyTrail>): NearbyTrail {
  return {
    id: "t",
    name: "Sentier",
    activity: "hiking",
    difficulty: "moderate",
    shape: "loop",
    approachM: 1200,
    lengthM: 6000,
    durationMs: 3 * HOUR,
    durationObserved: false,
    elevationGainM: 300,
    elevationLossM: null,
    trailhead: { name: null, point: { lat: 42, lng: 9 }, kind: "parking", parking: null },
    frequentation: null,
    passagesToday: null,
    popularityScore: null,
    activeReports: 0,
    reportHint: null,
    ...over,
  } as NearbyTrail;
}

describe("filtres de la page Explorer", () => {
  it("découpe les durées en « moins de 2 h », « 2 – 4 h » et « journée »", () => {
    expect(matchesDuration(1.5 * HOUR, "short")).toBe(true);
    expect(matchesDuration(3 * HOUR, "short")).toBe(false);
    expect(matchesDuration(3 * HOUR, "half")).toBe(true);
    expect(matchesDuration(6 * HOUR, "half")).toBe(false);
    expect(matchesDuration(6 * HOUR, "day")).toBe(true);
    expect(matchesDuration(6 * HOUR, "all")).toBe(true);
  });

  it("range « expert » avec « difficile » : personne ne cherche « expert » à part", () => {
    expect(matchesDifficulty("expert", "hard")).toBe(true);
    expect(matchesDifficulty("hard", "hard")).toBe(true);
    expect(matchesDifficulty("easy", "hard")).toBe(false);
    expect(matchesDifficulty("easy", "all")).toBe(true);
  });

  it("combine durée, difficulté, activité et proximité", () => {
    const trails = [
      trail({ id: "a", durationMs: 1 * HOUR, difficulty: "easy", activity: "hiking", approachM: 400 }),
      trail({ id: "b", durationMs: 6 * HOUR, difficulty: "expert", activity: "trail", approachM: 12_000 }),
      trail({ id: "c", durationMs: 1.5 * HOUR, difficulty: "easy", activity: "mtb", approachM: 900 }),
    ];
    expect(filterTrails(trails, { ...DEFAULT_EXPLORE_FILTERS, duration: "short" }).map((t) => t.id)).toEqual(["a", "c"]);
    expect(filterTrails(trails, { ...DEFAULT_EXPLORE_FILTERS, activity: "mtb" }).map((t) => t.id)).toEqual(["c"]);
    expect(filterTrails(trails, { ...DEFAULT_EXPLORE_FILTERS, difficulty: "hard" }).map((t) => t.id)).toEqual(["b"]);
    expect(filterTrails(trails, { ...DEFAULT_EXPLORE_FILTERS, nearbyM: 1000 }).map((t) => t.id)).toEqual(["a", "c"]);
    expect(filterTrails(trails, { duration: "short", difficulty: "easy", activity: "hiking", nearbyM: 1000 }).map((t) => t.id)).toEqual(["a"]);
  });

  it("compte les filtres actifs pour expliquer une liste courte", () => {
    expect(activeFilterCount(DEFAULT_EXPLORE_FILTERS)).toBe(0);
    expect(activeFilterCount({ duration: "short", difficulty: "easy", activity: "mtb", nearbyM: 5000 })).toBe(4);
  });
});
