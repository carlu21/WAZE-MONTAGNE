/**
 * Carte MapLibre réutilisable (sections 3 et 10).
 *
 *   <MapView view={view} onMoveEnd={(bbox, view) => …} className="absolute inset-0">
 *     <ReportsLayer … />      // surcouches : useMapLayers() / useMap()
 *   </MapView>
 *
 * - Fond de carte : `basemap` (défaut : useUiStore().basemap), changé via
 *   `map.setStyle` + `keepOverlays` : les sources/couches `ml-*` et leurs
 *   données survivent au changement de fond. Si MapLibre doit recharger le
 *   style entièrement, `style.load` recharge les images de marqueurs et
 *   incrémente `styleVersion` : chaque surcouche réinstalle ses couches.
 * - Rotation et inclinaison désactivées (usage extérieur, une main), échelle
 *   et attribution compacte.
 * - `onMoveEnd(bbox, view)` est aussi appelé une fois au chargement.
 * - `onClick` n'est appelé que pour un clic hors des entités interactives.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
import maplibregl, { type Map as MaplibreMap, type MapMouseEvent, type PaddingOptions } from "maplibre-gl";
import type { Basemap, BBox, LatLng } from "@mountain-live/core";
import { useUiStore, type MapViewState } from "@/store/ui";
import { cn } from "@/components/ui/cn";
import { loadMarkerImages } from "./markers";
import { buildBasemapStyle, keepOverlays } from "./basemaps";
import { LAYER_IDS } from "./layers";

export interface MapClickEvent {
  lngLat: LatLng;
  point: { x: number; y: number };
  originalEvent: MouseEvent;
}

export interface MapViewProps {
  /** Vue initiale (non contrôlée : la carte garde ensuite la main). */
  view?: MapViewState;
  /** Fond de carte (défaut : préférence de l'interface). */
  basemap?: Basemap;
  /** Carte manipulable (défaut : true). false = aperçu statique. */
  interactive?: boolean;
  className?: string;
  /** Marge de cadrage en px (feuille basse ouverte…) : ne déplace pas la carte. */
  padding?: PaddingOptions | number;
  minZoom?: number;
  maxZoom?: number;
  /** Appelé à la fin de chaque déplacement et une fois au chargement. */
  onMoveEnd?: (bbox: BBox, view: MapViewState) => void;
  /** Appelé pendant le déplacement (à chaque image). */
  onMove?: (view: MapViewState) => void;
  /** Clic sur la carte hors d'une entité interactive. */
  onClick?: (event: MapClickEvent) => void;
  /** Carte créée et style chargé. */
  onReady?: (map: MaplibreMap) => void;
  showScale?: boolean;
  showAttribution?: boolean;
  "aria-label"?: string;
  children?: ReactNode;
}

export interface MapContextValue {
  map: MaplibreMap | null;
  /** Style et images de marqueurs chargés : les couches peuvent être ajoutées. */
  ready: boolean;
  /** Incrémenté à chaque rechargement complet du style (couches à réinstaller). */
  styleVersion: number;
}

const MapContext = createContext<MapContextValue>({ map: null, ready: false, styleVersion: 0 });

/** Accès à la carte depuis une surcouche. */
export function useMap(): MapContextValue {
  return useContext(MapContext);
}

/** Cartes détruites : les nettoyages de surcouches ne doivent plus les toucher. */
const removedMaps = new WeakSet<MaplibreMap>();

export function isMapAlive(map: MaplibreMap | null | undefined): map is MaplibreMap {
  return Boolean(map) && !removedMaps.has(map as MaplibreMap);
}

/**
 * Installe des sources et couches quand la carte est prête, les réinstalle
 * après un rechargement du style et les retire au démontage. `setup` doit être
 * idempotent (vérifier `map.getSource` / `map.getLayer`) et peut renvoyer une
 * fonction de nettoyage.
 */
export function useMapLayers(setup: (map: MaplibreMap) => void | (() => void), deps: DependencyList = []): void {
  const { map, ready, styleVersion } = useMap();
  const setupRef = useRef(setup);
  setupRef.current = setup;
  useEffect(() => {
    if (!map || !ready || !isMapAlive(map)) return;
    const cleanup = setupRef.current(map);
    return () => {
      if (typeof cleanup !== "function" || !isMapAlive(map)) return;
      try {
        cleanup();
      } catch {
        /* style déjà remplacé : rien à retirer */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready, styleVersion, ...deps]);
}

/** Couches dont un clic est traité par la surcouche (le clic générique est alors ignoré). */
const INTERACTIVE_LAYER_IDS: readonly string[] = [
  LAYER_IDS.reportsClusters,
  LAYER_IDS.reportsPoints,
  LAYER_IDS.selectedIcon,
  LAYER_IDS.alertsFill,
  LAYER_IDS.alertsPoints,
  LAYER_IDS.searchMarker,
];

export function boundsToBBox(map: MaplibreMap): BBox {
  const b = map.getBounds();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
}

export function currentView(map: MaplibreMap): MapViewState {
  const c = map.getCenter();
  return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
}

function normalizePadding(p: PaddingOptions | number | undefined): PaddingOptions {
  if (typeof p === "number") return { top: p, right: p, bottom: p, left: p };
  return { top: 0, right: 0, bottom: 0, left: 0, ...(p ?? {}) };
}

export function MapView({
  view,
  basemap,
  interactive = true,
  className,
  padding,
  minZoom = 4,
  maxZoom = 18,
  onMoveEnd,
  onMove,
  onClick,
  onReady,
  showScale = true,
  showAttribution = true,
  "aria-label": ariaLabel = "Carte",
  children,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [styleVersion, setStyleVersion] = useState(0);

  const storeBasemap = useUiStore((s) => s.basemap);
  const storeView = useUiStore((s) => s.view);
  const effectiveBasemap = basemap ?? storeBasemap;

  // Les rappels sont lus via des refs : la carte n'est jamais recréée pour un nouveau rappel.
  const callbacks = useRef({ onMoveEnd, onMove, onClick, onReady });
  callbacks.current = { onMoveEnd, onMove, onClick, onReady };
  const initialView = useRef(view ?? storeView);
  const initialBasemap = useRef(effectiveBasemap);
  const initialPadding = useRef(padding);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const v = initialView.current;
    const instance = new maplibregl.Map({
      container,
      style: buildBasemapStyle(initialBasemap.current),
      center: [v.lng, v.lat],
      zoom: v.zoom,
      minZoom,
      maxZoom,
      interactive,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      fadeDuration: 150,
      // Les tuiles raster n'ont pas besoin d'un pixelRatio > 2 (batterie, mémoire).
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    if (initialPadding.current !== undefined) instance.setPadding(normalizePadding(initialPadding.current));
    if (showAttribution) instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    if (showScale) instance.addControl(new maplibregl.ScaleControl({ maxWidth: 96, unit: "metric" }), "bottom-left");

    let disposed = false;

    const onStyleLoad = () => {
      // Après chaque (re)chargement complet du style : images de marqueurs, puis feu vert aux surcouches.
      void loadMarkerImages(instance).then(() => {
        if (disposed) return;
        setStyleVersion((n) => n + 1);
        setReady(true);
        callbacks.current.onReady?.(instance);
      });
    };
    const emitMoveEnd = () => callbacks.current.onMoveEnd?.(boundsToBBox(instance), currentView(instance));
    const onMoveFrame = () => callbacks.current.onMove?.(currentView(instance));
    const onMapClick = (e: MapMouseEvent) => {
      const handler = callbacks.current.onClick;
      if (!handler) return;
      const layers = INTERACTIVE_LAYER_IDS.filter((id) => instance.getLayer(id));
      if (layers.length > 0 && instance.queryRenderedFeatures(e.point, { layers }).length > 0) return;
      handler({ lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat }, point: { x: e.point.x, y: e.point.y }, originalEvent: e.originalEvent });
    };

    instance.on("style.load", onStyleLoad);
    instance.once("load", emitMoveEnd);
    instance.on("moveend", emitMoveEnd);
    instance.on("move", onMoveFrame);
    instance.on("click", onMapClick);
    setMap(instance);

    return () => {
      disposed = true;
      instance.off("style.load", onStyleLoad);
      instance.off("moveend", emitMoveEnd);
      instance.off("move", onMoveFrame);
      instance.off("click", onMapClick);
      removedMaps.add(instance);
      instance.remove();
      setMap(null);
      setReady(false);
    };
    // La carte n'est créée qu'une fois : les autres props sont appliquées par les effets ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changement de fond : nouveau style, surcouches conservées.
  const appliedBasemap = useRef(initialBasemap.current);
  useEffect(() => {
    if (!map || !isMapAlive(map) || appliedBasemap.current === effectiveBasemap) return;
    appliedBasemap.current = effectiveBasemap;
    map.setStyle(buildBasemapStyle(effectiveBasemap), { diff: true, transformStyle: keepOverlays });
  }, [map, effectiveBasemap]);

  // Marge de cadrage (sans déplacer la carte).
  const paddingKey = JSON.stringify(normalizePadding(padding));
  useEffect(() => {
    if (!map || !isMapAlive(map)) return;
    map.setPadding(JSON.parse(paddingKey) as PaddingOptions);
  }, [map, paddingKey]);

  useEffect(() => {
    if (!map || !isMapAlive(map)) return;
    map.setMinZoom(minZoom);
    map.setMaxZoom(maxZoom);
  }, [map, minZoom, maxZoom]);

  useEffect(() => {
    if (!map || !isMapAlive(map)) return;
    const handlers = [map.dragPan, map.scrollZoom, map.boxZoom, map.doubleClickZoom, map.touchZoomRotate, map.keyboard];
    for (const h of handlers) (interactive ? h.enable() : h.disable());
  }, [map, interactive]);

  return (
    <MapContext.Provider value={{ map, ready, styleVersion }}>
      <div
        ref={containerRef}
        role="region"
        aria-label={ariaLabel}
        className={cn("relative h-full w-full overflow-hidden bg-[#e8e2d4] outline-none", className)}
        data-map-ready={ready || undefined}
      />
      {map ? children : null}
    </MapContext.Provider>
  );
}
