import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GpsFix } from "@mountain-live/core";
import { FIX_MAX_SKEW_MS, GeolocationSource, WATCHDOG_TICK_MS, fixFromGeolocation, normalizeFixTime, type GeolocationLike, type SourceStatus } from "./sources";

/** Fausse API de géolocalisation : permet de pousser des positions et des erreurs à la demande. */
class FakeGeolocation implements GeolocationLike {
  watches: { id: number; success: PositionCallback; error?: PositionErrorCallback | null; options?: PositionOptions }[] = [];
  currentRequests = 0;
  private nextId = 1;
  constructor(private readonly clock: { now: number }) {}

  watchPosition(success: PositionCallback, error?: PositionErrorCallback | null, options?: PositionOptions): number {
    const id = this.nextId++;
    this.watches.push({ id, success, error, options });
    return id;
  }
  clearWatch(id: number): void {
    this.watches = this.watches.filter((w) => w.id !== id);
  }
  getCurrentPosition(success: PositionCallback): void {
    this.currentRequests += 1;
    void success;
  }

  get active() {
    return this.watches[this.watches.length - 1] ?? null;
  }
  /** Position renvoyée par l'écoute en cours. `timestamp` par défaut : l'heure simulée. */
  push(overrides: { timestamp?: number; accuracy?: number; lat?: number; lng?: number } = {}): void {
    const pos = {
      coords: { latitude: overrides.lat ?? 42.2261, longitude: overrides.lng ?? 9.0453, accuracy: overrides.accuracy ?? 10, altitude: 1375, altitudeAccuracy: 8, heading: null, speed: 1.2 },
      timestamp: overrides.timestamp ?? this.clock.now,
    } as unknown as GeolocationPosition;
    this.active?.success(pos);
  }
  fail(code: number): void {
    const err = { code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "" } as unknown as GeolocationPositionError;
    this.active?.error?.(err);
  }
}

describe("horodatage des relevés", () => {
  it("retient l'horodatage du récepteur quand il est plausible", () => {
    expect(normalizeFixTime(1_000_000, 1_002_000)).toBe(1_000_000);
  });
  it("retombe sur l'heure de réception si l'horodatage est aberrant", () => {
    // Compté depuis le démarrage de l'appareil (valeur minuscule) :
    expect(normalizeFixTime(42_000, 1_700_000_000_000)).toBe(1_700_000_000_000);
    // Dans le futur :
    expect(normalizeFixTime(1_010_000, 1_000_000)).toBe(1_000_000);
    // Trop vieux (plus d'une minute) :
    expect(normalizeFixTime(1_000_000, 1_000_000 + FIX_MAX_SKEW_MS + 1)).toBe(1_000_000 + FIX_MAX_SKEW_MS + 1);
    expect(normalizeFixTime(Number.NaN, 5_000)).toBe(5_000);
  });
  it("convertit une position du navigateur", () => {
    const pos = { coords: { latitude: 42, longitude: 9, accuracy: 12, altitude: null, altitudeAccuracy: null, heading: Number.NaN, speed: 0 }, timestamp: 1_000 } as unknown as GeolocationPosition;
    const fix = fixFromGeolocation(pos, 1_500);
    expect(fix).toMatchObject({ lat: 42, lng: 9, accuracy: 12, altitude: null, heading: null, speed: 0, at: 1_000 });
  });
});

describe("GeolocationSource — le signal doit tenir", () => {
  const clock = { now: 1_000_000 };
  let geo: FakeGeolocation;
  let fixes: GpsFix[];
  let errors: { message: string; code?: string }[];
  let statuses: SourceStatus[];
  let visible: (() => void) | null;
  let source: GeolocationSource;

  /** Avance l'horloge simulée et les minuteurs du même temps. */
  const advance = (ms: number) => {
    clock.now += ms;
    vi.advanceTimersByTime(ms);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    clock.now = 1_000_000;
    geo = new FakeGeolocation(clock);
    fixes = [];
    errors = [];
    statuses = [];
    visible = null;
    source = new GeolocationSource("normal", {
      geolocation: geo,
      now: () => clock.now,
      onVisible: (fn) => {
        visible = fn;
        return () => {
          visible = null;
        };
      },
    });
    source.start(
      (f) => fixes.push(f),
      (message, code) => errors.push({ message, code }),
      (s) => statuses.push(s),
    );
  });

  afterEach(() => {
    source.stop();
    vi.useRealTimers();
  });

  it("écoute en continu et demande une première position tout de suite", () => {
    expect(geo.watches).toHaveLength(1);
    expect(geo.currentRequests).toBe(1);
    expect(geo.active?.options?.enableHighAccuracy).toBe(true);
    // Aucune position en cache : un relevé figé ne doit jamais faire croire à un signal vivant.
    expect(geo.active?.options?.maximumAge).toBe(0);
  });

  it("transmet les relevés à la cadence du mode, mesurée sur l'heure de réception", () => {
    geo.push();
    expect(fixes).toHaveLength(1);
    expect(statuses).toContain("live");
    advance(1_000);
    geo.push();
    expect(fixes).toHaveLength(1); // trop rapproché
    advance(4_000);
    geo.push();
    expect(fixes).toHaveLength(2);
  });

  it("continue de transmettre même si le récepteur renvoie toujours le même horodatage", () => {
    const frozen = clock.now;
    geo.push({ timestamp: frozen });
    for (let i = 0; i < 4; i++) {
      advance(5_000);
      geo.push({ timestamp: frozen }); // position en cache, horodatage figé
    }
    expect(fixes).toHaveLength(5);
    // L'horodatage retenu suit l'heure de réception : le signal ne se déclare pas perdu.
    expect(fixes[4].at - fixes[0].at).toBe(20_000);
  });

  it("relance l'écoute après un silence prolongé (arrière-plan, tunnel, écran verrouillé)", () => {
    geo.push();
    const firstWatch = geo.active?.id;
    advance(WATCHDOG_TICK_MS);
    expect(geo.active?.id).toBe(firstWatch); // silence court : on ne touche à rien
    advance(30_000); // au-delà de staleAfterMs (25 s en mode normal)
    expect(geo.active?.id).not.toBe(firstWatch);
    expect(geo.watches).toHaveLength(1); // l'ancienne écoute est bien fermée
    expect(geo.currentRequests).toBeGreaterThan(1);
    expect(statuses[statuses.length - 1]).toBe("searching");
    // Le signal revient : la source repasse en « live ».
    geo.push();
    expect(fixes).toHaveLength(2);
    expect(statuses[statuses.length - 1]).toBe("live");
  });

  it("relance après un délai dépassé et n'alerte l'utilisateur qu'après plusieurs échecs", () => {
    advance(20_000); // le délai de la requête est dépassé
    const first = geo.active?.id;
    geo.fail(3); // TIMEOUT
    expect(geo.active?.id).not.toBe(first);
    expect(geo.watches).toHaveLength(1);
    expect(errors).toHaveLength(0);
    advance(10_000);
    geo.fail(3);
    expect(errors).toHaveLength(0);
    advance(10_000);
    geo.fail(2); // POSITION_UNAVAILABLE
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("unavailable");
    // L'écoute reste active : le suivi reprend dès qu'une position arrive.
    geo.push();
    expect(fixes).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toBe("live");
  });

  it("ne relance pas plus d'une fois par seconde en cas d'échecs en rafale", () => {
    advance(20_000);
    const before = geo.active?.id;
    geo.fail(2);
    const after = geo.active?.id;
    expect(after).not.toBe(before);
    for (let i = 0; i < 5; i++) geo.fail(2);
    expect(geo.active?.id).toBe(after);
    expect(geo.watches).toHaveLength(1);
  });

  it("s'arrête définitivement sur un refus d'autorisation", () => {
    geo.fail(1); // PERMISSION_DENIED
    expect(errors).toEqual([{ message: "Localisation refusée.", code: "denied" }]);
    expect(geo.watches).toHaveLength(0);
    advance(60_000);
    expect(geo.watches).toHaveLength(0);
  });

  it("relance immédiatement au retour au premier plan", () => {
    geo.push();
    const before = geo.active?.id;
    advance(2_000);
    visible?.();
    expect(geo.active?.id).not.toBe(before);
    geo.push();
    expect(fixes).toHaveLength(2); // la cadence ne bloque pas le premier relevé après reprise
  });

  it("libère l'écoute et la veille à l'arrêt", () => {
    source.stop();
    expect(geo.watches).toHaveLength(0);
    advance(120_000);
    expect(geo.watches).toHaveLength(0);
    expect(visible).toBeNull();
  });
});
