/**
 * Petite carte (fond OpenTopoMap) avec marqueurs colorés par catégorie,
 * pour la fiche de secteur et les tableaux de bord. Peu interactive (zoom/déplacement),
 * sans rotation ; les marqueurs cliquables ouvrent la fiche.
 */
import { useEffect, useRef } from "react";
import maplibregl, { type Map as MaplibreMap, type StyleSpecification } from "maplibre-gl";
import { CATEGORY_BY_ID, type BBox, type OfficialAlert, type Report, type Trail, type WaterPoint } from "@mountain-live/core";
import { cn } from "@/components/ui";

const TILES = ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png"];
const STYLE: StyleSpecification = {
  version: 8,
  sources: { topo: { type: "raster", tiles: TILES, tileSize: 256, maxzoom: 17, attribution: "© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)" } },
  layers: [{ id: "topo", type: "raster", source: "topo" }],
};

export interface MiniMapProps {
  center: { lat: number; lng: number };
  zoom?: number;
  bbox?: BBox | null;
  reports?: readonly Report[];
  alerts?: readonly OfficialAlert[];
  waterPoints?: readonly WaterPoint[];
  trails?: readonly Trail[];
  /** Points pondérés (tableau de bord) : cercles proportionnels. */
  heat?: readonly { lat: number; lng: number; count: number }[];
  onReportClick?: (report: Report) => void;
  interactive?: boolean;
  className?: string;
  "aria-label"?: string;
}

function markerEl(color: string, size = 18, title?: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "9999px";
  el.style.background = color;
  el.style.border = "2px solid #fff";
  el.style.boxShadow = "0 1px 4px rgba(0,0,0,.35)";
  el.style.cursor = "pointer";
  if (title) el.title = title;
  return el;
}

export function MiniMap({ center, zoom = 12, bbox = null, reports = [], alerts = [], waterPoints = [], trails = [], heat = [], onReportClick, interactive = true, className, "aria-label": ariaLabel }: MiniMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const clickRef = useRef(onReportClick);
  clickRef.current = onReportClick;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({ container: el, style: STYLE, center: [center.lng, center.lat], zoom, interactive, dragRotate: false, pitchWithRotate: false, attributionControl: { compact: true } });
    } catch {
      return;
    }
    map.touchZoomRotate?.disableRotation();
    mapRef.current = map;
    if (bbox) map.fitBounds([[bbox.west, bbox.south], [bbox.east, bbox.north]], { padding: 24, duration: 0, maxZoom: 14 });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // La carte n'est créée qu'une fois ; le centre initial ne pilote pas de re-création.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: maplibregl.Marker[] = [];
    for (const t of trails) {
      // Tracés : polyline simple via une couche GeoJSON après chargement du style.
      const id = `trail-${t.id}`;
      const add = () => {
        if (map.getSource(id)) return;
        map.addSource(id, { type: "geojson", data: { type: "Feature", geometry: t.geometry, properties: {} } });
        map.addLayer({ id, type: "line", source: id, paint: { "line-color": "#B45309", "line-width": 3, "line-opacity": 0.8 } });
      };
      if (map.isStyleLoaded()) add();
      else map.once("load", add);
    }
    for (const h of heat) {
      const size = Math.min(64, 16 + h.count * 6);
      const el = markerEl("rgba(200,52,31,.55)", size, `${h.count} signalements`);
      el.style.border = "1px solid rgba(200,52,31,.9)";
      markers.push(new maplibregl.Marker({ element: el }).setLngLat([h.lng, h.lat]).addTo(map));
    }
    for (const w of waterPoints) {
      markers.push(new maplibregl.Marker({ element: markerEl(w.lastState === "dry" ? "#8A949E" : "#1D6FA5", 12, w.name) }).setLngLat([w.lng, w.lat]).addTo(map));
    }
    for (const a of alerts) {
      markers.push(new maplibregl.Marker({ element: markerEl("#C9A227", 18, a.title) }).setLngLat([a.centroidLng, a.centroidLat]).addTo(map));
    }
    for (const r of reports) {
      const el = markerEl(CATEGORY_BY_ID[r.category]?.color ?? "#1F4D28", 18, r.subtype);
      el.style.opacity = String(r.fade ?? 1);
      el.addEventListener("click", () => clickRef.current?.(r));
      markers.push(new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(map));
    }
    return () => {
      for (const m of markers) m.remove();
      for (const t of trails) {
        const id = `trail-${t.id}`;
        try {
          if (map.getLayer(id)) map.removeLayer(id);
          if (map.getSource(id)) map.removeSource(id);
        } catch {
          /* carte détruite */
        }
      }
    };
  }, [reports, alerts, waterPoints, trails, heat]);

  return <div ref={ref} role="img" aria-label={ariaLabel ?? "Carte du secteur"} className={cn("h-56 w-full overflow-hidden rounded-xl bg-surface-2", className)} />;
}
