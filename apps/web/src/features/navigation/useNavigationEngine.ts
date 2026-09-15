/**
 * Moteur temps réel (sections 1, 2, 7, 11, 21, 22) : relie la source de
 * position (GPS, simulation, source externe), le chargement du réseau, les
 * données d'événements et le réducteur de navigation de @mountain-live/core ;
 * publie un instantané dans le store et déclenche les effets (toasts,
 * vibration, guidage vocal, persistance de la trace).
 *
 * Monté une seule fois dans l'application (NavigationEngineHost) : quitter
 * l'écran de navigation — par exemple pour signaler — n'interrompt pas le suivi.
 */
import { useEffect, useRef } from "react";
import {
  TRACKING_PROFILES,
  accuracyQuality,
  collectRouteEvents,
  computeManeuvers,
  createNavState,
  deadReckon,
  fr,
  navigationStep,
  trackStats,
  type GpsFix,
  type Maneuver,
  type NavContext,
  type NavState,
  type RouteEvent,
  type TrackPoint,
} from "@mountain-live/core";
import { toast } from "@/lib/toast";
import { useUiStore } from "@/store/ui";
import { currentCompassHeading } from "./compass";
import { loadNavData, routeBBox, type NavData } from "./data";
import { NetworkLoader } from "./network";
import { GeolocationSource, SimulationSource, type PositionSource } from "./sources";
import { speak, stopSpeaking, vibrate } from "./speech";
import { useNavigationStore } from "./store";
import { clearCurrentTrack, persistCurrentTrack } from "./tracks";
import { keepScreenAwake, releaseScreen } from "./wakeLock";

/** Intervalle de rafraîchissement des événements (ms). */
export const DATA_REFRESH_MS = 120_000;
/** Nouvelle emprise d'événements en mode libre au-delà de cette distance (m). */
const DATA_MOVE_M = 1000;
const STALE_CHECK_MS = 5000;

export function useNavigationEngine(): void {
  const status = useNavigationStore((s) => s.status);
  const session = useNavigationStore((s) => s.session);
  const trackingMode = useNavigationStore((s) => s.trackingMode);
  const routeId = session?.route?.id ?? null;
  const mode = session?.mode ?? null;
  const simulate = session?.simulate ?? false;

  const navState = useRef<NavState>(createNavState());
  const source = useRef<PositionSource | null>(null);
  const loader = useRef<NetworkLoader>(getLoader());
  const maneuvers = useRef<Maneuver[]>([]);
  const routeEvents = useRef<RouteEvent[]>([]);
  const data = useRef<NavData | null>(null);
  const dataCenter = useRef<{ lat: number; lng: number } | null>(null);
  const lastFixAt = useRef(0);
  const persistedPoints = useRef(0);
  const shownToasts = useRef(new Set<string>());

  // Recalcule manœuvres et événements de l'itinéraire (graphe ou données changés).
  const recomputeRoute = () => {
    const s = useNavigationStore.getState().session;
    const graph = loader.current?.graph ?? null;
    if (!s?.route || !graph) {
      maneuvers.current = [];
      routeEvents.current = [];
      return;
    }
    maneuvers.current = computeManeuvers(s.route, graph);
    const d = data.current;
    routeEvents.current = collectRouteEvents(s.route, {
      reports: d?.reports ?? [],
      officialAlerts: d?.officialAlerts ?? [],
      waterPoints: d?.waterPoints ?? [],
      segments: loader.current?.segmentsAlong(s.route) ?? [],
    });
    useNavigationStore.getState().setLive({ events: routeEvents.current, networkSegments: graph.segments.size });
  };

  const refreshData = async (center?: { lat: number; lng: number }) => {
    const s = useNavigationStore.getState().session;
    if (!s) return;
    const bbox = s.route ? routeBBox(s.route.coordinates) : center ? routeBBox([[center.lng, center.lat]], 2.5) : null;
    if (!bbox) return;
    data.current = await loadNavData(bbox);
    if (center) dataCenter.current = center;
    recomputeRoute();
  };

  // Session : démarrage / arrêt de la source et du chargement.
  useEffect(() => {
    if (status !== "running" || !session) {
      source.current?.stop();
      source.current = null;
      return;
    }
    const store = useNavigationStore.getState();
    const unsubscribe = loader.current.onChange(() => {
      recomputeRoute();
      store.setLive({ networkSegments: loader.current?.graph.segments.size ?? 0, loadingNetwork: loader.current?.loading ?? false });
    });
    if (session.route) {
      void loader.current.ensureRoute(session.route).then(() => store.setLive({ loadingNetwork: false }));
      store.setLive({ loadingNetwork: true });
    }
    void refreshData();
    recomputeRoute();

    const onFix = (fix: GpsFix) => {
      const st = useNavigationStore.getState();
      if (st.status !== "running" || !st.session) return;
      lastFixAt.current = Date.now();
      if (st.live.searching) st.setLive({ searching: false });
      useUiStore.getState().setPosition({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy === null ? null : Math.round(fix.accuracy), at: fix.at });
      const ld = loader.current!;
      void ld.ensureAround(fix).then(() => st.setLive({ loadingNetwork: ld.loading }));
      if (!st.session.route) {
        const c = dataCenter.current;
        if (!c || Math.hypot((c.lat - fix.lat) * 111_320, (c.lng - fix.lng) * 111_320 * Math.cos((fix.lat * Math.PI) / 180)) > DATA_MOVE_M) void refreshData({ lat: fix.lat, lng: fix.lng });
      }
      const ctx: NavContext = {
        graph: ld.graph,
        activity: st.activity,
        route: st.session.route,
        maneuvers: maneuvers.current,
        events: routeEvents.current,
        reports: data.current?.reports ?? [],
        officialAlerts: data.current?.officialAlerts ?? [],
        waterPoints: data.current?.waterPoints ?? [],
        compassHeading: currentCompassHeading(),
      };
      const step = navigationStep(navState.current, ctx, fix, Date.now());
      navState.current = step.state;
      engineTrack.current = step.state.track;
      const points = step.state.track.length;
      st.setLive({
        output: step.output,
        progress: step.progress,
        instruction: step.instruction,
        nextEvent: step.nextEvent,
        events: st.session.route ? routeEvents.current : step.events,
        offRoute: step.state.offRoute.offRoute,
        offRouteDistanceM: step.state.offRoute.offRoute && step.progress ? Math.round(step.progress.distanceToRouteM) : null,
        quality: step.output.quality,
        compassHeading: ctx.compassHeading ?? null,
        altitude: fix.altitude !== null && Number.isFinite(fix.altitude) ? fix.altitude : st.live.altitude,
        trackPoints: points,
        stats: points > 1 && (step.trackPointAdded || points % 5 === 0) ? trackStats(step.state.track) : st.live.stats,
        movingSpeedMs: step.state.movingSpeedMs,
        arrived: step.state.arrived,
        lastAlert: step.alerts[0] ?? st.live.lastAlert,
      });

      // Effets : alertes, instructions, sortie / retour d'itinéraire, arrivée.
      for (const a of step.alerts.slice(0, 2)) {
        shownToasts.current.add(`nav:${a.key}`);
        toast.show({ id: `nav:${a.key}`, title: a.message, tone: a.tone, duration: a.tone === "info" ? 8000 : 0, assertive: a.tone !== "info", action: a.event.reportId ? { label: "Voir", onClick: () => window.location.assign(`/reports/${a.event.reportId}`) } : undefined });
        if (a.sound) vibrate(a.tone === "danger" ? [200, 100, 200] : 200);
        if (st.voice && (a.sound || a.level >= 2)) speak(a.message, { priority: a.tone === "danger" ? "high" : "normal" });
      }
      if (step.announceInstruction && step.instruction && st.voice) speak(step.instruction.text, { priority: step.instruction.distanceM <= 25 ? "high" : "normal" });
      if (step.offRouteChange === "left") {
        for (const k of shownToasts.current) toast.dismiss(k);
        shownToasts.current.clear();
        st.setOffRoutePrompt(true);
        vibrate([150, 80, 150]);
        if (st.voice) speak(fr.navigation.offRoute, { priority: "high" });
      } else if (step.offRouteChange === "back") {
        toast.success(fr.navigation.backOnRoute);
        if (st.voice) speak(fr.navigation.backOnRoute);
      }
      if (step.justArrived) {
        toast.success(fr.navigation.instructions.arrived);
        vibrate([100, 60, 100, 60, 300]);
        if (st.voice) speak(fr.navigation.instructions.arrived, { priority: "high" });
      }
      if (points - persistedPoints.current >= 20) {
        persistedPoints.current = points;
        void persistCurrentTrack(st.activity, step.state.track);
      }
    };

    const src: PositionSource =
      session.simulate && session.route
        ? new SimulationSource(session.route, { speedMs: session.simulation?.speedMs ?? 1.4 * 6, intervalMs: 700, detour: session.simulation?.detour ?? null })
        : new GeolocationSource(trackingMode);
    source.current = src;
    lastFixAt.current = Date.now();
    src.start(
      onFix,
      (message, code) => {
        toast.warning(code === "denied" ? fr.navigation.gpsDenied : message);
        if (code === "denied") useNavigationStore.getState().setLive({ quality: "lost", searching: false });
      },
      (sourceStatus) => useNavigationStore.getState().setLive({ searching: sourceStatus === "searching" }),
    );
    // L'écran verrouillé suspend la page (et donc le GPS) : on le maintient allumé.
    if (!session.simulate) keepScreenAwake();

    /*
     * Signal perdu : mesuré sur l'heure de RÉCEPTION du dernier relevé (et non
     * sur l'horodatage du récepteur, peu fiable selon les appareils), avec un
     * délai adapté au mode de suivi. La position continue d'avancer à l'estime
     * le long du chemin (section 22) ; la source relance l'écoute de son côté.
     */
    const staleAfterMs = TRACKING_PROFILES[trackingMode].staleAfterMs;
    const stale = window.setInterval(() => {
      const st = useNavigationStore.getState();
      const out = st.live.output;
      if (!out || st.status !== "running") return;
      const silentMs = Date.now() - lastFixAt.current;
      const q = silentMs > staleAfterMs ? "lost" : accuracyQuality(out.accuracy);
      if (q === st.live.quality) return;
      if (q === "lost") st.setLive({ quality: "lost", output: { ...out, position: deadReckon(out, Date.now()), quality: "lost" } });
      else {
        // Retour du signal : la position reprend sans saut (interpolation de la couche).
        if (st.live.quality === "lost") toast.success(fr.navigation.gpsBack);
        st.setLive({ quality: q });
      }
    }, STALE_CHECK_MS);
    const refresh = window.setInterval(() => void refreshData(dataCenter.current ?? undefined), DATA_REFRESH_MS);

    return () => {
      src.stop();
      source.current = null;
      unsubscribe();
      window.clearInterval(stale);
      window.clearInterval(refresh);
      stopSpeaking();
      releaseScreen();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, routeId, mode, simulate, trackingMode]);

  // Nouvelle session : état du moteur remis à zéro ; fin : trace finale publiée.
  const sessionStartedAt = session?.startedAt ?? null;
  useEffect(() => {
    if (sessionStartedAt === null) return;
    navState.current = createNavState();
    engineTrack.current = [];
    maneuvers.current = [];
    routeEvents.current = [];
    data.current = null;
    dataCenter.current = null;
    persistedPoints.current = 0;
  }, [sessionStartedAt]);

  // Changement d'itinéraire en cours de session (retour sur ses pas, mode libre) : progression réinitialisée.
  useEffect(() => {
    if (status !== "running") return;
    navState.current = { ...navState.current, routeAlong: null, progress: null, offRoute: { offRoute: false, consecutive: 0, sinceAt: null, thresholdM: 30 }, lastInstructionKey: null, arrived: false, announced: new Map() };
    recomputeRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, mode]);

  // Fin : trace finale (le store la conserve pour le résumé), trace en cours effacée.
  useEffect(() => {
    if (status !== "finished") return;
    const st = useNavigationStore.getState();
    if (!st.finalTrack || st.finalTrack.length === 0) st.finish(navState.current.track);
    void clearCurrentTrack();
  }, [status]);
}

/** Chargeur de réseau partagé (le graphe survit d'une session à l'autre). */
const sharedLoader = { current: null as NetworkLoader | null };
function getLoader(): NetworkLoader {
  if (!sharedLoader.current) sharedLoader.current = new NetworkLoader();
  return sharedLoader.current;
}

/** Trace en cours, lue sans re-rendu (« Terminer », « Revenir sur mes pas »). */
const engineTrack = { current: [] as TrackPoint[] };

/** GeoJSON des segments chargés (couche « réseau » de la carte de navigation). */
export function networkGraphSnapshot(): { type: "FeatureCollection"; features: { type: "Feature"; geometry: { type: "LineString"; coordinates: [number, number][] }; properties: { id: string; kind: string; name: string | null } }[] } {
  const graph = getLoader().graph;
  const features = [] as ReturnType<typeof networkGraphSnapshot>["features"];
  for (const seg of graph.segments.values()) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: seg.coordinates.map((c) => [c[0], c[1]]) }, properties: { id: seg.id, kind: seg.kind, name: seg.name } });
  }
  return { type: "FeatureCollection", features };
}

export function currentTrack(): TrackPoint[] {
  return engineTrack.current;
}
