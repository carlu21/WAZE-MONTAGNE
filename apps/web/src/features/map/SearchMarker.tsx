/**
 * Marqueur temporaire du lieu choisi dans la recherche (épingle + nom).
 * Retiré par le parent (clic sur la carte, nouvelle recherche).
 */
import { useEffect, useMemo, useRef } from "react";
import type { Area } from "@mountain-live/core";
import { isMapAlive, useMap, useMapLayers } from "@/components/map/MapView";
import { MARKER_ANCHOR, SEARCH_MARKER_IMAGE_ID, ensureImage, searchMarkerSvg } from "@/components/map/markers";
import { LABEL_FONT } from "@/components/map/basemaps";
import { LAYER_IDS, SOURCE_IDS, addLayerOrdered, geoJsonSource, pointerCursorOn, removeLayerSafe, removeSourceSafe } from "@/components/map/layers";
import type { FeatureCollection } from "@/components/map/geojsonTypes";
import { EMPTY_COLLECTION, pointFeature } from "./geojson";

export interface SearchMarkerProps {
  area: Area | null;
  /** Tap sur l'épingle. */
  onClick?: (area: Area) => void;
}

export function SearchMarker({ area, onClick }: SearchMarkerProps) {
  const { map, ready, styleVersion } = useMap();
  const collection = useMemo<FeatureCollection>(
    () => (area ? { type: "FeatureCollection", features: [pointFeature(area, { id: area.id, name: area.name })] } : EMPTY_COLLECTION),
    [area],
  );
  const dataRef = useRef(collection);
  dataRef.current = collection;
  const installed = useRef<unknown>(null);
  const areaRef = useRef(area);
  areaRef.current = area;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useMapLayers((m) => {
    let cancelled = false;
    let offCursor: (() => void) | null = null;
    const handleClick = () => {
      if (areaRef.current) onClickRef.current?.(areaRef.current);
    };
    // L'image n'appartient pas à la taxonomie : chargée à la demande, puis la couche est ajoutée.
    void ensureImage(m, SEARCH_MARKER_IMAGE_ID, searchMarkerSvg()).then(() => {
      if (cancelled || !isMapAlive(m)) return;
      if (!m.getSource(SOURCE_IDS.search)) m.addSource(SOURCE_IDS.search, { type: "geojson", data: dataRef.current });
      installed.current = dataRef.current;
      addLayerOrdered(m, {
        id: LAYER_IDS.searchMarker,
        type: "symbol",
        source: SOURCE_IDS.search,
        layout: {
          "icon-image": SEARCH_MARKER_IMAGE_ID,
          "icon-anchor": MARKER_ANCHOR,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 14,
          "text-anchor": "top",
          "text-offset": [0, 0.4],
          "text-allow-overlap": true,
          "text-optional": true,
        },
        paint: { "text-color": "#14351B", "text-halo-color": "#F9F7F1", "text-halo-width": 2 },
      });
      m.on("click", LAYER_IDS.searchMarker, handleClick);
      offCursor = pointerCursorOn(m, LAYER_IDS.searchMarker);
    });
    return () => {
      cancelled = true;
      m.off("click", LAYER_IDS.searchMarker, handleClick);
      offCursor?.();
      removeLayerSafe(m, LAYER_IDS.searchMarker);
      removeSourceSafe(m, SOURCE_IDS.search);
      installed.current = null;
    };
  });

  useEffect(() => {
    if (!map || !ready || !isMapAlive(map) || installed.current === collection) return;
    const source = geoJsonSource(map, SOURCE_IDS.search);
    if (!source) return;
    source.setData(collection);
    installed.current = collection;
  }, [map, ready, styleVersion, collection]);

  return null;
}
