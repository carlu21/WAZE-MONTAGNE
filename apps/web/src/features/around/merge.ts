import { bearing, type LatLng, type OfficialAlert, type Report, type WaterPoint } from "@mountain-live/core";

export type AroundEntry =
  | { kind: "alert"; distanceM: number; alert: OfficialAlert }
  | { kind: "report"; distanceM: number; report: Report }
  | { kind: "water"; distanceM: number; waterPoint: WaterPoint & { distanceM: number } };

/**
 * Fusionne signalements, points d'eau et alertes officielles en une liste triée par distance ;
 * les alertes officielles restent en tête (section 27).
 */
export function mergeAround(items: readonly Report[], waterPoints: readonly (WaterPoint & { distanceM: number })[], alerts: readonly OfficialAlert[], center: LatLng, haversine: (a: LatLng, b: LatLng) => number): AroundEntry[] {
  const alertsEntries: AroundEntry[] = alerts.map((a) => ({ kind: "alert", distanceM: Math.round(haversine(center, { lat: a.centroidLat, lng: a.centroidLng })), alert: a }));
  const reportEntries: AroundEntry[] = items.map((r) => ({ kind: "report", distanceM: Math.round(r.distanceM ?? haversine(center, r)), report: r }));
  const waterEntries: AroundEntry[] = waterPoints.map((w) => ({ kind: "water", distanceM: Math.round(w.distanceM), waterPoint: w }));
  const rest = [...reportEntries, ...waterEntries].sort((a, b) => a.distanceM - b.distanceM);
  alertsEntries.sort((a, b) => a.distanceM - b.distanceM);
  return [...alertsEntries, ...rest];
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
/** Direction cardinale (N, NE, …) depuis le centre vers un point. */
export function cardinalDirection(from: LatLng, to: LatLng): string {
  const b = bearing(from, to);
  return CARDINALS[Math.round(b / 45) % 8];
}

export const AROUND_RADII = [1000, 3000, 5000, 10000] as const;
