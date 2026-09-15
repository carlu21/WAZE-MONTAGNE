/**
 * Couches de la carte de navigation (sections 5, 9, 19, 20).
 *
 * Trois objets distincts, et ils ne se confondent jamais :
 *
 *   A. LA POSITION — marqueur orienté, cercle d'incertitude. Rien d'autre.
 *   B. LA TRACE PARCOURUE — les relevés réellement enregistrés, dans l'ordre,
 *      DÉCOUPÉE (`drawableTraceSegments`) là où deux relevés ne peuvent pas se
 *      suivre : on interrompt le trait plutôt que de le rafistoler en ligne droite.
 *   C. L'ITINÉRAIRE À SUIVRE — et seulement s'il suit le réseau réel. Un tracé
 *      schématique n'est pas dessiné du tout (`routeDrawable`).
 *
 * La seule ligne droite tolérée est la FLÈCHE DE DIRECTION vers le parcours :
 * grise, pointillée, bornée à quelques dizaines de mètres, et annoncée comme
 * telle dans l'affichage tête haute. Elle ne se suit pas, elle oriente.
 */
import { useEffect, useMemo, useRef } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";
import { directionIndicator, drawableTraceSegments, sliceAlong, type LatLng, type NavRoute, type RouteEvent, type TrackPoint } from "@mountain-live/core";
import { isMapAlive, useMap, useMapLayers } from "@/components/map/MapView";
import { LAYER_IDS, SOURCE_IDS, addLayerOrdered, geoJsonSource, removeLayerSafe, removeSourceSafe } from "@/components/map/layers";
import { categoryMarkerImageId, ensureImage, markerImageId } from "@/components/map/markers";
import type { FeatureCollection } from "@/components/map/geojsonTypes";
import { EMPTY_COLLECTION, circlePolygon, pointFeature } from "@/features/map/geojson";
import { useNavigationStore } from "./store";
import { currentTrack, networkGraphSnapshot } from "./useNavigationEngine";

const ROUTE_COLOR = "#1D6FA5";
const DONE_COLOR = "#7A8894";
const TRACK_COLOR = "#E8730C";
/** Gris ardoise : la flèche de direction. Jamais la couleur d'un itinéraire. */
const DIRECTION_COLOR = "#5B6670";
const PATH_COLOR = "#8B5E3C";
const ARROW_IMAGE = "ml-nav-arrow";
const DOT_IMAGE = "ml-nav-dot";

function arrowSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="14" fill="#1D6FA5" stroke="#FFFFFF" stroke-width="3"/><path d="M22 9 L31 27 L22 22 L13 27 Z" fill="#FFFFFF"/></svg>`;
}
function dotSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="11" fill="#1D6FA5" stroke="#FFFFFF" stroke-width="3"/></svg>`;
}

function lineCollection(coords: readonly (readonly [number, number])[], props: Record<string, unknown> = {}): FeatureCollection {
  if (coords.length < 2) return EMPTY_COLLECTION;
  return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords.map((c) => [c[0], c[1]]) }, properties: props }] };
}

function eventsCollection(events: readonly RouteEvent[], along: number | null): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events
      .filter((e) => along === null || e.along - along >= -30)
      .map((e) => ({
        type: "Feature" as const,
        id: e.key,
        geometry: { type: "Point" as const, coordinates: [e.position.lng, e.position.lat] },
        properties: {
          key: e.key,
          label: e.label,
          markerImage: e.subtype ? markerImageId(e.subtype, "default") : categoryMarkerImageId(e.category ?? "path", e.kind === "official" ? "official" : "default"),
        },
      })),
  };
}

export interface NavLayersProps {
  route: NavRoute | null;
  /**
   * L'itinéraire suit-il un réseau réel ? Faux = on ne dessine AUCUNE ligne
   * d'itinéraire, quoi qu'il arrive.
   */
  routeDrawable?: boolean;
  /** Cible de la flèche de direction vers le parcours (sortie d'itinéraire), ou null. */
  returnTarget: LatLng | null;
}

export function NavLayers({ route, routeDrawable = true, returnTarget }: NavLayersProps) {
  const { map, ready, styleVersion } = useMap();
  const live = useNavigationStore((s) => s.live);
  const networkSegments = live.networkSegments;
  const output = live.output;
  const progress = live.progress;
  const events = live.events;
  const trackPoints = live.trackPoints;

  // Interpolation du marqueur entre deux relevés (600 ms).
  const displayed = useRef<LatLng | null>(null);
  const anim = useRef<number | null>(null);

  const setUserData = (m: MaplibreMap, pos: LatLng, heading: number | null, accuracy: number | null, quality: string) => {
    const src = geoJsonSource(m, SOURCE_IDS.navUser);
    if (!src) return;
    const features: FeatureCollection["features"] = [];
    if (accuracy && accuracy > 12) features.push({ ...circlePolygon(pos, accuracy), properties: { kind: "accuracy" } });
    features.push(pointFeature(pos, { kind: "marker", heading: heading ?? 0, image: heading === null ? DOT_IMAGE : ARROW_IMAGE, lost: quality === "lost" }));
    src.setData({ type: "FeatureCollection", features });
  };

  useMapLayers((m) => {
    void ensureImage(m, ARROW_IMAGE, arrowSvg());
    void ensureImage(m, DOT_IMAGE, dotSvg());
    for (const id of [SOURCE_IDS.navPaths, SOURCE_IDS.navRoute, SOURCE_IDS.navTrack, SOURCE_IDS.navReturn, SOURCE_IDS.navEvents, SOURCE_IDS.navUser]) {
      if (!m.getSource(id)) m.addSource(id, { type: "geojson", data: EMPTY_COLLECTION });
    }
    addLayerOrdered(m, { id: LAYER_IDS.navPathsCasing, type: "line", source: SOURCE_IDS.navPaths, minzoom: 11, paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 5], "line-opacity": 0.6 }, layout: { "line-cap": "round", "line-join": "round" } });
    addLayerOrdered(m, { id: LAYER_IDS.navPaths, type: "line", source: SOURCE_IDS.navPaths, minzoom: 11, paint: { "line-color": ["case", ["==", ["get", "kind"], "track"], "#A0522D", PATH_COLOR], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 16, 2.2], "line-opacity": ["case", ["==", ["get", "surveyed"], true], 0.85, 0.4], "line-dasharray": ["case", ["==", ["get", "surveyed"], true], ["literal", [2, 1.5]], ["literal", [1.5, 2.5]]] }, layout: { "line-cap": "round", "line-join": "round" } });
    addLayerOrdered(m, { id: LAYER_IDS.navRouteCasing, type: "line", source: SOURCE_IDS.navRoute, paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 16, 11], "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
    addLayerOrdered(m, { id: LAYER_IDS.navRouteRemaining, type: "line", source: SOURCE_IDS.navRoute, filter: ["==", ["get", "part"], "remaining"], paint: { "line-color": ROUTE_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 7] }, layout: { "line-cap": "round", "line-join": "round" } });
    addLayerOrdered(m, { id: LAYER_IDS.navRouteDone, type: "line", source: SOURCE_IDS.navRoute, filter: ["==", ["get", "part"], "done"], paint: { "line-color": DONE_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 16, 7], "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
    addLayerOrdered(m, { id: LAYER_IDS.navTrack, type: "line", source: SOURCE_IDS.navTrack, paint: { "line-color": TRACK_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 16, 4], "line-dasharray": [1.5, 1.5], "line-opacity": 0.95 }, layout: { "line-cap": "round", "line-join": "round" } });
    addLayerOrdered(m, { id: LAYER_IDS.navReturn, type: "line", source: SOURCE_IDS.navReturn, paint: { "line-color": DIRECTION_COLOR, "line-width": 3, "line-dasharray": [1, 1.6], "line-opacity": 0.85 }, layout: { "line-cap": "round" } });
    addLayerOrdered(m, { id: LAYER_IDS.navEvents, type: "symbol", source: SOURCE_IDS.navEvents, layout: { "icon-image": ["get", "markerImage"], "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.7, 15, 1] } });
    addLayerOrdered(m, { id: LAYER_IDS.navAccuracy, type: "fill", source: SOURCE_IDS.navUser, filter: ["==", ["get", "kind"], "accuracy"], paint: { "fill-color": ROUTE_COLOR, "fill-opacity": 0.12, "fill-outline-color": ROUTE_COLOR } });
    addLayerOrdered(m, { id: LAYER_IDS.navMarkerHalo, type: "circle", source: SOURCE_IDS.navUser, filter: ["==", ["get", "kind"], "marker"], paint: { "circle-radius": 22, "circle-color": ROUTE_COLOR, "circle-opacity": ["case", ["==", ["get", "lost"], true], 0.08, 0.18], "circle-pitch-alignment": "map" } });
    addLayerOrdered(m, { id: LAYER_IDS.navMarker, type: "symbol", source: SOURCE_IDS.navUser, filter: ["==", ["get", "kind"], "marker"], layout: { "icon-image": ["get", "image"], "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": 1 }, paint: { "icon-opacity": ["case", ["==", ["get", "lost"], true], 0.55, 1] } });
    if (displayed.current && output) setUserData(m, displayed.current, output.heading, output.accuracy, output.quality);
    return () => {
      for (const id of [LAYER_IDS.navMarker, LAYER_IDS.navMarkerHalo, LAYER_IDS.navAccuracy, LAYER_IDS.navEvents, LAYER_IDS.navReturn, LAYER_IDS.navTrack, LAYER_IDS.navRouteDone, LAYER_IDS.navRouteRemaining, LAYER_IDS.navRouteCasing, LAYER_IDS.navPaths, LAYER_IDS.navPathsCasing]) removeLayerSafe(m, id);
      for (const id of [SOURCE_IDS.navPaths, SOURCE_IDS.navRoute, SOURCE_IDS.navTrack, SOURCE_IDS.navReturn, SOURCE_IDS.navEvents, SOURCE_IDS.navUser]) removeSourceSafe(m, id);
    };
  });

  // Réseau : segments du graphe (mise à jour quand leur nombre change).
  useEffect(() => {
    if (!map || !ready || !isMapAlive(map)) return;
    const src = geoJsonSource(map, SOURCE_IDS.navPaths);
    if (!src) return;
    src.setData(networkSegments > 0 ? (networkGraphSnapshot() as FeatureCollection) : EMPTY_COLLECTION);
  }, [map, ready, styleVersion, networkSegments]);

  // Itinéraire : portion faite / restante. Rien du tout s'il ne suit pas le réseau réel.
  const routeData = useMemo<FeatureCollection>(() => {
    if (!route || !routeDrawable) return EMPTY_COLLECTION;
    const along = progress?.along ?? 0;
    const done = along > 5 ? sliceAlong(route.coordinates, route.cumulative, 0, along) : [];
    const remaining = sliceAlong(route.coordinates, route.cumulative, along, route.lengthM);
    return {
      type: "FeatureCollection",
      features: [...lineCollection(done, { part: "done" }).features, ...lineCollection(remaining, { part: "remaining" }).features],
    };
  }, [route, routeDrawable, progress?.along]);
  useEffect(() => {
    if (!map || !ready || !isMapAlive(map)) return;
    geoJsonSource(map, SOURCE_IDS.navRoute)?.setData(routeData);
  }, [map, ready, styleVersion, routeData]);

  /*
   * Fil d'Ariane — la trace RÉELLEMENT parcourue, découpée en tronçons continus.
   * Une reprise de signal après un tunnel, une mise en veille ou un saut de
   * relevé n'est pas un déplacement : le trait s'interrompt, et c'est la
   * lecture honnête. Le dernier point se prolonge jusqu'à la position courante
   * uniquement si cette position appartient bien au dernier tronçon.
   */
  useEffect(() => {
    if (!map || !ready || !isMapAlive(map)) return;
    const pts: TrackPoint[] = currentTrack();
    const segments = drawableTraceSegments(
      output && pts.length > 0
        ? [...pts, { lat: output.position.lat, lng: output.position.lng, alt: null, at: output.at, accuracy: output.accuracy }]
        : pts,
    );
    geoJsonSource(map, SOURCE_IDS.navTrack)?.setData({
      type: "FeatureCollection",
      features: segments.flatMap((coords) => lineCollection(coords).features),
    });
  }, [map, ready, styleVersion, trackPoints, output]);

  /*
   * Flèche vers le parcours : une DIRECTION, pas un chemin. Bornée à quelques
   * dizaines de mètres (`directionIndicator`) précisément pour qu'on ne puisse
   * pas la prendre pour un itinéraire à suivre à travers la pente.
   */
  useEffect(() => {
    if (!map || !ready || !isMapAlive(map)) return;
    const src = geoJsonSource(map, SOURCE_IDS.navReturn);
    if (!src) return;
    src.setData(
      returnTarget && output
        ? lineCollection(directionIndicator(output.position, returnTarget).coordinates)
        : EMPTY_COLLECTION,
    );
  }, [map, ready, styleVersion, returnTarget, output]);

  // Événements.
  useEffect(() => {
    if (!map || !ready || !isMapAlive(map)) return;
    geoJsonSource(map, SOURCE_IDS.navEvents)?.setData(eventsCollection(events, route ? (progress?.along ?? 0) : null));
  }, [map, ready, styleVersion, events, route, progress?.along]);

  // Marqueur : interpolation vers la nouvelle position.
  useEffect(() => {
    if (!map || !ready || !isMapAlive(map) || !output) return;
    const target = output.position;
    const from = displayed.current ?? target;
    const startAt = performance.now();
    const duration = displayed.current ? 600 : 0;
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    const frame = (now: number) => {
      if (!isMapAlive(map)) return;
      const t = duration === 0 ? 1 : Math.min(1, (now - startAt) / duration);
      const eased = 1 - (1 - t) * (1 - t);
      const pos = { lat: from.lat + (target.lat - from.lat) * eased, lng: from.lng + (target.lng - from.lng) * eased };
      displayed.current = pos;
      setUserData(map, pos, output.heading, output.accuracy, output.quality);
      if (t < 1) anim.current = requestAnimationFrame(frame);
      else anim.current = null;
    };
    anim.current = requestAnimationFrame(frame);
    return () => {
      if (anim.current !== null) cancelAnimationFrame(anim.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ready, styleVersion, output]);

  return null;
}
