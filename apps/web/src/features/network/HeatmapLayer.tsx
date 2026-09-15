/**
 * Couche « réseau vivant » (section 12) : les chemins colorés selon leur
 * fréquentation réelle, pour la période et l'activité choisies.
 *
 * Choix d'affichage : la COULEUR porte le niveau de fréquentation contextualisé
 * (un sentier d'altitude n'est pas comparé à un chemin de village), l'ÉPAISSEUR
 * porte le nombre de passages relatif à la vue. Les chemins sans données
 * suffisantes restent visibles en gris : absence de données n'est pas absence
 * de chemin (section 43).
 */
import { useEffect, useMemo } from "react";
import type { MapMouseEvent } from "maplibre-gl";
import type { FrequentationLevel, HeatmapResponse } from "@mountain-live/core";
import { isMapAlive, useMap, useMapLayers } from "@/components/map/MapView";
import { LAYER_IDS, SOURCE_IDS, addLayerOrdered, geoJsonSource, pointerCursorOn, removeLayerSafe, removeSourceSafe } from "@/components/map/layers";
import { FREQUENTATION_COLORS, heatmapCollection } from "./heatmap";

export interface HeatmapLayerProps {
  data: HeatmapResponse | null;
  onSelect?: (segmentId: string) => void;
}

export function HeatmapLayer({ data, onSelect }: HeatmapLayerProps) {
  const { map, ready, styleVersion } = useMap();
  const collection = useMemo(() => heatmapCollection(data), [data]);

  useMapLayers((m) => {
    if (!m.getSource(SOURCE_IDS.heatPaths)) m.addSource(SOURCE_IDS.heatPaths, { type: "geojson", data: collection });
    addLayerOrdered(m, {
      id: LAYER_IDS.heatPathsCasing,
      type: "line",
      source: SOURCE_IDS.heatPaths,
      paint: {
        "line-color": "#FFFFFF",
        "line-opacity": 0.55,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, ["+", 6, ["*", 10, ["get", "intensity"]]]],
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.heatPaths,
      type: "line",
      source: SOURCE_IDS.heatPaths,
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": ["case", ["==", ["get", "insufficient"], true], 0.45, 0.95],
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 16, ["+", 3, ["*", 8, ["get", "intensity"]]]],
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    const cleanupCursor = pointerCursorOn(m, LAYER_IDS.heatPaths);
    return () => {
      cleanupCursor();
      removeLayerSafe(m, LAYER_IDS.heatPaths);
      removeLayerSafe(m, LAYER_IDS.heatPathsCasing);
      removeSourceSafe(m, SOURCE_IDS.heatPaths);
    };
  });

  useEffect(() => {
    if (!map || !ready || !isMapAlive(map)) return;
    geoJsonSource(map, SOURCE_IDS.heatPaths)?.setData(collection);
  }, [map, ready, styleVersion, collection]);

  useEffect(() => {
    if (!map || !ready || !isMapAlive(map) || !onSelect) return;
    const handler = (e: MapMouseEvent & { features?: { properties?: Record<string, unknown> }[] }) => {
      const id = e.features?.[0]?.properties?.segmentId;
      if (typeof id === "string") onSelect(id);
    };
    map.on("click", LAYER_IDS.heatPaths, handler);
    return () => {
      map.off("click", LAYER_IDS.heatPaths, handler);
    };
  }, [map, ready, styleVersion, onSelect]);

  return null;
}
