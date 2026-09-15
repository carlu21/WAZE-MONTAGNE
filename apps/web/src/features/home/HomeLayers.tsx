/**
 * Couches carte de l'écran d'accueil (sections 3, 4, 14 du cahier des charges).
 *
 * Trois choses, et rien d'autre — la carte ne doit pas être surchargée :
 *
 * 1. **La position, très visible** : un marqueur directionnel qui porte à la
 *    fois la position et le cap, entouré d'un halo. Quand le cap est inconnu
 *    (à l'arrêt), c'est un disque : afficher une flèche vers le nord par défaut
 *    ferait croire à une orientation qu'on ne connaît pas.
 * 2. **Les départs de randonnée proposés dans le panneau**, épinglés sur la
 *    carte : ce qui est listé en bas doit être visible en haut, sinon le lien
 *    entre les deux se perd. Le départ sélectionné grossit.
 * 3. **Le tracé de la randonnée sélectionnée**, sous les épingles.
 */
import { useEffect, useMemo, useRef } from "react";
import type { MapMouseEvent } from "maplibre-gl";
import type { LngLat, NearbyTrail } from "@mountain-live/core";
import { isMapAlive, useMap, useMapLayers } from "@/components/map/MapView";
import { LAYER_IDS, SOURCE_IDS, addLayerOrdered, geoJsonSource, pointerCursorOn, removeLayerSafe, removeSourceSafe } from "@/components/map/layers";
import { ensureImage } from "@/components/map/markers";
import type { FeatureCollection } from "@/components/map/geojsonTypes";
import { EMPTY_COLLECTION, circlePolygon, pointFeature } from "@/features/map/geojson";
import { useUiStore } from "@/store/ui";

/** Vert forêt de la marque : le tracé retenu. */
const TRAIL_COLOR = "#2F6B3A";
/** Bleu eau : la position de l'utilisateur, jamais confondue avec un itinéraire. */
const USER_COLOR = "#1D6FA5";

const HEAD_IMAGE = "ml-home-head";
const HEAD_IMAGE_ACTIVE = "ml-home-head-active";
const ARROW_IMAGE = "ml-home-arrow";
const DOT_IMAGE = "ml-home-dot";

/** Au-delà de ce rayon annoncé, on dessine le cercle d'incertitude. */
const ACCURACY_MIN_M = 12;

/** Épingle d'un départ de randonnée : une chaussure, lisible à petite taille. */
function headSvg(active: boolean): string {
  const fill = active ? TRAIL_COLOR : "#FFFFFF";
  const ink = active ? "#FFFFFF" : TRAIL_COLOR;
  const r = active ? 17 : 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="${r + 3}" fill="${TRAIL_COLOR}" fill-opacity="0.16"/>
    <circle cx="24" cy="24" r="${r}" fill="${fill}" stroke="${TRAIL_COLOR}" stroke-width="2.5"/>
    <path d="M18.5 30.5c0-1.6.5-2.7 1.4-3.8.7-.8 1-1.5 1-2.6v-5.3c0-.7.5-1.3 1.3-1.3.7 0 1.3.6 1.3 1.3v3.1c.6.5 1.3 1 2.1 1.5 1.6 1 2.6 1.6 3.4 2.4.9.9 1.3 1.9 1.3 3.1v1.6c0 .7-.6 1.3-1.3 1.3H19.8c-.7 0-1.3-.6-1.3-1.3z" fill="${ink}"/>
  </svg>`;
}

/** Marqueur directionnel : position ET cap, d'un seul coup d'œil. */
function arrowSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46">
    <circle cx="23" cy="23" r="15" fill="${USER_COLOR}" stroke="#FFFFFF" stroke-width="3.5"/>
    <path d="M23 9.5 L32 28.5 L23 23.2 L14 28.5 Z" fill="#FFFFFF"/>
  </svg>`;
}

/** Cap inconnu : un disque. On n'invente pas une orientation. */
function dotSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46">
    <circle cx="23" cy="23" r="11" fill="${USER_COLOR}" stroke="#FFFFFF" stroke-width="3.5"/>
  </svg>`;
}

export interface HomeLayersProps {
  trails: readonly NearbyTrail[];
  selectedId: string | null;
  /** Tracé complet de la randonnée sélectionnée, chargé à la demande. */
  selectedGeometry: LngLat[] | null;
  /** Cap de déplacement (degrés) ou null à l'arrêt. */
  heading: number | null;
  onSelectTrail: (id: string) => void;
}

export function HomeLayers({ trails, selectedId, selectedGeometry, heading, onSelectTrail }: HomeLayersProps) {
  const { map, ready, styleVersion } = useMap();
  const position = useUiStore((s) => s.position);

  const heads = useMemo<FeatureCollection>(() => {
    if (trails.length === 0) return EMPTY_COLLECTION;
    return {
      type: "FeatureCollection",
      features: trails.map((t) => ({
        type: "Feature",
        id: t.id,
        geometry: { type: "Point", coordinates: [t.trailhead.point.lng, t.trailhead.point.lat] },
        properties: {
          trailId: t.id,
          name: t.name,
          active: t.id === selectedId,
          image: t.id === selectedId ? HEAD_IMAGE_ACTIVE : HEAD_IMAGE,
          alert: t.activeReports > 0,
        },
      })),
    };
  }, [trails, selectedId]);

  const trail = useMemo<FeatureCollection>(() => {
    if (!selectedGeometry || selectedGeometry.length < 2) return EMPTY_COLLECTION;
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "LineString", coordinates: selectedGeometry.map((c) => [c[0], c[1]]) }, properties: {} }],
    };
  }, [selectedGeometry]);

  const user = useMemo<FeatureCollection>(() => {
    if (!position) return EMPTY_COLLECTION;
    const features: FeatureCollection["features"] = [];
    if (position.accuracy && position.accuracy > ACCURACY_MIN_M) {
      features.push({ ...circlePolygon(position, position.accuracy), properties: { kind: "accuracy" } });
    }
    features.push(
      pointFeature(position, {
        kind: "marker",
        heading: heading ?? 0,
        image: heading === null ? DOT_IMAGE : ARROW_IMAGE,
      }),
    );
    return { type: "FeatureCollection", features };
  }, [position, heading]);

  const data = useRef({ heads, trail, user });
  data.current = { heads, trail, user };

  useMapLayers((m) => {
    void ensureImage(m, HEAD_IMAGE, headSvg(false));
    void ensureImage(m, HEAD_IMAGE_ACTIVE, headSvg(true));
    void ensureImage(m, ARROW_IMAGE, arrowSvg());
    void ensureImage(m, DOT_IMAGE, dotSvg());

    if (!m.getSource(SOURCE_IDS.homeTrail)) m.addSource(SOURCE_IDS.homeTrail, { type: "geojson", data: data.current.trail });
    if (!m.getSource(SOURCE_IDS.homeHeads)) m.addSource(SOURCE_IDS.homeHeads, { type: "geojson", data: data.current.heads });
    if (!m.getSource(SOURCE_IDS.homeUser)) m.addSource(SOURCE_IDS.homeUser, { type: "geojson", data: data.current.user });

    // Tracé : un liseré blanc dessous pour rester lisible sur fond topographique.
    addLayerOrdered(m, {
      id: LAYER_IDS.homeTrailCasing,
      type: "line",
      source: SOURCE_IDS.homeTrail,
      paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 16, 11], "line-opacity": 0.9 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.homeTrail,
      type: "line",
      source: SOURCE_IDS.homeTrail,
      paint: { "line-color": TRAIL_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 6] },
      layout: { "line-cap": "round", "line-join": "round" },
    });

    addLayerOrdered(m, {
      id: LAYER_IDS.homeHeads,
      type: "symbol",
      source: SOURCE_IDS.homeHeads,
      layout: {
        "icon-image": ["get", "image"],
        "icon-size": ["case", ["==", ["get", "active"], true], 0.82, 0.68],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    // Le nom ne s'affiche qu'au zoom où il ne masque pas la carte.
    addLayerOrdered(m, {
      id: LAYER_IDS.homeHeadLabels,
      type: "symbol",
      source: SOURCE_IDS.homeHeads,
      minzoom: 12,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-offset": [0, 1.5],
        "text-anchor": "top",
        "text-max-width": 9,
        "text-allow-overlap": false,
      },
      paint: { "text-color": "#14351B", "text-halo-color": "#FFFFFF", "text-halo-width": 1.6 },
    });

    addLayerOrdered(m, {
      id: LAYER_IDS.homeAccuracy,
      type: "fill",
      source: SOURCE_IDS.homeUser,
      filter: ["==", ["get", "kind"], "accuracy"],
      paint: { "fill-color": USER_COLOR, "fill-opacity": 0.1 },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.homeMarkerHalo,
      type: "circle",
      source: SOURCE_IDS.homeUser,
      filter: ["==", ["get", "kind"], "marker"],
      paint: { "circle-radius": 22, "circle-color": USER_COLOR, "circle-opacity": 0.16, "circle-pitch-alignment": "map" },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.homeMarker,
      type: "symbol",
      source: SOURCE_IDS.homeUser,
      filter: ["==", ["get", "kind"], "marker"],
      layout: {
        "icon-image": ["get", "image"],
        "icon-rotate": ["get", "heading"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });

    return () => {
      for (const id of [
        LAYER_IDS.homeMarker,
        LAYER_IDS.homeMarkerHalo,
        LAYER_IDS.homeAccuracy,
        LAYER_IDS.homeHeadLabels,
        LAYER_IDS.homeHeads,
        LAYER_IDS.homeTrail,
        LAYER_IDS.homeTrailCasing,
      ]) {
        removeLayerSafe(m, id);
      }
      for (const id of [SOURCE_IDS.homeUser, SOURCE_IDS.homeHeads, SOURCE_IDS.homeTrail]) removeSourceSafe(m, id);
    };
  }, [styleVersion]);

  useEffect(() => {
    if (!isMapAlive(map) || !ready) return;
    geoJsonSource(map, SOURCE_IDS.homeHeads)?.setData(heads);
  }, [map, ready, styleVersion, heads]);

  useEffect(() => {
    if (!isMapAlive(map) || !ready) return;
    geoJsonSource(map, SOURCE_IDS.homeTrail)?.setData(trail);
  }, [map, ready, styleVersion, trail]);

  useEffect(() => {
    if (!isMapAlive(map) || !ready) return;
    geoJsonSource(map, SOURCE_IDS.homeUser)?.setData(user);
  }, [map, ready, styleVersion, user]);

  // Un tap sur une épingle sélectionne la randonnée : même geste que dans la liste.
  useEffect(() => {
    if (!isMapAlive(map) || !ready) return;
    const onClick = (e: MapMouseEvent & { features?: { properties?: Record<string, unknown> }[] }) => {
      const id = e.features?.[0]?.properties?.trailId;
      if (typeof id === "string") onSelectTrail(id);
    };
    map.on("click", LAYER_IDS.homeHeads, onClick);
    const releaseCursor = pointerCursorOn(map, LAYER_IDS.homeHeads);
    return () => {
      if (isMapAlive(map)) map.off("click", LAYER_IDS.homeHeads, onClick);
      releaseCursor?.();
    };
  }, [map, ready, styleVersion, onSelectTrail]);

  return null;
}
