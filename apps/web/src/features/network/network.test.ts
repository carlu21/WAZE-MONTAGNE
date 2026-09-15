import { describe, expect, it } from "vitest";
import type { HeatmapResponse, RawPoint } from "@mountain-live/core";
import { MAX_UPLOAD_POINTS, activityPayload, thinPoints } from "@/features/navigation/activities";
import type { SavedTrack } from "@/lib/db";
import { FREQUENTATION_COLORS, heatmapCollection } from "./heatmap";
import { HEATMAP_MIN_ZOOM, roundBBox } from "./useHeatmap";

/**
 * Côté application : ce qui est envoyé au réseau collectif, et comment la
 * fréquentation est représentée. Deux règles s'y vérifient — rien ne part sans
 * trace brute (section 5), et un chemin sans données ne doit pas ressembler à
 * un chemin désert (section 43).
 */

function rawTrace(n: number, from = 1_700_000_000_000): RawPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    at: from + i * 1000,
    lat: 42.22 + i * 0.00002,
    lng: 9.045 + i * 0.00002,
    alt: 1200 + i * 0.1,
    accuracy: 8,
    speed: 1.2,
    heading: 45,
  }));
}

function savedTrack(raw: RawPoint[] | undefined): SavedTrack {
  return {
    id: "trk_1",
    name: "Montée au lac",
    activity: "hiking",
    savedAt: 1_700_000_100_000,
    points: (raw ?? []).map((p) => ({ at: p.at, lat: p.lat, lng: p.lng, alt: p.alt, accuracy: p.accuracy })),
    raw,
    stats: { distanceM: 1200, durationMs: 900_000, movingMs: 880_000, gainM: 210, lossM: 20, maxAltM: 1410, minAltM: 1200, avgSpeedMs: 1.3, movingSpeedMs: 1.4, startAt: raw?.[0]?.at ?? null, endAt: raw?.[raw.length - 1]?.at ?? null, points: raw?.length ?? 0 },
  };
}

describe("contribution au réseau collectif", () => {
  it("conserve la trace telle quelle tant qu'elle tient dans la limite d'envoi", () => {
    const raw = rawTrace(500);
    const out = thinPoints(raw);
    expect(out).toHaveLength(500);
    expect(out).not.toBe(raw); // copie : la trace enregistrée n'est jamais mutée
    expect(out[0]).toEqual(raw[0]);
  });

  it("échantillonne une trace trop longue sans perdre ses extrémités", () => {
    const raw = rawTrace(1000);
    const out = thinPoints(raw, 100);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out[0]).toEqual(raw[0]);
    expect(out[out.length - 1]).toEqual(raw[raw.length - 1]);
    // L'ordre chronologique est préservé.
    for (let i = 1; i < out.length; i++) expect(out[i].at).toBeGreaterThan(out[i - 1].at);
    expect(MAX_UPLOAD_POINTS).toBeGreaterThan(1000);
  });

  it("refuse d'envoyer une activité sans trace brute", () => {
    expect(activityPayload(savedTrack(undefined), true)).toBeNull();
    expect(activityPayload(savedTrack([]), true)).toBeNull();
    expect(activityPayload(savedTrack(rawTrace(1)), true)).toBeNull();
  });

  it("construit une charge utile fidèle à la trace brute et au consentement", () => {
    const raw = rawTrace(120);
    const payload = activityPayload(savedTrack(raw), true);
    expect(payload).not.toBeNull();
    expect(payload!.contribute).toBe(true);
    expect(payload!.activityType).toBe("hiking");
    expect(payload!.source).toBe("recorded");
    expect(payload!.clientId).toBe("trk_1");
    expect(payload!.points).toHaveLength(120);
    expect(payload!.startedAt).toBe(new Date(raw[0].at).toISOString());
    expect(payload!.endedAt).toBe(new Date(raw[raw.length - 1].at).toISOString());
    // Les points envoyés portent la mesure, pas une position corrigée.
    expect(payload!.points[0]).toEqual({ at: raw[0].at, lat: raw[0].lat, lng: raw[0].lng, alt: raw[0].alt, accuracy: raw[0].accuracy, speed: raw[0].speed, heading: raw[0].heading });
    const prive = activityPayload(savedTrack(raw), false);
    expect(prive!.contribute).toBe(false);
  });
});

describe("carte de fréquentation", () => {
  const response = (segments: HeatmapResponse["segments"], maxPassages: number): HeatmapResponse => ({
    period: "month",
    activity: "all",
    segments,
    maxPassages,
    coverage: 0.5,
    generatedAt: "2026-03-01T10:00:00.000Z",
  });

  it("arrondit l'emprise pour ne pas rejouer une requête à chaque pixel", () => {
    const box = roundBBox({ west: 9.0123, south: 42.2011, east: 9.0456, north: 42.2345 });
    expect(box.west).toBeLessThanOrEqual(9.0123);
    expect(box.south).toBeLessThanOrEqual(42.2011);
    expect(box.east).toBeGreaterThanOrEqual(9.0456);
    expect(box.north).toBeGreaterThanOrEqual(42.2345);
    // Deux emprises voisines donnent la même clé de requête.
    expect(roundBBox({ west: 9.0124, south: 42.2012, east: 9.0455, north: 42.2344 })).toEqual(box);
    expect(HEATMAP_MIN_ZOOM).toBeGreaterThan(8);
  });

  it("ne produit aucun tracé quand il n'y a rien à montrer", () => {
    expect(heatmapCollection(null).features).toEqual([]);
    expect(heatmapCollection(response([], 0)).features).toEqual([]);
  });

  it("répartit l'intensité en racine pour que les chemins discrets restent lisibles", () => {
    const data = response(
      [
        { segmentId: "a", coordinates: [[9.0, 42.2], [9.01, 42.21]], passages: 100, popularityScore: 90, frequentation: "very_high", dominantActivity: "hiking", insufficientData: false },
        { segmentId: "b", coordinates: [[9.02, 42.22], [9.03, 42.23]], passages: 4, popularityScore: 8, frequentation: "low", dominantActivity: null, insufficientData: false },
      ],
      100,
    );
    const features = heatmapCollection(data).features;
    expect(features).toHaveLength(2);
    const fort = features[0].properties!;
    const discret = features[1].properties!;
    expect(fort.intensity).toBeCloseTo(1, 5);
    expect(discret.intensity).toBeCloseTo(0.2, 5);
    expect(discret.intensity).toBeGreaterThan(4 / 100); // sans racine, le trait serait invisible
    expect(fort.color).toBe(FREQUENTATION_COLORS.very_high);
    expect(discret.color).toBe(FREQUENTATION_COLORS.low);
    expect(features[0].geometry.type).toBe("LineString");
  });

  it("distingue un chemin sans données d'un chemin désert", () => {
    const data = response(
      [{ segmentId: "c", coordinates: [[9.0, 42.2], [9.01, 42.21]], passages: 0, popularityScore: 0, frequentation: "unknown", dominantActivity: null, insufficientData: true }],
      0,
    );
    const feature = heatmapCollection(data).features[0].properties!;
    expect(feature.insufficient).toBe(true);
    expect(feature.color).toBe(FREQUENTATION_COLORS.unknown);
    expect(feature.intensity).toBe(0);
    // Une couleur distincte par niveau : aucune confusion possible à l'écran.
    expect(new Set(Object.values(FREQUENTATION_COLORS)).size).toBe(Object.keys(FREQUENTATION_COLORS).length);
  });
});
