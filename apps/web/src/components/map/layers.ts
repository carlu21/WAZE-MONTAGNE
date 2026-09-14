/**
 * Ordre d'empilement des couches de données et petits utilitaires MapLibre
 * partagés par les surcouches (features/map/*).
 *
 * Chaque surcouche installe ses couches indépendamment (et peut les réinstaller
 * seule) : `addLayerOrdered` place toujours une couche sous la première couche
 * de rang supérieur déjà présente, ce qui garantit un empilement stable quel
 * que soit l'ordre d'installation.
 */
import type { GeoJSONSource, LayerSpecification, Map as MaplibreMap } from "maplibre-gl";

export const LAYER_IDS = {
  presenceHeat: "ml-presence-heat",
  alertsFill: "ml-alerts-fill",
  alertsOutline: "ml-alerts-outline",
  reportsBlur: "ml-reports-blur",
  reportsClusters: "ml-reports-clusters",
  reportsClusterCount: "ml-reports-cluster-count",
  reportsPoints: "ml-reports-points",
  alertsPoints: "ml-alerts-points",
  selectedHalo: "ml-selected-halo",
  selectedIcon: "ml-selected-icon",
  userAccuracy: "ml-user-accuracy",
  userDotHalo: "ml-user-dot-halo",
  userDot: "ml-user-dot",
  searchMarker: "ml-search-marker",
} as const;

export const SOURCE_IDS = {
  presence: "ml-presence",
  alertsPolygons: "ml-alerts-polygons",
  alertsPoints: "ml-alerts-points",
  reports: "ml-reports",
  selected: "ml-selected",
  user: "ml-user",
  search: "ml-search",
} as const;

/** Du plus bas (dessous) au plus haut (dessus). */
export const LAYER_ORDER: readonly string[] = [
  LAYER_IDS.presenceHeat,
  LAYER_IDS.alertsFill,
  LAYER_IDS.alertsOutline,
  LAYER_IDS.reportsBlur,
  LAYER_IDS.reportsClusters,
  LAYER_IDS.reportsClusterCount,
  LAYER_IDS.reportsPoints,
  LAYER_IDS.alertsPoints,
  LAYER_IDS.selectedHalo,
  LAYER_IDS.selectedIcon,
  LAYER_IDS.userAccuracy,
  LAYER_IDS.userDotHalo,
  LAYER_IDS.userDot,
  LAYER_IDS.searchMarker,
];

/** Identifiant de la première couche déjà présente devant se trouver au-dessus de `layerId`. */
export function layerAbove(map: MaplibreMap, layerId: string): string | undefined {
  const idx = LAYER_ORDER.indexOf(layerId);
  if (idx === -1) return undefined;
  for (let i = idx + 1; i < LAYER_ORDER.length; i += 1) {
    if (map.getLayer(LAYER_ORDER[i])) return LAYER_ORDER[i];
  }
  return undefined;
}

/** Ajoute une couche à sa place dans l'ordre d'empilement (sans doublon). */
export function addLayerOrdered(map: MaplibreMap, layer: LayerSpecification): void {
  if (map.getLayer(layer.id)) return;
  map.addLayer(layer, layerAbove(map, layer.id));
}

export function removeLayerSafe(map: MaplibreMap, layerId: string): void {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
}

export function removeSourceSafe(map: MaplibreMap, sourceId: string): void {
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

/** Source GeoJSON existante, ou undefined si elle n'est pas (encore) installée. */
export function geoJsonSource(map: MaplibreMap | null, sourceId: string): GeoJSONSource | undefined {
  const src = map?.getSource(sourceId);
  return src && src.type === "geojson" ? (src as GeoJSONSource) : undefined;
}

/** Curseur « main » au survol d'une couche cliquable ; renvoie la fonction de nettoyage. */
export function pointerCursorOn(map: MaplibreMap, layerId: string): () => void {
  const enter = () => {
    map.getCanvas().style.cursor = "pointer";
  };
  const leave = () => {
    map.getCanvas().style.cursor = "";
  };
  map.on("mouseenter", layerId, enter);
  map.on("mouseleave", layerId, leave);
  return () => {
    map.off("mouseenter", layerId, enter);
    map.off("mouseleave", layerId, leave);
  };
}
