/**
 * Trace parcourue (sections 8, 9, 17) : filtrage des relevés, statistiques
 * (distance, durée, dénivelés, altitudes, vitesses), simplification, et
 * conversion en itinéraire (retour sur ses pas).
 */
import { haversineM, type LngLat } from "../geo";
import { simplifyPoints } from "./geometry";
import { buildRoute, elevationGain } from "./route";
import type { GpsFix, NavRoute, TrackPoint } from "./types";

export interface TrackStats {
  distanceM: number;
  durationMs: number;
  movingMs: number;
  gainM: number;
  lossM: number;
  maxAltM: number | null;
  minAltM: number | null;
  /** Vitesse moyenne sur la durée totale (m/s). */
  avgSpeedMs: number;
  /** Vitesse moyenne en mouvement (m/s). */
  movingSpeedMs: number;
  startAt: number | null;
  endAt: number | null;
  points: number;
}

export interface TrackFilterOptions {
  /** Précision au-delà de laquelle un relevé est ignoré (m). Défaut 60. */
  maxAccuracyM?: number;
  /** Déplacement minimal (m) entre deux points enregistrés. Défaut 4. */
  minMoveM?: number;
  /** Intervalle maximal (ms) sans point (même à l'arrêt). Défaut 30 s. */
  maxGapMs?: number;
}

/** Faut-il enregistrer ce relevé dans la trace ? */
export function acceptTrackPoint(last: TrackPoint | null, fix: GpsFix, opts: TrackFilterOptions = {}): boolean {
  const maxAcc = opts.maxAccuracyM ?? 60;
  const minMove = opts.minMoveM ?? 4;
  const maxGap = opts.maxGapMs ?? 30_000;
  if (fix.accuracy !== null && fix.accuracy > maxAcc) return last === null ? true : fix.at - last.at > 120_000;
  if (!last) return true;
  if (fix.at - last.at >= maxGap) return true;
  const threshold = Math.max(minMove, (fix.accuracy ?? 10) * 0.35);
  return haversineM(last, fix) >= threshold;
}

export function toTrackPoint(fix: GpsFix, position?: { lat: number; lng: number }): TrackPoint {
  return { lat: position?.lat ?? fix.lat, lng: position?.lng ?? fix.lng, alt: fix.altitude, at: fix.at, accuracy: fix.accuracy };
}

export interface TrackStatsOptions {
  /** Vitesse (m/s) sous laquelle on est « à l'arrêt ». Défaut 0,3. */
  movingSpeedMinMs?: number;
  /** Hystérésis des dénivelés (m). Défaut 8 (altitude GPS bruitée). */
  elevationHysteresisM?: number;
}

export function trackStats(points: readonly TrackPoint[], opts: TrackStatsOptions = {}): TrackStats {
  const minSpeed = opts.movingSpeedMinMs ?? 0.3;
  const hyst = opts.elevationHysteresisM ?? 8;
  let distanceM = 0;
  let movingMs = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineM(points[i - 1], points[i]);
    const dt = points[i].at - points[i - 1].at;
    distanceM += d;
    if (dt > 0 && d / (dt / 1000) >= minSpeed) movingMs += dt;
  }
  const alts = points.map((p) => p.alt).filter((a): a is number => a !== null && Number.isFinite(a));
  const { gain, loss } = elevationGain(points.map((p) => p.alt), 0, points.length - 1, hyst);
  const startAt = points[0]?.at ?? null;
  const endAt = points[points.length - 1]?.at ?? null;
  const durationMs = startAt !== null && endAt !== null ? Math.max(0, endAt - startAt) : 0;
  return {
    distanceM: Math.round(distanceM),
    durationMs,
    movingMs,
    gainM: gain,
    lossM: loss,
    maxAltM: alts.length ? Math.round(Math.max(...alts)) : null,
    minAltM: alts.length ? Math.round(Math.min(...alts)) : null,
    avgSpeedMs: durationMs > 0 ? distanceM / (durationMs / 1000) : 0,
    movingSpeedMs: movingMs > 0 ? distanceM / (movingMs / 1000) : 0,
    startAt,
    endAt,
    points: points.length,
  };
}

/** Trace simplifiée (Douglas-Peucker, tolérance en m) pour l'affichage ou l'export. */
export function simplifyTrack(points: readonly TrackPoint[], toleranceM = 3): TrackPoint[] {
  return simplifyPoints(points, toleranceM);
}

export function trackToRoute(points: readonly TrackPoint[], id: string, name: string, source: NavRoute["source"] = "track"): NavRoute {
  const simplified = simplifyTrack(points, 3);
  return buildRoute({ id, name, coordinates: simplified.map((p) => [p.lng, p.lat] as LngLat), elevations: simplified.map((p) => p.alt), source });
}

/** Itinéraire de retour par la trace inversée (section 9 : « Revenir sur mes pas »). */
export function backtrackRoute(points: readonly TrackPoint[], id = "backtrack", name = "Retour sur mes pas"): NavRoute {
  return trackToRoute([...points].reverse(), id, name, "track");
}
