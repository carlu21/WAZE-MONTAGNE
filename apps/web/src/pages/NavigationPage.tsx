/**
 * Navigation temps réel sur les sentiers (module « Waze de la montagne »).
 * C'est l'écran d'accueil de l'application (« Démarrer un itinéraire »).
 *
 * Trois états : accueil / préparation (dans la coquille, avec la barre de
 * navigation), activité en cours (superposition plein écran au-dessus de la
 * coquille : carte + affichage tête haute, marqueur rattaché au chemin, fil
 * d'Ariane, alertes devant soi, sortie d'itinéraire), résumé de fin.
 * Le moteur tourne dans NavigationEngineHost : cet écran ne fait qu'afficher
 * et piloter (démarrer, pause, terminer, revenir sur ses pas, recentrer).
 *
 * Paramètres : ?trail=<id> (itinéraire présélectionné), ?mode=free,
 * ?simulate=1 (GPS simulé), ?autostart=1 (démarrage immédiat, démo / tests),
 * ?speed=<m/s> et ?detour=1 (réglages de la simulation pour les tests).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { Map as MaplibreMap } from "maplibre-gl";
import { backtrackRoute, compassLabel, formatDistance, fr, interpolate, returnGuidance, routeFromTrail, type LatLng, type NavRoute } from "@mountain-live/core";
import { Button, Modal, PageLoader, toast } from "@/components/ui";
import { MapView, isMapAlive } from "@/components/map/MapView";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useUiStore } from "@/store/ui";
import { NavLayers } from "@/features/navigation/NavLayers";
import { NavHud } from "@/features/navigation/NavHud";
import { NavSetup } from "@/features/navigation/NavSetup";
import { NavSummary } from "@/features/navigation/NavSummary";
import { requestCompassPermission, useCompass } from "@/features/navigation/compass";
import { useNavigationStore, type NavMode } from "@/features/navigation/store";
import { currentTrack } from "@/features/navigation/useNavigationEngine";
import { stopSpeaking } from "@/features/navigation/speech";

const FOLLOW_ZOOM = 15.5;

export default function NavigationPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = useNavigationStore((s) => s.status);
  const session = useNavigationStore((s) => s.session);
  const live = useNavigationStore((s) => s.live);
  const follow = useNavigationStore((s) => s.follow);
  const setFollow = useNavigationStore((s) => s.setFollow);
  const offRoutePrompt = useNavigationStore((s) => s.offRoutePrompt);
  const finalTrack = useNavigationStore((s) => s.finalTrack);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [returnTarget, setReturnTarget] = useState<LatLng | null>(null);
  const autoStarted = useRef(false);

  useCompass(status === "running");

  // Pendant l'activité, les toasts (alertes) s'empilent au-dessus de la barre de statistiques.
  useEffect(() => {
    if (status !== "running" && status !== "paused") return;
    const root = document.documentElement.style;
    root.setProperty("--shell-bottom", "calc(var(--safe-bottom) + 96px)");
    return () => {
      root.removeProperty("--shell-bottom");
    };
  }, [status]);

  // Itinéraire présélectionné par l'URL.
  const trailId = params.get("trail");
  const trailQuery = useQuery({ queryKey: qk.trail(trailId ?? ""), queryFn: () => api.trail(trailId!), enabled: Boolean(trailId) && status === "idle", staleTime: 60 * 60_000 });
  const presetRoute = useMemo<NavRoute | null>(() => (trailQuery.data ? routeFromTrail(trailQuery.data.trail) : null), [trailQuery.data]);
  const presetMode = (params.get("mode") as NavMode | null) ?? null;
  const presetSimulate = params.get("simulate") === "1";

  const start = useCallback(
    async (input: { mode: NavMode; route: NavRoute | null; simulate: boolean }) => {
      if (!input.simulate) {
        if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
          toast.warning(fr.errors.locationUnavailable);
          return;
        }
        void requestCompassPermission();
      }
      const speed = Number(params.get("speed"));
      const detour = params.get("detour") === "1" ? { fromAlong: 400, toAlong: 900, offsetM: 80 } : null;
      useNavigationStore.getState().start({
        mode: input.mode,
        route: input.route,
        originalRoute: null,
        simulate: input.simulate,
        simulation: input.simulate ? { speedMs: Number.isFinite(speed) && speed > 0 ? speed : undefined, detour } : undefined,
      });
      setReturnTarget(null);
      if (params.has("autostart")) {
        const next = new URLSearchParams(params);
        next.delete("autostart");
        setParams(next, { replace: true });
      }
    },
    [params, setParams],
  );

  // Démarrage automatique (démo / tests) une fois l'itinéraire chargé.
  useEffect(() => {
    if (autoStarted.current || status !== "idle" || params.get("autostart") !== "1") return;
    if (trailId && !presetRoute) return;
    autoStarted.current = true;
    void start({ mode: presetMode ?? (presetRoute ? "route" : "free"), route: presetRoute, simulate: presetSimulate && presetRoute !== null });
  }, [status, params, trailId, presetRoute, presetMode, presetSimulate, start]);

  // Caméra : suit la position (zoom 15,5) tant que l'utilisateur n'a pas déplacé la carte.
  const position = live.output?.position ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMapAlive(map) || !position || !follow) return;
    map.easeTo({ center: [position.lng, position.lat], zoom: Math.max(map.getZoom(), FOLLOW_ZOOM), duration: 600, essential: true });
  }, [position?.lat, position?.lng, follow]);

  const onReady = useCallback((map: MaplibreMap) => {
    mapRef.current = map;
    map.on("dragstart", () => useNavigationStore.getState().setFollow(false));
    const s = useNavigationStore.getState();
    const pos = s.live.output?.position;
    if (pos) map.jumpTo({ center: [pos.lng, pos.lat], zoom: FOLLOW_ZOOM });
    else if (s.session?.route) {
      const c = s.session.route.coordinates;
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const [lng, lat] of c) {
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
      map.fitBounds([west, south, east, north], { padding: 60, duration: 0, maxZoom: 15 });
    } else {
      const p = useUiStore.getState().position;
      if (p) map.jumpTo({ center: [p.lng, p.lat], zoom: FOLLOW_ZOOM });
    }
  }, []);

  // Sortie d'itinéraire : consigne de retour (point le plus proche, distance, direction).
  const route = session?.route ?? null;
  const returnText = useMemo(() => {
    if (!route || !live.offRoute || !live.output || !returnTarget) return null;
    const g = returnGuidance(route, live.output.position, live.progress?.along ?? null);
    if (!g) return null;
    return interpolate(fr.navigation.guidanceToRoute, { distance: formatDistance(g.distanceM), direction: compassLabel(g.bearing) });
  }, [route, live.offRoute, live.output, live.progress?.along, returnTarget]);
  useEffect(() => {
    if (!live.offRoute) setReturnTarget(null);
    else if (returnTarget && route && live.output) {
      const g = returnGuidance(route, live.output.position, live.progress?.along ?? null);
      if (g) setReturnTarget(g.target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.offRoute, live.output]);

  const onReturnToRoute = () => {
    const st = useNavigationStore.getState();
    st.setOffRoutePrompt(false);
    if (route && st.live.output) {
      const g = returnGuidance(route, st.live.output.position, st.live.progress?.along ?? null);
      if (g) setReturnTarget(g.target);
    }
    setFollow(true);
  };
  const onContinueFree = () => {
    useNavigationStore.getState().switchRoute(null, "free");
    setReturnTarget(null);
    toast.info(fr.navigation.instructions.freeMode);
  };
  const onBacktrack = () => {
    const track = currentTrack();
    if (track.length < 2) return;
    useNavigationStore.getState().switchRoute(backtrackRoute(track), "route");
    setReturnTarget(null);
    setFollow(true);
    toast.info(fr.navigation.backtrackStarted);
  };
  const onStop = () => {
    const st = useNavigationStore.getState();
    st.finish(currentTrack());
    stopSpeaking();
    // Les alertes de l'activité n'ont plus lieu d'être (et ne doivent pas recouvrir le résumé).
    toast.clear();
    setStopConfirm(false);
  };
  const onDone = () => {
    useNavigationStore.getState().reset();
    navigate("/navigate", { replace: true });
  };
  const onReport = () => navigate("/report", { state: { from: "/navigate" } });

  if (trailId && trailQuery.isLoading && status === "idle") return <PageLoader />;

  if (status === "idle" || status === "finished") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-bg">
        <main className="min-h-0 flex-1 overflow-y-auto">
          {status === "finished" ? <NavSummary track={finalTrack ?? []} onDone={onDone} /> : <NavSetup presetRoute={presetRoute} presetMode={presetMode} presetSimulate={presetSimulate} onStart={(i) => void start(i)} />}
        </main>
      </div>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-drawer)] overflow-hidden bg-bg" data-testid="nav-page">
      <MapView className="absolute inset-0" onReady={onReady} aria-label="Carte de navigation" minZoom={6} maxZoom={19}>
        <NavLayers route={route} returnTarget={returnTarget} />
      </MapView>
      <NavHud
        route={route}
        returnGuidanceText={returnText}
        onRecenter={() => {
          setFollow(true);
          const map = mapRef.current;
          if (map && isMapAlive(map) && position) map.easeTo({ center: [position.lng, position.lat], zoom: Math.max(map.getZoom(), FOLLOW_ZOOM), duration: 500 });
        }}
        onReport={onReport}
        onBacktrack={onBacktrack}
        onPauseToggle={() => (status === "paused" ? useNavigationStore.getState().resume() : useNavigationStore.getState().pause())}
        onStop={() => setStopConfirm(true)}
      />

      <Modal open={offRoutePrompt} onClose={() => useNavigationStore.getState().setOffRoutePrompt(false)} title={fr.navigation.offRoute} description={live.offRouteDistanceM !== null ? interpolate(fr.navigation.offRouteBody, { distance: formatDistance(live.offRouteDistanceM) }) : undefined} tone="danger" aria-label={fr.navigation.offRoute}>
        <div className="flex flex-col gap-2" data-testid="nav-offroute">
          <Button size="lg" onClick={onReturnToRoute} fullWidth>
            {fr.navigation.returnToRoute}
          </Button>
          <Button size="lg" variant="secondary" onClick={onContinueFree} fullWidth>
            {fr.navigation.continueFree}
          </Button>
        </div>
      </Modal>

      <Modal open={stopConfirm} onClose={() => setStopConfirm(false)} title={fr.navigation.stopConfirm} description={fr.navigation.stopBody} footer={
        <>
          <Button variant="ghost" onClick={() => setStopConfirm(false)}>
            {fr.common.cancel}
          </Button>
          <Button variant="danger" onClick={onStop} data-testid="nav-stop-confirm">
            {fr.navigation.stop}
          </Button>
        </>
      } />
    </div>,
    document.body,
  );
}
