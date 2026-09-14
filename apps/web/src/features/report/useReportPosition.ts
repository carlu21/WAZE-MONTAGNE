/**
 * Position du signalement (section 4 : « position GPS automatique, ajustable
 * sur la carte »).
 *
 * Ordre de résolution :
 *  1. dernière position GPS connue de l'appareil (store UI) si récente ;
 *  2. sinon `navigator.geolocation.getCurrentPosition` ;
 *  3. sinon centre de la dernière vue de la carte, à ajuster à la main.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fr } from "@mountain-live/core";
import { useUiStore } from "@/store/ui";
import type { DraftPosition } from "./wizardState";

export type PositionStatus = "locating" | "gps" | "fallback" | "denied" | "unavailable" | "timeout";

/** Dernier relevé GPS (référence affichée sur la mini-carte, indépendante du point ajusté). */
export interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number | null;
  at: number;
}

/** Une position du store plus ancienne est re-demandée. */
export const FRESH_FIX_MS = 2 * 60_000;
export const GEOLOCATION_TIMEOUT_MS = 12_000;

export const POSITION_MESSAGES = {
  locating: "Recherche de votre position…",
  gps: fr.wizard.positionAuto,
  adjusted: "Point placé à la main.",
  adjustedFromGps: "Point ajusté à partir de votre position GPS.",
  fallback: "Position approximative : déplacez la carte pour placer le point.",
  denied: "Localisation refusée : placez le point sur la carte.",
  unavailable: fr.wizard.needLocation,
  timeout: "Position GPS introuvable pour l'instant : réessayez ou placez le point sur la carte.",
} as const;

export interface ReportPositionState {
  status: PositionStatus;
  fix: GpsFix | null;
  /** Relance la géolocalisation et recentre le point sur la position obtenue. */
  locate: () => void;
  /** Phrase d'état à afficher sous le titre « Position du signalement ». */
  message: string;
}

export function positionMessage(status: PositionStatus, position: DraftPosition | null): string {
  if (status === "locating") return POSITION_MESSAGES.locating;
  if (position?.adjusted) return position.source === "gps" ? POSITION_MESSAGES.adjustedFromGps : POSITION_MESSAGES.adjusted;
  if (position?.source === "gps") return POSITION_MESSAGES.gps;
  switch (status) {
    case "denied":
      return POSITION_MESSAGES.denied;
    case "timeout":
      return POSITION_MESSAGES.timeout;
    case "unavailable":
      return POSITION_MESSAGES.unavailable;
    default:
      return POSITION_MESSAGES.fallback;
  }
}

function fallbackPosition(): DraftPosition {
  const { view } = useUiStore.getState();
  return { lat: view.lat, lng: view.lng, accuracy: null, source: "map", adjusted: false };
}

export function useReportPosition(position: DraftPosition | null, setPosition: (p: DraftPosition) => void): ReportPositionState {
  const [status, setStatus] = useState<PositionStatus>(() => (position ? (position.source === "gps" ? "gps" : "fallback") : "locating"));
  const [fix, setFix] = useState<GpsFix | null>(() => {
    const stored = useUiStore.getState().position;
    return stored ? { lat: stored.lat, lng: stored.lng, accuracy: stored.accuracy, at: stored.at } : null;
  });
  const positionRef = useRef(position);
  positionRef.current = position;
  const setPositionRef = useRef(setPosition);
  setPositionRef.current = setPosition;
  const mountedRef = useRef(true);
  const requestingRef = useRef(false);

  const locate = useCallback(() => {
    if (requestingRef.current) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      if (!positionRef.current) setPositionRef.current(fallbackPosition());
      return;
    }
    requestingRef.current = true;
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (geo) => {
        requestingRef.current = false;
        if (!mountedRef.current) return;
        const accuracy = Number.isFinite(geo.coords.accuracy) ? Math.round(geo.coords.accuracy) : null;
        const next: GpsFix = { lat: geo.coords.latitude, lng: geo.coords.longitude, accuracy, at: Date.now() };
        setFix(next);
        useUiStore.getState().setPosition({ lat: next.lat, lng: next.lng, accuracy, at: next.at });
        setPositionRef.current({ lat: next.lat, lng: next.lng, accuracy, source: "gps", adjusted: false });
        setStatus("gps");
      },
      (err) => {
        requestingRef.current = false;
        if (!mountedRef.current) return;
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable");
        if (!positionRef.current) setPositionRef.current(fallbackPosition());
      },
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 30_000 },
    );
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (positionRef.current) return () => void (mountedRef.current = false);
    const stored = useUiStore.getState().position;
    if (stored && Date.now() - stored.at < FRESH_FIX_MS) {
      setFix({ lat: stored.lat, lng: stored.lng, accuracy: stored.accuracy, at: stored.at });
      setPositionRef.current({ lat: stored.lat, lng: stored.lng, accuracy: stored.accuracy, source: "gps", adjusted: false });
      setStatus("gps");
    } else {
      locate();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [locate]);

  return { status, fix, locate, message: positionMessage(status, position) };
}
