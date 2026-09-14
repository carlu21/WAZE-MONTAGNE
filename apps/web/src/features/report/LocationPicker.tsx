/**
 * Mini-carte de positionnement du signalement (200 px) : marqueur central fixe,
 * carte déplaçable (« Déplacez la carte pour placer le point exactement. »),
 * position GPS de référence (point bleu + cercle de précision) et bouton
 * « Recentrer sur ma position ». Fond topographique OpenTopoMap (raster).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MaplibreMap, type StyleSpecification } from "maplibre-gl";
import { LocateFixed } from "lucide-react";
import { SUBTYPE_BY_ID, formatDistance, offsetPoint, t, type ReportSubtype } from "@mountain-live/core";
import { IconButton, cn } from "@/components/ui";
import { buildMarkerSvg, categoryColor, svgToDataUri } from "@/components/map/markers";
import { DEFAULT_VIEW, useUiStore } from "@/store/ui";
import type { DraftPosition } from "./wizardState";
import type { GpsFix } from "./useReportPosition";

export const OPENTOPO_TILES = [
  "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
  "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
  "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
];

const TOPO_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    topo: {
      type: "raster",
      tiles: OPENTOPO_TILES,
      tileSize: 256,
      maxzoom: 17,
      attribution: "© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)",
    },
  },
  layers: [{ id: "topo", type: "raster", source: "topo" }],
};

const GPS_SOURCE = "report-gps";
const GPS_COLOR = "#1D6FA5";
/** Zoom utilisé quand on recentre sur une position GPS (≈ 50 m de large sur mobile). */
export const PICKER_GPS_ZOOM = 16;
export const PICKER_MIN_ZOOM = 5;
export const PICKER_MAX_ZOOM = 17;

type GeoJSONData = Parameters<GeoJSONSource["setData"]>[0];

const EMPTY: GeoJSONData = { type: "FeatureCollection", features: [] };

/** Point GPS + polygone de précision (48 sommets) pour la couche de référence. */
function fixToGeoJson(fix: GpsFix | null): GeoJSONData {
  if (!fix) return EMPTY;
  const features: Array<{ type: "Feature"; geometry: { type: "Point"; coordinates: number[] } | { type: "Polygon"; coordinates: number[][][] }; properties: Record<string, never> }> = [
    { type: "Feature", geometry: { type: "Point", coordinates: [fix.lng, fix.lat] }, properties: {} },
  ];
  if (fix.accuracy && fix.accuracy > 5) {
    const ring: number[][] = [];
    for (let i = 0; i <= 48; i++) {
      const p = offsetPoint({ lat: fix.lat, lng: fix.lng }, fix.accuracy, (i * 360) / 48);
      ring.push([p.lng, p.lat]);
    }
    features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} });
  }
  return { type: "FeatureCollection", features } as GeoJSONData;
}

/** « 42,30512 N · 9,15044 E » */
export function formatCoords(lat: number, lng: number): string {
  const f = (n: number) => Math.abs(n).toFixed(5).replace(".", ",");
  return `${f(lat)} ${lat >= 0 ? "N" : "S"} · ${f(lng)} ${lng >= 0 ? "E" : "O"}`;
}

export interface LocationPickerProps {
  position: DraftPosition | null;
  /** Dernier relevé GPS (référence bleue), indépendant du point ajusté. */
  fix: GpsFix | null;
  subtype: ReportSubtype | null;
  onChange: (next: DraftPosition) => void;
  onRecenter: () => void;
  locating?: boolean;
  className?: string;
}

export function LocationPicker({ position, fix, subtype, onChange, onRecenter, locating = false, className }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const loadedRef = useRef(false);
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const positionRef = useRef(position);
  positionRef.current = position;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** Un geste utilisateur est en cours ou vient de se terminer (drag, molette, pincement, clavier). */
  const interactedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const pinUri = useMemo(() => {
    const def = subtype ? SUBTYPE_BY_ID[subtype] : null;
    return svgToDataUri(buildMarkerSvg({ icon: def?.icon ?? "map-pin", color: categoryColor(def?.category), size: 44, selected: true }));
  }, [subtype]);

  // Création de la carte (une seule fois).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const start = positionRef.current;
    const view = useUiStore.getState().view ?? DEFAULT_VIEW;
    const center: [number, number] = start ? [start.lng, start.lat] : [view.lng, view.lat];
    const zoom = start?.source === "gps" ? PICKER_GPS_ZOOM : Math.max(view.zoom, start?.adjusted ? PICKER_GPS_ZOOM - 1 : view.zoom);

    const map = new maplibregl.Map({
      container,
      style: TOPO_STYLE,
      center,
      zoom,
      minZoom: PICKER_MIN_ZOOM,
      maxZoom: PICKER_MAX_ZOOM,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    map.on("load", () => {
      map.addSource(GPS_SOURCE, { type: "geojson", data: fixToGeoJson(fixRef.current) });
      map.addLayer({
        id: `${GPS_SOURCE}-accuracy`,
        type: "fill",
        source: GPS_SOURCE,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": GPS_COLOR, "fill-opacity": 0.14 },
      });
      map.addLayer({
        id: `${GPS_SOURCE}-accuracy-line`,
        type: "line",
        source: GPS_SOURCE,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "line-color": GPS_COLOR, "line-opacity": 0.6, "line-width": 1.5 },
      });
      map.addLayer({
        id: `${GPS_SOURCE}-dot`,
        type: "circle",
        source: GPS_SOURCE,
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 7, "circle-color": GPS_COLOR, "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2.5 },
      });
      loadedRef.current = true;
    });

    const markInteraction = () => {
      interactedRef.current = true;
    };
    map.on("dragstart", () => {
      markInteraction();
      setDragging(true);
    });
    map.on("dragend", () => setDragging(false));
    map.on("wheel", markInteraction);
    map.on("touchstart", markInteraction);
    map.on("moveend", (e) => {
      // Seuls les déplacements initiés par l'utilisateur déplacent le point ;
      // recentrage programmatique et redimensionnement sont ignorés.
      const userMove = Boolean((e as { originalEvent?: unknown }).originalEvent) || interactedRef.current;
      interactedRef.current = false;
      if (!userMove) return;
      const c = map.getCenter();
      const prev = positionRef.current;
      onChangeRef.current({
        lat: c.lat,
        lng: c.lng,
        accuracy: prev?.accuracy ?? null,
        source: prev?.source ?? "map",
        adjusted: true,
      });
    });

    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => map.resize()) : null;
    ro?.observe(container);

    return () => {
      ro?.disconnect();
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Recentrage quand la position vient de l'extérieur (GPS, « Recentrer ») et non de la carte elle-même.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position || position.adjusted) return;
    const current = map.getCenter();
    const same = Math.abs(current.lat - position.lat) < 1e-7 && Math.abs(current.lng - position.lng) < 1e-7;
    const targetZoom = position.source === "gps" ? Math.max(map.getZoom(), PICKER_GPS_ZOOM) : map.getZoom();
    if (same && Math.abs(targetZoom - map.getZoom()) < 0.01) return;
    interactedRef.current = false;
    map.easeTo({ center: [position.lng, position.lat], zoom: targetZoom, duration: 450 });
  }, [position]);

  // Couche de référence GPS.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const src = map.getSource(GPS_SOURCE) as GeoJSONSource | undefined;
    src?.setData(fixToGeoJson(fix));
  }, [fix]);

  const accuracyText = fix?.accuracy != null ? t("wizard.positionAccuracy", { distance: formatDistance(fix.accuracy) }) : null;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={containerRef}
        className="relative h-[200px] w-full overflow-hidden rounded-2xl border-2 border-line bg-surface-2 [&_.maplibregl-ctrl-attrib]:text-[11px]"
        role="application"
        aria-label="Carte de positionnement : déplacez la carte pour placer le point du signalement"
        data-testid="location-picker"
      />
      {/* Marqueur central fixe : la pointe est exactement au centre de la carte. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-[2] transition-transform duration-150 ease-out"
        style={{ transform: dragging ? "translate(-50%, calc(-100% - 10px))" : "translate(-50%, -100%)" }}
        aria-hidden="true"
      >
        <img src={pinUri} width={44} height={53} alt="" draggable={false} />
      </div>
      <span className="pointer-events-none absolute left-1/2 top-1/2 z-[2] size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg/70 ring-2 ring-white" aria-hidden="true" />

      {position ? (
        <div className="pointer-events-none absolute bottom-2 left-2 z-[2] flex max-w-[calc(100%-72px)] flex-col gap-1">
          <span className="glass-strong tabular truncate rounded-md px-2 py-1 text-[12px] font-semibold text-fg shadow-sm">{formatCoords(position.lat, position.lng)}</span>
          {accuracyText ? <span className="glass-strong truncate rounded-md px-2 py-1 text-[12px] text-muted shadow-sm">{accuracyText}</span> : null}
        </div>
      ) : null}

      <div className="absolute bottom-2 right-2 z-[2]">
        <IconButton aria-label="Recentrer sur ma position" size={52} variant="glass" shape="round" onClick={onRecenter} loading={locating}>
          <LocateFixed />
        </IconButton>
      </div>
    </div>
  );
}
