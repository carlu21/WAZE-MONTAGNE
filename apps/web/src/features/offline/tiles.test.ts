import { describe, expect, it } from "vitest";
import { countTiles, lat2tile, lon2tile, tileRanges, tileUrls } from "./tiles";

describe("tuiles hors connexion", () => {
  it("convertit des coordonnées en index de tuile (Corte, zoom 12)", () => {
    expect(lon2tile(9.15, 12)).toBe(2152);
    expect(lat2tile(42.3, 12)).toBe(1515);
  });
  it("compte les tuiles d'une bbox de la Restonica", () => {
    const bbox = { west: 9.0, south: 42.25, east: 9.2, north: 42.35 };
    const ranges = tileRanges(bbox, 10, 12);
    expect(ranges).toHaveLength(3);
    expect(ranges[0].z).toBe(10);
    expect(countTiles(bbox, 10, 12)).toBe(ranges.reduce((n, r) => n + r.count, 0));
    expect(tileUrls(bbox, 10, 10)[0]).toMatch(/^https:\/\/[abc]\.tile\.opentopomap\.org\/10\/\d+\/\d+\.png$/);
  });
});
