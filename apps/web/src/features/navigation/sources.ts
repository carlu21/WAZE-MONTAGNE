/**
 * Sources de position (section 2 et 14).
 *
 * Le suivi principal repose sur le GPS/GNSS du téléphone (`GeolocationSource`,
 * API Geolocation, haute précision selon le mode). L'interface `PositionSource`
 * permet d'ajouter plus tard une montre ou un GPS externe en Bluetooth
 * (`ExternalPositionSource` : relevés poussés depuis un pont Web Bluetooth) sans
 * toucher au moteur, et `SimulationSource` rejoue un itinéraire avec du bruit
 * GPS pour la démonstration et les tests.
 */
import { TRACKING_PROFILES, offsetPoint, pointAtAlong, type GpsFix, type NavRoute, type TrackingMode } from "@mountain-live/core";

export type PositionSourceKind = "gps" | "simulation" | "external";

export interface PositionSource {
  readonly kind: PositionSourceKind;
  start(onFix: (fix: GpsFix) => void, onError: (message: string, code?: "denied" | "unavailable" | "timeout") => void): void;
  stop(): void;
}

export function fixFromGeolocation(pos: GeolocationPosition): GpsFix {
  const c = pos.coords;
  const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: num(c.accuracy),
    altitude: num(c.altitude),
    altitudeAccuracy: num(c.altitudeAccuracy),
    heading: num(c.heading),
    speed: num(c.speed),
    at: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now(),
  };
}

/** GPS/GNSS du téléphone : `watchPosition` haute précision, cadence selon le mode de suivi. */
export class GeolocationSource implements PositionSource {
  readonly kind = "gps" as const;
  private watchId: number | null = null;
  private lastAt = 0;

  constructor(private readonly mode: TrackingMode) {}

  start(onFix: (fix: GpsFix) => void, onError: (message: string, code?: "denied" | "unavailable" | "timeout") => void): void {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      onError("Géolocalisation indisponible sur cet appareil.", "unavailable");
      return;
    }
    const profile = TRACKING_PROFILES[this.mode];
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = fixFromGeolocation(pos);
        // En mode économie / normal, les relevés trop rapprochés sont ignorés (batterie, calculs).
        if (fix.at - this.lastAt < profile.intervalMs * 0.8 && this.lastAt > 0) return;
        this.lastAt = fix.at;
        onFix(fix);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) onError("Localisation refusée.", "denied");
        else if (err.code === err.TIMEOUT) onError("Position GPS introuvable pour l'instant.", "timeout");
        else onError("Position indisponible.", "unavailable");
      },
      { enableHighAccuracy: profile.highAccuracy, maximumAge: profile.maximumAgeMs, timeout: 30_000 },
    );
  }

  stop(): void {
    if (this.watchId !== null && typeof navigator !== "undefined" && "geolocation" in navigator) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }
}

export interface SimulationOptions {
  /** Vitesse simulée (m/s). Défaut : 1,4 (marche) — accélérée ×4 par défaut pour la démo. */
  speedMs?: number;
  intervalMs?: number;
  /** Amplitude du bruit GPS (m). Défaut 6. */
  noiseM?: number;
  accuracy?: number;
  /** Fonction aléatoire (tests déterministes). */
  random?: () => number;
  /** Abscisse de départ (m). */
  startAlong?: number;
  /** Écart latéral volontaire entre deux abscisses (m) pour simuler une sortie de parcours. */
  detour?: { fromAlong: number; toAlong: number; offsetM: number } | null;
  /** Horloge (tests). */
  now?: () => number;
}

/** Rejoue un itinéraire avec un bruit GPS pseudo-réaliste (démonstration, tests de bout en bout). */
export class SimulationSource implements PositionSource {
  readonly kind = "simulation" as const;
  private timer: number | null = null;
  private along: number;
  private readonly speedMs: number;
  private readonly intervalMs: number;
  private readonly noiseM: number;
  private readonly accuracy: number;
  private readonly random: () => number;
  private readonly detour: SimulationOptions["detour"];
  private readonly now: () => number;

  constructor(private readonly route: NavRoute, opts: SimulationOptions = {}) {
    this.speedMs = opts.speedMs ?? 1.4 * 4;
    this.intervalMs = opts.intervalMs ?? 1000;
    this.noiseM = opts.noiseM ?? 6;
    this.accuracy = opts.accuracy ?? 9;
    this.random = opts.random ?? Math.random;
    this.along = opts.startAlong ?? 0;
    this.detour = opts.detour ?? null;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Relevé suivant (exposé pour les tests). */
  next(): GpsFix {
    const base = pointAtAlong(this.route.coordinates, this.route.cumulative, this.along);
    let p = base;
    if (this.detour && this.along >= this.detour.fromAlong && this.along <= this.detour.toAlong) {
      const ahead = pointAtAlong(this.route.coordinates, this.route.cumulative, Math.min(this.route.lengthM, this.along + 10));
      const brg = Math.atan2(ahead.lng - base.lng, ahead.lat - base.lat) * (180 / Math.PI);
      p = offsetPoint(base, this.detour.offsetM, brg + 90);
    }
    const noiseD = this.noiseM * (this.random() * 2 - 1);
    const noiseB = this.random() * 360;
    const noisy = offsetPoint(p, Math.abs(noiseD), noiseB);
    const fix: GpsFix = {
      lat: noisy.lat,
      lng: noisy.lng,
      accuracy: this.accuracy + Math.round(this.random() * 4),
      altitude: this.route.elevations?.[Math.min(this.route.elevations.length - 1, Math.max(0, indexAtAlong(this.route.cumulative, this.along)))] ?? null,
      altitudeAccuracy: null,
      heading: null,
      speed: this.speedMs,
      at: this.now(),
    };
    this.along = Math.min(this.route.lengthM, this.along + (this.speedMs * this.intervalMs) / 1000);
    return fix;
  }

  get finished(): boolean {
    return this.along >= this.route.lengthM;
  }

  start(onFix: (fix: GpsFix) => void): void {
    const tick = () => {
      onFix(this.next());
      if (this.finished) {
        // Dernier relevé sur l'arrivée, puis on s'arrête.
        onFix(this.next());
        this.stop();
      }
    };
    tick();
    this.timer = window.setInterval(tick, this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}

function indexAtAlong(cumulative: readonly number[], along: number): number {
  let i = 0;
  while (i < cumulative.length - 1 && cumulative[i + 1] <= along) i++;
  return i;
}

/**
 * Source externe (section 14, architecture prête) : un pont Bluetooth (montre GPS,
 * récepteur GNSS, balise) pousse ses relevés via `push()`. Le moteur ne fait
 * aucune différence avec le GPS interne.
 */
export class ExternalPositionSource implements PositionSource {
  readonly kind = "external" as const;
  private onFix: ((fix: GpsFix) => void) | null = null;
  start(onFix: (fix: GpsFix) => void): void {
    this.onFix = onFix;
  }
  stop(): void {
    this.onFix = null;
  }
  push(fix: GpsFix): void {
    this.onFix?.(fix);
  }
}
