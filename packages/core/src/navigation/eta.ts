/**
 * Durée restante et heure d'arrivée (section 5) : vitesse observée en
 * mouvement si disponible, sinon vitesse type de l'activité, avec majoration
 * par le dénivelé (règle de Naismith adaptée).
 */
import type { ActivityMode } from "./types";

/** Vitesse type sur le plat (m/s) par activité. */
export const DEFAULT_SPEED_MS: Record<ActivityMode, number> = {
  hiking: 4000 / 3600,
  trail: 8000 / 3600,
  mtb: 12000 / 3600,
  equestrian: 6000 / 3600,
  other: 4000 / 3600,
};

/** Temps (ms) ajouté par mètre de dénivelé positif (Naismith : 1 h / 600 m à pied). */
export const CLIMB_MS_PER_M: Record<ActivityMode, number> = {
  hiking: 3600_000 / 600,
  trail: 3600_000 / 1000,
  mtb: 3600_000 / 800,
  equestrian: 3600_000 / 700,
  other: 3600_000 / 600,
};

export interface EtaInput {
  remainingM: number;
  gainRemainingM: number | null;
  activity: ActivityMode;
  /** Vitesse moyenne observée en mouvement (m/s), ou null. */
  observedSpeedMs: number | null;
  now?: number;
}

export interface EtaResult {
  remainingMs: number;
  arrivalAt: number;
  /** Vitesse retenue (m/s). */
  speedMs: number;
}

export function estimateEta(input: EtaInput): EtaResult {
  const base = DEFAULT_SPEED_MS[input.activity];
  // La vitesse observée n'est retenue que si plausible (0,3 m/s à 3× la vitesse type).
  const observed = input.observedSpeedMs !== null && input.observedSpeedMs >= 0.3 && input.observedSpeedMs <= base * 3 ? input.observedSpeedMs : null;
  const speedMs = observed !== null ? 0.7 * observed + 0.3 * base : base;
  const flatMs = (Math.max(0, input.remainingM) / speedMs) * 1000;
  // Avec une vitesse observée, la pente est déjà en partie « dans » la vitesse : moitié de majoration.
  const climbMs = (input.gainRemainingM ?? 0) * CLIMB_MS_PER_M[input.activity] * (observed !== null ? 0.5 : 1);
  const remainingMs = Math.round(flatMs + climbMs);
  const now = input.now ?? Date.now();
  return { remainingMs, arrivalAt: now + remainingMs, speedMs };
}

/** « 1 h 25 », « 45 min », « 3 h ». */
export function formatDurationShort(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m.toString().padStart(2, "0")}`;
}

/** « 4,2 km/h ». */
export function formatSpeedKmh(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const kmh = ms * 3.6;
  return `${kmh < 10 ? kmh.toFixed(1).replace(".", ",") : Math.round(kmh)} km/h`;
}

/** « 14:35 ». */
export function formatClock(at: number): string {
  const d = new Date(at);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
