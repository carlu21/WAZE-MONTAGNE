/**
 * Écran d'accueil — la carte (sections 1 à 6, 14, 26, 33 du cahier des charges
 * « Waze de la montagne »).
 *
 * L'application s'ouvre ICI. Pas de tableau de bord, pas de liste de
 * randonnées avant la carte : l'utilisateur voit sa position, les chemins
 * autour de lui, les signalements, et les randonnées qui l'entourent.
 *
 * Disposition, reprise de l'ergonomie de Waze et transposée à la montagne :
 *
 *   ┌─────────────────────────────┐
 *   │ [couches]              [🔔] │  boutons discrets, en haut
 *   │                             │
 *   │          CARTE              │  ~65 % de l'écran au repos
 *   │        ▲ position           │
 *   │   🥾 départs proposés       │
 *   │ [recentrer]      [SIGNALER] │  deux actions, grandes, atteignables au pouce
 *   ├─────────────────────────────┤
 *   │ ══  « Où va-t-on ? »        │  panneau glissant
 *   │ Randonnées autour de vous   │  ← remplace « Domicile / Travail »
 *   └─────────────────────────────┘
 *
 * La carte suit la position tant que l'utilisateur ne l'a pas déplacée
 * lui-même ; dès qu'il la déplace, le bouton « recentrer » s'impose.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Layers, LocateFixed, TriangleAlert } from "lucide-react";
import type { Map as MaplibreMap } from "maplibre-gl";
import {
  buildRoute,
  fr,
  type ActivityMode,
  type Basemap,
  type BBox,
  type NearbySort,
  type NearbyTrail,
} from "@mountain-live/core";
import { useQuery } from "@tanstack/react-query";
import { Fab, IconButton, Segmented, cn, toast, type SheetSnap } from "@/components/ui";
import { MapView, isMapAlive } from "@/components/map/MapView";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useUiStore } from "@/store/ui";
import { useGeolocation } from "@/features/map/useGeolocation";
import { useCompass } from "@/features/navigation/compass";
import { ReportsLayer } from "@/features/map/ReportsLayer";
import { useReports } from "@/features/map/useReports";
import { HomeLayers } from "@/features/home/HomeLayers";
import { HomeSheet, PEEK_HEIGHT, type DurationFilter } from "@/features/home/HomeSheet";
import { TrailPreviewSheet } from "@/features/home/TrailPreviewSheet";
import { useNearby } from "@/features/home/useNearby";
import { fitZoomFor } from "@/features/home/format";
import { useNavigationStore } from "@/features/navigation/store";

/** Zoom du premier centrage sur la position : on voit le vallon, pas le pays. */
export const HOME_ZOOM = 14;

const BASEMAPS: { value: Basemap; label: string }[] = [
  { value: "topo", label: "Topo" },
  { value: "satellite", label: "Satellite" },
  { value: "relief", label: "Relief" },
];

export default function HomePage() {
  const navigate = useNavigate();
  const mapRef = useRef<MaplibreMap | null>(null);

  const position = useUiStore((s) => s.position);
  const basemap = useUiStore((s) => s.basemap);
  const setBasemap = useUiStore((s) => s.setBasemap);
  const setView = useUiStore((s) => s.setView);
  const activityPref = useNavigationStore((s) => s.activity);

  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [following, setFollowing] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<NearbySort>("closest");
  const [activity, setActivity] = useState<ActivityMode | "all">("all");
  const [duration, setDuration] = useState<DurationFilter>("all");
  const [viewBBox, setViewBBox] = useState<BBox | null>(null);
  const [zoom, setZoom] = useState(HOME_ZOOM);
  const firstLocate = useRef(false);

  const geolocation = useGeolocation();
  const heading = useCompass(true);
  const nearby = useNearby({ activity, sort });
  // Signalements visibles : c'est la moitié de la promesse de l'écran.
  const { reports } = useReports(viewBBox, zoom);

  const trails = nearby.data?.trails ?? [];
  const selected: NearbyTrail | null = useMemo(
    () => trails.find((t) => t.id === selectedId) ?? null,
    [trails, selectedId],
  );

  // Tracé complet : chargé seulement à la sélection (section 15).
  const geometry = useQuery({
    queryKey: qk.trailGeometry(selectedId ?? ""),
    queryFn: () => api.trailGeometry(selectedId as string),
    enabled: selectedId !== null,
    staleTime: 30 * 60_000,
  });

  /** Recentre sur la position et reprend le suivi. */
  const recenter = useCallback(async () => {
    const map = mapRef.current;
    let target = position;
    if (!target) target = (await geolocation.request()) ? useUiStore.getState().position : null;
    if (!target || !isMapAlive(map)) {
      if (!target) toast.info(fr.errors.locationUnavailable);
      return;
    }
    setFollowing(true);
    map.easeTo({ center: [target.lng, target.lat], zoom: Math.max(map.getZoom(), HOME_ZOOM), duration: 600 });
  }, [position, geolocation]);

  // Premier centrage dès que la position arrive : l'écran s'ouvre sur SOI.
  useEffect(() => {
    if (firstLocate.current || !position) return;
    const map = mapRef.current;
    if (!isMapAlive(map)) return;
    firstLocate.current = true;
    map.jumpTo({ center: [position.lng, position.lat], zoom: HOME_ZOOM });
  }, [position]);

  // Suivi automatique de la progression, tant que l'utilisateur n'a pas pris la main (section 4).
  useEffect(() => {
    if (!following || !position || selectedId) return;
    const map = mapRef.current;
    if (!isMapAlive(map)) return;
    map.easeTo({ center: [position.lng, position.lat], duration: 800 });
  }, [following, position, selectedId]);

  /** Sélection d'une randonnée : la carte se recentre, la fiche monte (section 15). */
  const selectTrail = useCallback(
    (id: string) => {
      setSelectedId(id);
      setFollowing(false);
      setSnap("peek");
      const trail = trails.find((t) => t.id === id);
      const map = mapRef.current;
      if (!trail || !isMapAlive(map)) return;
      map.easeTo({
        center: [trail.trailhead.point.lng, trail.trailhead.point.lat],
        zoom: fitZoomFor(trail.lengthM),
        duration: 700,
      });
    },
    [trails],
  );

  /** Cadre le tracé complet dès qu'il est chargé : on voit la randonnée entière. */
  useEffect(() => {
    const coords = geometry.data?.coordinates;
    const map = mapRef.current;
    if (!coords || coords.length < 2 || !isMapAlive(map)) return;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lng, lat] of coords) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: { top: 90, bottom: 360, left: 40, right: 40 }, duration: 700, maxZoom: 15 },
    );
  }, [geometry.data]);

  const startTrail = useCallback(
    (trail: NearbyTrail) => {
      const coords = geometry.data?.coordinates;
      if (!coords || coords.length < 2) {
        toast.info("Tracé en cours de chargement…");
        return;
      }
      const route = buildRoute({
        id: `trail_${trail.id}`,
        name: trail.name,
        coordinates: coords,
        elevations: geometry.data?.elevations ?? null,
        source: "trail",
      });
      useNavigationStore.getState().start({ mode: "route", route, originalRoute: null, simulate: false });
      navigate("/navigate");
    },
    [geometry.data, navigate],
  );

  const guideToStart = useCallback(
    (trail: NearbyTrail) => {
      // Rejoindre le départ est un itinéraire à part entière : le planificateur
      // du réseau sait le calculer depuis la position réelle.
      navigate("/navigate", { state: { planTo: trail.trailhead.point, planLabel: trail.name } });
    },
    [navigate],
  );

  const closePreview = useCallback(() => {
    setSelectedId(null);
    setFollowing(true);
  }, []);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-bg">
      <MapView
        className="absolute inset-0"
        view={{ lat: position?.lat ?? useUiStore.getState().view.lat, lng: position?.lng ?? useUiStore.getState().view.lng, zoom: HOME_ZOOM }}
        basemap={basemap}
        padding={{ top: 0, bottom: PEEK_HEIGHT, left: 0, right: 0 }}
        aria-label="Carte de la montagne autour de vous"
        onReady={(map) => {
          mapRef.current = map;
          // Un geste de l'utilisateur coupe le suivi : c'est précisément ce qui
          // fait ressortir le bouton « recentrer » (section 5). Seuls les
          // déplacements portant un `originalEvent` viennent de lui — les
          // recadrages du programme n'en ont pas.
          const release = () => setFollowing(false);
          map.on("dragstart", release);
          map.on("rotatestart", release);
          map.on("zoomstart", (e) => {
            if ("originalEvent" in e && e.originalEvent) release();
          });
        }}
        onMoveEnd={(bbox, view) => {
          setViewBBox(bbox);
          setZoom(view.zoom);
          setView(view);
        }}
      >
        <HomeLayers
          trails={trails}
          selectedId={selectedId}
          selectedGeometry={geometry.data?.coordinates ?? null}
          heading={heading}
          onSelectTrail={selectTrail}
        />
        <ReportsLayer reports={reports} zoom={zoom} selectedId={null} onSelect={(id) => navigate(`/reports/${id}`)} />
      </MapView>

      {/* Couches cartographiques — discret, en haut à gauche (section 26). */}
      <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
        <IconButton
          aria-label="Fond de carte"
          aria-expanded={layersOpen}
          variant="glass"
          size={44}
          onClick={() => setLayersOpen((v) => !v)}
        >
          <Layers />
        </IconButton>
        {layersOpen && (
          <div className="ml-glass rounded-2xl p-1 shadow-md">
            <Segmented
              value={basemap}
              onChange={(v) => {
                setBasemap(v as Basemap);
                setLayersOpen(false);
              }}
              options={BASEMAPS}
              aria-label="Fond de carte"
            />
          </div>
        )}
      </div>

      {/* Les deux actions de la carte, au niveau du pouce, au-dessus du panneau. */}
      <div
        className="pointer-events-none absolute inset-x-0 z-10 flex items-end justify-between px-3"
        style={{ bottom: `calc(${PEEK_HEIGHT}px + 12px)` }}
      >
        <IconButton
          aria-label="Recentrer sur ma position"
          data-testid="home-recenter"
          variant="glass"
          size={52}
          onClick={recenter}
          className={cn("pointer-events-auto transition-opacity", following && position ? "opacity-80" : "opacity-100")}
        >
          <LocateFixed className={cn(following && position ? "text-muted" : "text-primary")} />
        </IconButton>

        {/* Signaler : l'action principale de la carte, orange sécurité (section 6).
            Un appui ouvre immédiatement les catégories de signalement. Ronde et
            grande — utilisable avec des gants, d'une seule main, au soleil. */}
        <span className="pointer-events-auto" data-testid="home-report">
          <Fab to="/report" label={fr.nav.report} icon={<TriangleAlert className="size-8" strokeWidth={2.5} aria-hidden />} />
        </span>
      </div>

      <HomeSheet
        snap={snap}
        onSnapChange={setSnap}
        nearby={nearby.data}
        isLoading={nearby.isLoading}
        hasPosition={nearby.hasPosition}
        selectedId={selectedId}
        onSelectTrail={selectTrail}
        onSearch={() => navigate("/map", { state: { openSearch: true } })}
        onLocate={recenter}
        sort={sort}
        onSortChange={setSort}
        activity={activity}
        onActivityChange={setActivity}
        duration={duration}
        onDurationChange={setDuration}
      />

      <TrailPreviewSheet trail={selected} onClose={closePreview} onStart={startTrail} onGuideToStart={guideToStart} />
    </div>
  );
}
