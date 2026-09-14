/**
 * Saisie d'une géométrie pour une alerte officielle : point (clic) ou polygone
 * (clics successifs, « Fermer le polygone »). Fond OpenTopoMap.
 */
import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MaplibreMap, type StyleSpecification } from "maplibre-gl";
import type { Feature } from "geojson";
import type { GeoJsonGeometry } from "@mountain-live/core";
import { Button, Segmented } from "@/components/ui";

const TILES = ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"];
const STYLE: StyleSpecification = {
  version: 8,
  sources: { topo: { type: "raster", tiles: TILES, tileSize: 256, maxzoom: 17, attribution: "© OpenStreetMap, SRTM · © OpenTopoMap (CC-BY-SA)" } },
  layers: [{ id: "topo", type: "raster", source: "topo" }],
};

type Mode = "point" | "polygon";
export type AlertGeometry = Extract<GeoJsonGeometry, { type: "Point" | "Polygon" }>;

export function GeometryPicker({ value, onChange, center = { lat: 42.25, lng: 9.05 }, zoom = 9 }: { value: AlertGeometry | null; onChange: (g: AlertGeometry | null) => void; center?: { lat: number; lng: number }; zoom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mode, setMode] = useState<Mode>(value?.type === "Polygon" ? "polygon" : "point");
  const [vertices, setVertices] = useState<[number, number][]>(value?.type === "Polygon" ? value.coordinates[0].slice(0, -1) : []);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const map = new maplibregl.Map({ container: el, style: STYLE, center: [center.lng, center.lat], zoom, dragRotate: false, attributionControl: { compact: true } });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("draw", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "draw-fill", type: "fill", source: "draw", filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#C8341F", "fill-opacity": 0.2 } });
      map.addLayer({ id: "draw-line", type: "line", source: "draw", paint: { "line-color": "#C8341F", "line-width": 2 } });
      map.addLayer({ id: "draw-pts", type: "circle", source: "draw", filter: ["==", "$type", "Point"], paint: { "circle-radius": 7, "circle-color": "#C8341F", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    });
    map.on("click", (e) => {
      const p: [number, number] = [Number(e.lngLat.lng.toFixed(5)), Number(e.lngLat.lat.toFixed(5))];
      if (modeRef.current === "point") onChangeRef.current({ type: "Point", coordinates: p });
      else setVertices((v) => [...v, p]);
    });
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Rendu de la géométrie courante
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      const src = map.getSource("draw") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const features: Feature[] = [];
      if (mode === "point" && value?.type === "Point") features.push({ type: "Feature", geometry: value, properties: {} });
      if (mode === "polygon") {
        for (const v of vertices) features.push({ type: "Feature", geometry: { type: "Point", coordinates: v }, properties: {} });
        if (vertices.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: vertices }, properties: {} });
        if (value?.type === "Polygon") features.push({ type: "Feature", geometry: value, properties: {} });
      }
      src.setData({ type: "FeatureCollection", features });
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
  }, [value, vertices, mode]);

  const closePolygon = () => {
    if (vertices.length < 3) return;
    onChange({ type: "Polygon", coordinates: [[...vertices, vertices[0]]] });
  };
  const clear = () => {
    setVertices([]);
    onChange(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <Segmented
        aria-label="Type de géométrie"
        value={mode}
        onChange={(v) => {
          setMode(v as Mode);
          clear();
        }}
        options={[
          { value: "point", label: "Point" },
          { value: "polygon", label: "Polygone (zone)" },
        ]}
      />
      <div ref={ref} className="h-72 w-full overflow-hidden rounded-xl bg-surface-2" role="application" aria-label="Carte de saisie de la géométrie" />
      <p className="text-[13px] text-muted">{mode === "point" ? "Cliquez sur la carte pour placer le point." : `Cliquez pour ajouter des sommets (${vertices.length}), puis fermez le polygone.`}</p>
      <div className="flex gap-2">
        {mode === "polygon" ? (
          <Button size="md" variant="secondary" disabled={vertices.length < 3} onClick={closePolygon}>
            Fermer le polygone
          </Button>
        ) : null}
        <Button size="md" variant="ghost" onClick={clear}>
          Effacer
        </Button>
      </div>
      {value ? <p className="text-[13px] text-success">Géométrie définie : {value.type === "Point" ? `point ${value.coordinates[1]}, ${value.coordinates[0]}` : `polygone à ${value.coordinates[0].length - 1} sommets`}</p> : null}
    </div>
  );
}
