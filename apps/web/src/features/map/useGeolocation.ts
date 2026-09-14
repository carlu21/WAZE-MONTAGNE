/**
 * Géolocalisation de l'appareil (section 33 : ouverture → carte centrée).
 *
 * - `watchPosition` haute précision, mises à jour limitées à une toutes les 5 s,
 *   écrites dans useUiStore().position (jamais envoyées telles quelles au serveur).
 * - Démarre seul si l'autorisation a déjà été accordée ; sinon `request()`
 *   déclenche la demande (au tap sur « Me localiser »).
 * - Refus et erreurs traduits en messages français (fr.errors).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fr } from "@mountain-live/core";
import { useUiStore } from "@/store/ui";

export type GeolocationStatus = "unsupported" | "idle" | "locating" | "watching" | "denied" | "unavailable";

export interface UseGeolocationOptions {
  /** Intervalle minimal entre deux mises à jour de la position (ms). Défaut : 5 000. */
  throttleMs?: number;
  /** Lancer le suivi automatiquement si l'autorisation est déjà accordée (défaut : true). */
  autoStart?: boolean;
}

export interface GeolocationState {
  status: GeolocationStatus;
  /** Message d'erreur en français, ou null. */
  error: string | null;
  supported: boolean;
  /** Demande l'autorisation si nécessaire, lance le suivi et renvoie la première position (null en cas d'échec). */
  request: () => Promise<{ lat: number; lng: number; accuracy: number | null } | null>;
  stop: () => void;
}

export const GEOLOCATION_THROTTLE_MS = 5_000;
const POSITION_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 };

function messageFor(err: GeolocationPositionError): { status: GeolocationStatus; error: string } {
  if (err.code === err.PERMISSION_DENIED) return { status: "denied", error: fr.errors.locationDenied };
  if (err.code === err.TIMEOUT) return { status: "unavailable", error: fr.errors.timeout };
  return { status: "unavailable", error: fr.errors.locationUnavailable };
}

export function useGeolocation(opts: UseGeolocationOptions = {}): GeolocationState {
  const throttleMs = opts.throttleMs ?? GEOLOCATION_THROTTLE_MS;
  const autoStart = opts.autoStart ?? true;
  const supported = typeof navigator !== "undefined" && "geolocation" in navigator;
  const setPosition = useUiStore((s) => s.setPosition);
  const [status, setStatus] = useState<GeolocationStatus>(supported ? "idle" : "unsupported");
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastAcceptedAt = useRef(0);
  const mounted = useRef(true);

  const accept = useCallback(
    (pos: GeolocationPosition, force = false) => {
      const now = Date.now();
      if (!force && now - lastAcceptedAt.current < throttleMs) return;
      lastAcceptedAt.current = now;
      const { latitude, longitude, accuracy } = pos.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      setPosition({ lat: latitude, lng: longitude, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null, at: now });
    },
    [setPosition, throttleMs],
  );

  const stop = useCallback(() => {
    if (watchId.current !== null && supported) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (mounted.current) setStatus((s) => (s === "watching" || s === "locating" ? "idle" : s));
  }, [supported]);

  const startWatch = useCallback(() => {
    if (!supported || watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (!mounted.current) return;
        accept(pos);
        setStatus("watching");
        setError(null);
      },
      (err) => {
        if (!mounted.current) return;
        const m = messageFor(err);
        setStatus(m.status);
        setError(m.error);
        if (err.code === err.PERMISSION_DENIED) stop();
      },
      POSITION_OPTIONS,
    );
    setStatus((s) => (s === "locating" ? s : "watching"));
  }, [supported, accept, stop]);

  const request = useCallback<GeolocationState["request"]>(() => {
    if (!supported) {
      setStatus("unsupported");
      setError(fr.errors.locationUnavailable);
      return Promise.resolve(null);
    }
    setStatus("locating");
    setError(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!mounted.current) return resolve(null);
          accept(pos, true);
          startWatch();
          setStatus("watching");
          const { latitude, longitude, accuracy } = pos.coords;
          resolve({ lat: latitude, lng: longitude, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null });
        },
        (err) => {
          if (!mounted.current) return resolve(null);
          const m = messageFor(err);
          setStatus(m.status);
          setError(m.error);
          resolve(null);
        },
        POSITION_OPTIONS,
      );
    });
  }, [supported, accept, startWatch]);

  // Démarrage silencieux si l'autorisation a déjà été accordée (aucune fenêtre de demande).
  useEffect(() => {
    mounted.current = true;
    if (!supported || !autoStart) return;
    let cancelled = false;
    const permissions = typeof navigator.permissions?.query === "function" ? navigator.permissions : null;
    if (!permissions) return;
    permissions
      .query({ name: "geolocation" })
      .then((result) => {
        if (cancelled) return;
        if (result.state === "granted") startWatch();
        else if (result.state === "denied") setStatus("denied");
      })
      .catch(() => {
        /* API Permissions indisponible : le suivi démarrera au tap sur « Me localiser » */
      });
    return () => {
      cancelled = true;
    };
  }, [supported, autoStart, startWatch]);

  useEffect(
    () => () => {
      mounted.current = false;
      if (watchId.current !== null && supported) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    },
    [supported],
  );

  return { status, error, supported, request, stop };
}
