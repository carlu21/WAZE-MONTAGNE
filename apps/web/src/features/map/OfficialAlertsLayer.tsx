/**
 * Alertes officielles (sections 7 et 27) : zones (polygones translucides,
 * rouge pour les sévérités importante/critique, orange sinon) et marqueurs
 * « officiel » (liseré doré). Un clic ouvre l'aperçu avec le badge « Source officielle ».
 */
import { useEffect, useMemo, useRef } from "react";
import type { FillLayerSpecification, MapLayerMouseEvent } from "maplibre-gl";
import type { OfficialAlert } from "@mountain-live/core";
import { isMapAlive, useMap, useMapLayers } from "@/components/map/MapView";
import { MARKER_ANCHOR } from "@/components/map/markers";
import { LAYER_IDS, SOURCE_IDS, addLayerOrdered, geoJsonSource, pointerCursorOn, removeLayerSafe, removeSourceSafe } from "@/components/map/layers";
import { alertsToCollections } from "./geojson";

export interface OfficialAlertsLayerProps {
  alerts: readonly OfficialAlert[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type ColorExpression = NonNullable<FillLayerSpecification["paint"]>["fill-color"];

/** Rouge danger pour important/critique, orange sécurité pour faible/modéré. */
function severityColor(): ColorExpression {
  return ["match", ["get", "severity"], "critical", "#C8341F", "high", "#C8341F", "#D9822B"];
}

export function OfficialAlertsLayer({ alerts, selectedId, onSelect }: OfficialAlertsLayerProps) {
  const { map, ready, styleVersion } = useMap();
  const collections = useMemo(() => alertsToCollections(alerts), [alerts]);
  const dataRef = useRef(collections);
  dataRef.current = collections;
  const installed = useRef<unknown>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useMapLayers((m) => {
    const data = dataRef.current;
    if (!m.getSource(SOURCE_IDS.alertsPolygons)) m.addSource(SOURCE_IDS.alertsPolygons, { type: "geojson", data: data.polygons, promoteId: "id" });
    if (!m.getSource(SOURCE_IDS.alertsPoints)) m.addSource(SOURCE_IDS.alertsPoints, { type: "geojson", data: data.points, promoteId: "id" });
    installed.current = data;

    addLayerOrdered(m, {
      id: LAYER_IDS.alertsFill,
      type: "fill",
      source: SOURCE_IDS.alertsPolygons,
      paint: { "fill-color": severityColor(), "fill-opacity": 0.18 },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.alertsOutline,
      type: "line",
      source: SOURCE_IDS.alertsPolygons,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": severityColor(), "line-width": 2.5, "line-opacity": 0.9, "line-dasharray": [3, 2] },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.alertsPoints,
      type: "symbol",
      source: SOURCE_IDS.alertsPoints,
      layout: { "icon-image": ["get", "markerImage"], "icon-anchor": MARKER_ANCHOR, "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": 1 },
      paint: { "icon-opacity": 1 },
    });

    const select = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") onSelectRef.current(id);
    };
    const onFillClick = (e: MapLayerMouseEvent) => {
      // Un marqueur (signalement ou alerte) au-dessus de la zone a priorité sur la zone.
      const above = [LAYER_IDS.reportsPoints, LAYER_IDS.reportsClusters, LAYER_IDS.alertsPoints].filter((id) => m.getLayer(id));
      if (above.length > 0 && m.queryRenderedFeatures(e.point, { layers: above }).length > 0) return;
      select(e);
    };
    m.on("click", LAYER_IDS.alertsPoints, select);
    m.on("click", LAYER_IDS.alertsFill, onFillClick);
    const offCursor = pointerCursorOn(m, LAYER_IDS.alertsPoints);

    return () => {
      m.off("click", LAYER_IDS.alertsPoints, select);
      m.off("click", LAYER_IDS.alertsFill, onFillClick);
      offCursor();
      for (const id of [LAYER_IDS.alertsPoints, LAYER_IDS.alertsOutline, LAYER_IDS.alertsFill]) removeLayerSafe(m, id);
      removeSourceSafe(m, SOURCE_IDS.alertsPoints);
      removeSourceSafe(m, SOURCE_IDS.alertsPolygons);
      installed.current = null;
    };
  });

  useEffect(() => {
    if (!map || !ready || !isMapAlive(map) || installed.current === collections) return;
    geoJsonSource(map, SOURCE_IDS.alertsPolygons)?.setData(collections.polygons);
    geoJsonSource(map, SOURCE_IDS.alertsPoints)?.setData(collections.points);
    installed.current = collections;
  }, [map, ready, styleVersion, collections]);

  // Zone sélectionnée : remplissage plus marqué.
  useEffect(() => {
    if (!map || !ready || !isMapAlive(map) || !map.getLayer(LAYER_IDS.alertsFill)) return;
    map.setPaintProperty(LAYER_IDS.alertsFill, "fill-opacity", selectedId ? ["case", ["==", ["get", "id"], selectedId], 0.34, 0.14] : 0.18);
  }, [map, ready, styleVersion, selectedId]);

  return null;
}
