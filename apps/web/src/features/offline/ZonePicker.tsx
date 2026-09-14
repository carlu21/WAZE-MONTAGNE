/**
 * Sélecteur de zone à télécharger : la zone est le cadre visible de cette carte
 * (déplacez / zoomez pour l'ajuster). Fond OpenTopoMap.
 */
import { useEffect, useRef } from "react";
import maplibregl, { type Map as MaplibreMap, type StyleSpecification } from "maplibre-gl";
import type { BBox } from "@mountain-live/core";
import { cn } from "@/components/ui";

const TILES = ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png"];
const STYLE: StyleSpecification = {
  version: 8,
  sources: { topo: { type: "raster", tiles: TILES, tileSize: 256, maxzoom: 17, attribution: "© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)" } },
  layers: [{ id: "topo", type: "raster", source: "topo" }],
};

export interface ZonePickerProps {
  initial: BBox | { lat: number; lng: number; zoom: number };
  onChange: (bbox: BBox) => void;
  className?: string;
}

export function ZonePicker({ initial, onChange, className }: ZonePickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let map: MaplibreMap;
    try {
      map = new maplibregl.Map({
        container: el,
        style: STYLE,
        center: "lat" in initial ? [initial.lng, initial.lat] : [(initial.west + initial.east) / 2, (initial.south + initial.north) / 2],
        zoom: "zoom" in initial ? initial.zoom : 11,
        minZoom: 8,
        maxZoom: 15,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
      });
    } catch {
      return;
    }
    map.touchZoomRotate?.disableRotation();
    const emit = () => {
      const b = map.getBounds();
      onChangeRef.current({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    };
    map.on("load", () => {
      if (!("lat" in initial)) map.fitBounds([[initial.west, initial.south], [initial.east, initial.north]], { padding: 8, duration: 0 });
      emit();
    });
    map.on("moveend", emit);
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn("relative", className)}>
      <div ref={ref} className="h-64 w-full overflow-hidden rounded-xl bg-surface-2" role="application" aria-label="Sélection de la zone à télécharger" />
      <div className="pointer-events-none absolute inset-2 rounded-lg border-2 border-dashed border-accent" aria-hidden="true" />
    </div>
  );
}
