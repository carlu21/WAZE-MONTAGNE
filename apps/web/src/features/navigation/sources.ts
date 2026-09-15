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

/** État de la source, indépendant de la qualité du dernier relevé. */
export type SourceStatus = "searching" | "live";

export type PositionErrorCode = "denied" | "unavailable" | "timeout";

export interface PositionSource {
  readonly kind: PositionSourceKind;
  start(
    onFix: (fix: GpsFix) => void,
    onError: (message: string, code?: PositionErrorCode) => void,
    onStatus?: (status: SourceStatus) => void,
  ): void;
  stop(): void;
}

/** Écart maximal toléré entre l'horodatage du récepteur et l'heure de réception (ms). */
export const FIX_MAX_SKEW_MS = 10_000;

/**
 * Horodatage retenu pour un relevé.
 *
 * `GeolocationPosition.timestamp` n'est pas fiable partout : certains
 * navigateurs le comptent depuis le démarrage de l'appareil, d'autres
 * renvoient une position en cache dont l'horodatage ne bouge plus. Un
 * horodatage invraisemblable (dans le futur, ou vieux de plus de dix
 * secondes) ferait croire à un signal perdu en permanence : on retient alors
 * l'heure de réception.
 */
export function normalizeFixTime(deviceAt: number, receivedAt: number): number {
  if (!Number.isFinite(deviceAt) || deviceAt <= 0) return receivedAt;
  const age = receivedAt - deviceAt;
  if (age < -2_000 || age > FIX_MAX_SKEW_MS) return receivedAt;
  return deviceAt;
}

export function fixFromGeolocation(pos: GeolocationPosition, receivedAt: number = Date.now()): GpsFix {
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
    at: normalizeFixTime(pos.timestamp, receivedAt),
  };
}

/** API de géolocalisation utilisée (injectable pour les tests). */
export interface GeolocationLike {
  watchPosition(success: PositionCallback, error?: PositionErrorCallback | null, options?: PositionOptions): number;
  clearWatch(id: number): void;
  getCurrentPosition(success: PositionCallback, error?: PositionErrorCallback | null, options?: PositionOptions): void;
}

export interface GeolocationSourceDeps {
  geolocation?: GeolocationLike | null;
  now?: () => number;
  /** Abonnement au retour au premier plan (onglet / écran rallumé). */
  onVisible?: (fn: () => void) => () => void;
}

/** Période de la veille (ms) : vérifie que les relevés continuent d'arriver. */
export const WATCHDOG_TICK_MS = 5_000;
/** Délai minimal entre deux relances de l'écoute (ms). */
export const RESTART_COOLDOWN_MS = 8_000;

function defaultOnVisible(fn: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const handler = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener("visibilitychange", handler);
  window.addEventListener("focus", handler);
  return () => {
    document.removeEventListener("visibilitychange", handler);
    window.removeEventListener("focus", handler);
  };
}

/**
 * GPS/GNSS du téléphone (source principale, section 2).
 *
 * `watchPosition` s'arrête silencieusement dans plusieurs situations
 * courantes : mise en arrière-plan de l'onglet, écran verrouillé, perte de
 * signal prolongée, passage en tunnel. Cette source ne se contente donc pas
 * d'écouter :
 *
 * - une **veille** vérifie toutes les 5 s que des relevés arrivent encore et
 *   relance l'écoute (nouvelle `watchPosition` + demande immédiate) après un
 *   silence supérieur à `staleAfterMs` ;
 * - un **délai dépassé** ou une position indisponible relancent l'écoute au
 *   lieu d'abandonner ; l'utilisateur n'est prévenu qu'après plusieurs échecs ;
 * - le **retour au premier plan** relance immédiatement ;
 * - la cadence est mesurée sur l'heure de **réception** (un récepteur qui
 *   renvoie le même horodatage ne doit pas faire taire la source).
 *
 * Seul un refus d'autorisation est définitif.
 */
export class GeolocationSource implements PositionSource {
  readonly kind = "gps" as const;
  private watchId: number | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private unsubscribeVisible: (() => void) | null = null;
  private onFix: ((fix: GpsFix) => void) | null = null;
  private onError: ((message: string, code?: PositionErrorCode) => void) | null = null;
  private onStatus: ((status: SourceStatus) => void) | null = null;
  /** Heure de réception du dernier relevé reçu (même ignoré par la cadence). */
  private lastReceivedAt = 0;
  /** Heure de réception du dernier relevé transmis au moteur. */
  private lastEmitAt = 0;
  private lastRestartAt = 0;
  private lastFixTime = 0;
  private failures = 0;
  private status: SourceStatus = "searching";
  private readonly geolocation: GeolocationLike | null;
  private readonly now: () => number;
  private readonly onVisible: (fn: () => void) => () => void;

  constructor(
    private readonly mode: TrackingMode,
    deps: GeolocationSourceDeps = {},
  ) {
    this.geolocation = deps.geolocation ?? (typeof navigator !== "undefined" && "geolocation" in navigator ? navigator.geolocation : null);
    this.now = deps.now ?? (() => Date.now());
    this.onVisible = deps.onVisible ?? defaultOnVisible;
  }

  private get profile() {
    return TRACKING_PROFILES[this.mode];
  }

  private setStatus(status: SourceStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  private options(): PositionOptions {
    const p = this.profile;
    return { enableHighAccuracy: p.highAccuracy, maximumAge: p.maximumAgeMs, timeout: Math.max(20_000, p.staleAfterMs) };
  }

  private handlePosition = (pos: GeolocationPosition): void => {
    const receivedAt = this.now();
    this.lastReceivedAt = receivedAt;
    this.failures = 0;
    // Cadence mesurée sur l'heure de réception : un relevé en cache ou daté à
    // l'identique ne doit jamais interrompre le flux.
    if (this.lastEmitAt > 0 && receivedAt - this.lastEmitAt < this.profile.intervalMs * 0.8) return;
    this.lastEmitAt = receivedAt;
    this.setStatus("live");
    const fix = fixFromGeolocation(pos, receivedAt);
    // L'horodatage doit progresser : un récepteur qui répète la même valeur
    // figerait l'âge du relevé (signal déclaré perdu) et les calculs de vitesse.
    if (fix.at <= this.lastFixTime) fix.at = receivedAt;
    this.lastFixTime = fix.at;
    this.onFix?.(fix);
  };

  private handleError = (err: GeolocationPositionError): void => {
    if (err.code === err.PERMISSION_DENIED) {
      const report = this.onError;
      this.stop();
      report?.("Localisation refusée.", "denied");
      return;
    }
    this.failures += 1;
    this.setStatus("searching");
    // Délai dépassé ou position indisponible : on relance, c'est le cas normal
    // en forêt, en canyon ou après un passage en arrière-plan.
    this.restart(1_000);
    if (this.failures === 3) {
      this.onError?.(
        err.code === err.TIMEOUT ? "Position GPS introuvable pour l'instant : recherche en cours." : "Position indisponible : recherche en cours.",
        err.code === err.TIMEOUT ? "timeout" : "unavailable",
      );
    }
  };

  /** Demande ponctuelle : première position rapide, et relance après un silence. */
  private kick(): void {
    this.geolocation?.getCurrentPosition(this.handlePosition, () => {
      /* l'écoute continue : l'échec ponctuel est sans conséquence */
    }, this.options());
  }

  private openWatch(): void {
    if (!this.geolocation) return;
    this.closeWatch();
    this.watchId = this.geolocation.watchPosition(this.handlePosition, this.handleError, this.options());
  }

  private closeWatch(): void {
    if (this.watchId !== null) this.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
  }

  /**
   * Relance l'écoute, au plus une fois par `minGapMs`. Après une relance, le
   * prochain relevé est transmis sans attendre la cadence : la carte doit
   * retrouver la position immédiatement.
   */
  private restart(minGapMs: number = RESTART_COOLDOWN_MS): void {
    const now = this.now();
    if (now - this.lastRestartAt < minGapMs) return;
    this.lastRestartAt = now;
    this.lastEmitAt = 0;
    this.openWatch();
    this.kick();
  }

  private tick = (): void => {
    if (this.watchId === null && this.geolocation) {
      this.restart(0);
      return;
    }
    const silent = this.now() - this.lastReceivedAt;
    if (silent > this.profile.staleAfterMs) {
      this.setStatus("searching");
      this.restart();
    }
  };

  start(
    onFix: (fix: GpsFix) => void,
    onError: (message: string, code?: PositionErrorCode) => void,
    onStatus?: (status: SourceStatus) => void,
  ): void {
    this.onFix = onFix;
    this.onError = onError;
    this.onStatus = onStatus ?? null;
    if (!this.geolocation) {
      onError("Géolocalisation indisponible sur cet appareil.", "unavailable");
      return;
    }
    this.lastReceivedAt = this.now();
    this.lastEmitAt = 0;
    this.lastRestartAt = this.now();
    this.lastFixTime = 0;
    this.failures = 0;
    this.status = "searching";
    this.openWatch();
    this.kick();
    this.watchdog = setInterval(this.tick, WATCHDOG_TICK_MS);
    // Retour au premier plan : les minuteurs et l'écoute ont pu être suspendus.
    this.unsubscribeVisible = this.onVisible(() => {
      this.lastReceivedAt = this.now();
      this.restart(0);
    });
  }

  stop(): void {
    this.closeWatch();
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.watchdog = null;
    this.unsubscribeVisible?.();
    this.unsubscribeVisible = null;
    this.onFix = null;
    this.onError = null;
    this.onStatus = null;
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
