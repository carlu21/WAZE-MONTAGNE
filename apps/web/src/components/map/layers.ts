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
  // Navigation (écran plein écran) : réseau, itinéraire, trace, événements, marqueur orienté.
  navPaths: "ml-nav-paths",
  navPathsCasing: "ml-nav-paths-casing",
  navRouteCasing: "ml-nav-route-casing",
  navRouteRemaining: "ml-nav-route-remaining",
  navRouteDone: "ml-nav-route-done",
  navTrack: "ml-nav-track",
  navReturn: "ml-nav-return",
  navEvents: "ml-nav-events",
  navAccuracy: "ml-nav-accuracy",
  navMarkerHalo: "ml-nav-marker-halo",
  navMarker: "ml-nav-marker",
  /** Carte de fréquentation (réseau vivant). */
  heatPathsCasing: "ml-heat-paths-casing",
  heatPaths: "ml-heat-paths",
  /** Écran d'accueil : départs de randonnée, tracé sélectionné, position orientée. */
  homeTrailCasing: "ml-home-trail-casing",
  homeTrail: "ml-home-trail",
  homeHeads: "ml-home-heads",
  homeHeadLabels: "ml-home-head-labels",
  homeAccuracy: "ml-home-accuracy",
  homeMarkerHalo: "ml-home-marker-halo",
  homeMarker: "ml-home-marker",
} as const;

export const SOURCE_IDS = {
  presence: "ml-presence",
  alertsPolygons: "ml-alerts-polygons",
  alertsPoints: "ml-alerts-points",
  reports: "ml-reports",
  selected: "ml-selected",
  user: "ml-user",
  search: "ml-search",
  navPaths: "ml-nav-paths",
  navRoute: "ml-nav-route",
  navTrack: "ml-nav-track",
  navReturn: "ml-nav-return",
  navEvents: "ml-nav-events",
  homeTrail: "ml-home-trail",
  homeHeads: "ml-home-heads",
  homeUser: "ml-home-user",
  navUser: "ml-nav-user",
  heatPaths: "ml-heat-paths",
} as const;

/** Du plus bas (dessous) au plus haut (dessus). */
export const LAYER_ORDER: readonly string[] = [
  LAYER_IDS.presenceHeat,
  LAYER_IDS.heatPathsCasing,
  LAYER_IDS.heatPaths,
  LAYER_IDS.navPathsCasing,
  LAYER_IDS.navPaths,
  LAYER_IDS.homeTrailCasing,
  LAYER_IDS.homeTrail,
  LAYER_IDS.alertsFill,
  LAYER_IDS.alertsOutline,
  LAYER_IDS.navRouteCasing,
  LAYER_IDS.navRouteRemaining,
  LAYER_IDS.navRouteDone,
  LAYER_IDS.navTrack,
  LAYER_IDS.navReturn,
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
  LAYER_IDS.homeHeads,
  LAYER_IDS.homeHeadLabels,
  LAYER_IDS.navEvents,
  LAYER_IDS.navAccuracy,
  LAYER_IDS.navMarkerHalo,
  LAYER_IDS.navMarker,
  LAYER_IDS.homeAccuracy,
  LAYER_IDS.homeMarkerHalo,
  LAYER_IDS.homeMarker,
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
