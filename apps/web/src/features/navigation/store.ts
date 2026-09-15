/**
 * État de la navigation (module « Waze de la montagne »).
 *
 * - Préférences persistées : activité, précision du suivi, guidage vocal.
 * - Session en cours (mémoire) : mode libre / itinéraire, statut, et l'instantané
 *   « live » publié par le moteur à chaque relevé (position rattachée, progression,
 *   instruction, prochain événement, qualité GPS…). Le moteur lui-même vit dans
 *   useNavigationEngine ; la trace complète est conservée dans l'état du moteur
 *   et exposée ici sous forme de compteur pour limiter les rendus.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ActivityMode,
  AheadAlert,
  GpsQuality,
  Instruction,
  MatchOutput,
  NavRoute,
  RouteEvent,
  RouteProgress,
  RawPoint,
  TrackPoint,
  TrackStats,
  TrackingMode,
} from "@mountain-live/core";

export type NavStatus = "idle" | "running" | "paused" | "finished";
export type NavMode = "free" | "route";

export interface NavLive {
  output: MatchOutput | null;
  progress: RouteProgress | null;
  instruction: Instruction | null;
  nextEvent: { event: RouteEvent; distanceM: number } | null;
  events: RouteEvent[];
  offRoute: boolean;
  /** Distance au parcours (m) quand on l'a quitté. */
  offRouteDistanceM: number | null;
  quality: GpsQuality;
  /** La source cherche un signal (relance de l'écoute en cours). */
  searching: boolean;
  compassHeading: number | null;
  /** Dernière altitude GPS (m) ou null. */
  altitude: number | null;
  trackPoints: number;
  stats: TrackStats | null;
  movingSpeedMs: number | null;
  arrived: boolean;
  lastAlert: AheadAlert | null;
  /** Segments du réseau chargés (indicateur de couverture). */
  networkSegments: number;
  /** Chargement du réseau en cours. */
  loadingNetwork: boolean;
}

export const EMPTY_LIVE: NavLive = {
  output: null,
  progress: null,
  instruction: null,
  nextEvent: null,
  events: [],
  offRoute: false,
  offRouteDistanceM: null,
  quality: "lost",
  searching: true,
  compassHeading: null,
  altitude: null,
  trackPoints: 0,
  stats: null,
  movingSpeedMs: null,
  arrived: false,
  lastAlert: null,
  networkSegments: 0,
  loadingNetwork: false,
};

export interface NavSession {
  mode: NavMode;
  route: NavRoute | null;
  /** Itinéraire d'origine quand `route` est un retour (revenir sur mes pas). */
  originalRoute: NavRoute | null;
  simulate: boolean;
  /** Réglages de simulation (démo / tests) : vitesse (m/s) et écart volontaire. */
  simulation?: { speedMs?: number; detour?: { fromAlong: number; toAlong: number; offsetM: number } | null };
  startedAt: number;
}

interface NavigationState {
  activity: ActivityMode;
  trackingMode: TrackingMode;
  voice: boolean;
  /** La caméra suit la position. */
  follow: boolean;
  status: NavStatus;
  session: NavSession | null;
  live: NavLive;
  /** Trace finale (après « Terminer ») pour le résumé et l'export. */
  finalTrack: TrackPoint[] | null;
  /** Trace brute correspondante : seule elle peut alimenter le réseau collectif. */
  finalRaw: RawPoint[] | null;
  /** Demande de retour au parcours affichée après une sortie d'itinéraire. */
  offRoutePrompt: boolean;
  setActivity: (a: ActivityMode) => void;
  setTrackingMode: (m: TrackingMode) => void;
  setVoice: (v: boolean) => void;
  setFollow: (v: boolean) => void;
  start: (session: Omit<NavSession, "startedAt">) => void;
  pause: () => void;
  resume: () => void;
  finish: (track: TrackPoint[], raw?: readonly RawPoint[]) => void;
  reset: () => void;
  setLive: (patch: Partial<NavLive>) => void;
  setOffRoutePrompt: (v: boolean) => void;
  /** Remplace l'itinéraire en cours (retour sur ses pas, continuer en mode libre). */
  switchRoute: (route: NavRoute | null, mode: NavMode) => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set, get) => ({
      activity: "hiking",
      trackingMode: "normal",
      voice: true,
      follow: true,
      status: "idle",
      session: null,
      live: EMPTY_LIVE,
      finalTrack: null,
      finalRaw: null,
      offRoutePrompt: false,
      setActivity: (activity) => set({ activity }),
      setTrackingMode: (trackingMode) => set({ trackingMode }),
      setVoice: (voice) => set({ voice }),
      setFollow: (follow) => set({ follow }),
      start: (session) => set({ status: "running", session: { ...session, startedAt: Date.now() }, live: EMPTY_LIVE, finalTrack: null, finalRaw: null, offRoutePrompt: false, follow: true }),
      pause: () => set({ status: get().status === "running" ? "paused" : get().status }),
      resume: () => set({ status: get().status === "paused" ? "running" : get().status }),
      finish: (track, raw) => set({ status: "finished", finalTrack: track, finalRaw: raw ? [...raw] : null, offRoutePrompt: false }),
      reset: () => set({ status: "idle", session: null, live: EMPTY_LIVE, finalTrack: null, finalRaw: null, offRoutePrompt: false }),
      setLive: (patch) => set({ live: { ...get().live, ...patch } }),
      setOffRoutePrompt: (offRoutePrompt) => set({ offRoutePrompt }),
      switchRoute: (route, mode) => {
        const s = get().session;
        if (!s) return;
        set({ session: { ...s, route, mode, originalRoute: mode === "route" && s.route && route && route.id !== s.route.id ? s.route : s.originalRoute }, offRoutePrompt: false, live: { ...get().live, offRoute: false, offRouteDistanceM: null, instruction: null, progress: null, arrived: false } });
      },
    }),
    {
      name: "ml.navigation",
      partialize: (s) => ({ activity: s.activity, trackingMode: s.trackingMode, voice: s.voice }),
    },
  ),
);
