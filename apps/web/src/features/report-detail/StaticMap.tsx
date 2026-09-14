/**
 * Petite carte non interactive centrée sur un point (fiche de signalement, secteur).
 * Fond OpenTopoMap. Pour un signalement flouté, un halo « position approximative »
 * remplace le point précis (section 8).
 */
import { useEffect, useRef } from "react";
import maplibregl, { type Map as MaplibreMap, type StyleSpecification } from "maplibre-gl";
import { fr } from "@mountain-live/core";
import { cn } from "@/components/ui";

export const STATIC_TILES = ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png"];

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    topo: { type: "raster", tiles: STATIC_TILES, tileSize: 256, maxzoom: 17, attribution: "© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)" },
  },
  layers: [{ id: "topo", type: "raster", source: "topo" }],
};

export interface StaticMapProps {
  lat: number;
  lng: number;
  zoom?: number;
  color?: string;
  /** Halo de position approximative (rayon en mètres) au lieu d'un point précis. */
  blurRadiusM?: number | null;
  className?: string;
  "aria-label"?: string;
}

export function StaticMap({ lat, lng, zoom = 14, color = "#1F4D28", blurRadiusM = null, className, "aria-label": ariaLabel }: StaticMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container: el,
        style: STYLE,
        center: [lng, lat],
        zoom,
        interactive: false,
        attributionControl: { compact: true },
      });
    } catch {
      return;
    }
    mapRef.current = map;
    const el2 = document.createElement("div");
    if (blurRadiusM) {
      el2.className = "rounded-full border-2";
      el2.style.width = "48px";
      el2.style.height = "48px";
      el2.style.borderColor = color;
      el2.style.background = `${color}33`;
      el2.setAttribute("title", fr.sheet.blurred);
    } else {
      el2.className = "rounded-full border-[3px] border-white shadow-md";
      el2.style.width = "22px";
      el2.style.height = "22px";
      el2.style.background = color;
    }
    const marker = new maplibregl.Marker({ element: el2 }).setLngLat([lng, lat]).addTo(map);
    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [lat, lng, zoom, color, blurRadiusM]);

  return <div ref={ref} role="img" aria-label={ariaLabel ?? "Carte de situation"} className={cn("h-40 w-full overflow-hidden rounded-xl bg-surface-2", className)} />;
}
