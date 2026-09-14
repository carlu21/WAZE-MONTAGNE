/**
 * Couche des signalements (sections 5 et 10) : source GeoJSON groupée,
 * clusters (cercle vert profond + compte), marqueurs par sous-type avec
 * opacité d'ancienneté, halo « position approximative » pour les espèces
 * sensibles, zoom intelligent, sélection avec halo.
 *
 * Performances : la collection est mémorisée (signalements + palier de zoom) ;
 * `setData` n'est appelé qu'à son changement, jamais pendant un geste. La
 * sélection vit dans une seconde source (un seul point) pour ne pas réécrire
 * la source principale.
 */
import { useEffect, useMemo, useRef } from "react";
import type { FilterSpecification, MapLayerMouseEvent } from "maplibre-gl";
import type { Report } from "@mountain-live/core";
import { isMapAlive, useMap, useMapLayers } from "@/components/map/MapView";
import {
  CLUSTER_CIRCLE_PAINT,
  CLUSTER_SOURCE_OPTIONS,
  CLUSTER_TEXT_LAYOUT,
  CLUSTER_TEXT_PAINT,
  MARKER_ANCHOR,
  REPORT_SYMBOL_LAYOUT,
  REPORT_SYMBOL_PAINT,
  SELECTED_RING_COLOR,
} from "@/components/map/markers";
import { LABEL_FONT } from "@/components/map/basemaps";
import { LAYER_IDS, SOURCE_IDS, addLayerOrdered, geoJsonSource, pointerCursorOn, removeLayerSafe, removeSourceSafe } from "@/components/map/layers";
import type { Point } from "@/components/map/geojsonTypes";
import { EMPTY_COLLECTION, priorityThresholdForZoom, toFeatureCollection, zoomPriorityFilter } from "./geojson";

export interface ReportsLayerProps {
  reports: readonly Report[];
  /** Zoom courant (fin de déplacement) : pilote le zoom intelligent. */
  zoom: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Section 10 : regroupement jusqu'au zoom 14 (au-delà, chaque point est visible). */
const CLUSTER_MAX_ZOOM = 14;
const CLUSTER_ZOOM_CAP = 17;
const IS_CLUSTER: FilterSpecification = ["has", "point_count"];
/** Points non groupés, avec des conditions supplémentaires. */
function notCluster(...extra: unknown[]): FilterSpecification {
  return ["all", ["!", ["has", "point_count"]], ...extra] as unknown as FilterSpecification;
}

export function ReportsLayer({ reports, zoom, selectedId, onSelect }: ReportsLayerProps) {
  const { map, ready, styleVersion } = useMap();
  const minPriority = priorityThresholdForZoom(zoom);

  const collection = useMemo(() => toFeatureCollection(reports, { minPriority }), [reports, minPriority]);
  const selected = useMemo(() => (selectedId ? reports.find((r) => r.id === selectedId) ?? null : null), [reports, selectedId]);
  const selectedCollection = useMemo(
    () => (selected ? toFeatureCollection([selected], { selectedId: selected.id }) : EMPTY_COLLECTION),
    [selected],
  );

  const dataRef = useRef({ collection, selectedCollection });
  dataRef.current = { collection, selectedCollection };
  const installed = useRef<{ collection: unknown; selectedCollection: unknown }>({ collection: null, selectedCollection: null });
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useMapLayers((m) => {
    const data = dataRef.current;
    if (!m.getSource(SOURCE_IDS.reports)) {
      m.addSource(SOURCE_IDS.reports, {
        type: "geojson",
        data: data.collection,
        ...CLUSTER_SOURCE_OPTIONS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        promoteId: "id",
      });
    }
    if (!m.getSource(SOURCE_IDS.selected)) {
      m.addSource(SOURCE_IDS.selected, { type: "geojson", data: data.selectedCollection, promoteId: "id" });
    }
    installed.current = { collection: data.collection, selectedCollection: data.selectedCollection };

    // Halo « position approximative » (espèces sensibles, section 8) : rayon ≈ 400 m au sol.
    addLayerOrdered(m, {
      id: LAYER_IDS.reportsBlur,
      type: "circle",
      source: SOURCE_IDS.reports,
      filter: notCluster(["==", ["get", "blurred"], true]),
      paint: {
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 0, ["/", ["get", "blurPx20"], 1048576], 20, ["get", "blurPx20"]],
        "circle-color": "#6B4F2A",
        "circle-opacity": ["*", 0.12, ["coalesce", ["get", "fade"], 1]],
        "circle-stroke-color": "#6B4F2A",
        "circle-stroke-width": 1.5,
        "circle-stroke-opacity": ["*", 0.5, ["coalesce", ["get", "fade"], 1]],
      },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.reportsClusters,
      type: "circle",
      source: SOURCE_IDS.reports,
      filter: IS_CLUSTER,
      paint: CLUSTER_CIRCLE_PAINT,
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.reportsClusterCount,
      type: "symbol",
      source: SOURCE_IDS.reports,
      filter: IS_CLUSTER,
      layout: { ...CLUSTER_TEXT_LAYOUT, "text-font": LABEL_FONT },
      paint: CLUSTER_TEXT_PAINT,
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.reportsPoints,
      type: "symbol",
      source: SOURCE_IDS.reports,
      filter: notCluster(zoomPriorityFilter()),
      layout: REPORT_SYMBOL_LAYOUT,
      paint: REPORT_SYMBOL_PAINT,
    });
    // Sélection : halo sous la tête de la goutte (ancre en bas), puis marqueur agrandi.
    addLayerOrdered(m, {
      id: LAYER_IDS.selectedHalo,
      type: "circle",
      source: SOURCE_IDS.selected,
      paint: {
        "circle-radius": 30,
        "circle-color": SELECTED_RING_COLOR,
        "circle-opacity": 0.16,
        "circle-stroke-color": SELECTED_RING_COLOR,
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.55,
        "circle-translate": [0, -32],
        "circle-translate-anchor": "viewport",
        "circle-pitch-alignment": "viewport",
      },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.selectedIcon,
      type: "symbol",
      source: SOURCE_IDS.selected,
      layout: { "icon-image": ["get", "markerImage"], "icon-anchor": MARKER_ANCHOR, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": 1 },
      paint: { "icon-opacity": 1 },
    });

    const onPointClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") onSelectRef.current(id);
    };
    const onClusterClick = (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = geoJsonSource(m, SOURCE_IDS.reports);
      if (!feature || typeof clusterId !== "number" || !source) return;
      const [lng, lat] = (feature.geometry as Point).coordinates;
      void source
        .getClusterExpansionZoom(clusterId)
        .then((expansion) => {
          if (!isMapAlive(m)) return;
          m.easeTo({ center: [lng, lat], zoom: Math.min(expansion + 0.4, CLUSTER_ZOOM_CAP), duration: 450 });
        })
        .catch(() => {
          if (isMapAlive(m)) m.easeTo({ center: [lng, lat], zoom: m.getZoom() + 2, duration: 450 });
        });
    };

    m.on("click", LAYER_IDS.reportsPoints, onPointClick);
    m.on("click", LAYER_IDS.selectedIcon, onPointClick);
    m.on("click", LAYER_IDS.reportsClusters, onClusterClick);
    const cursors = [pointerCursorOn(m, LAYER_IDS.reportsPoints), pointerCursorOn(m, LAYER_IDS.reportsClusters), pointerCursorOn(m, LAYER_IDS.selectedIcon)];

    return () => {
      m.off("click", LAYER_IDS.reportsPoints, onPointClick);
      m.off("click", LAYER_IDS.selectedIcon, onPointClick);
      m.off("click", LAYER_IDS.reportsClusters, onClusterClick);
      for (const off of cursors) off();
      for (const id of [LAYER_IDS.selectedIcon, LAYER_IDS.selectedHalo, LAYER_IDS.reportsPoints, LAYER_IDS.reportsClusterCount, LAYER_IDS.reportsClusters, LAYER_IDS.reportsBlur]) {
        removeLayerSafe(m, id);
      }
      removeSourceSafe(m, SOURCE_IDS.selected);
      removeSourceSafe(m, SOURCE_IDS.reports);
      installed.current = { collection: null, selectedCollection: null };
    };
  });

  // Mise à jour des données sans réinstaller les couches.
  useEffect(() => {
    if (!map || !ready || !isMapAlive(map) || installed.current.collection === collection) return;
    const source = geoJsonSource(map, SOURCE_IDS.reports);
    if (!source) return;
    source.setData(collection);
    installed.current.collection = collection;
  }, [map, ready, styleVersion, collection]);

  useEffect(() => {
    if (!map || !ready || !isMapAlive(map) || installed.current.selectedCollection === selectedCollection) return;
    const source = geoJsonSource(map, SOURCE_IDS.selected);
    if (!source) return;
    source.setData(selectedCollection);
    installed.current.selectedCollection = selectedCollection;
  }, [map, ready, styleVersion, selectedCollection]);

  return null;
}
