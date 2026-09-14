/**
 * Position de l'appareil sur la carte (section 33) : point bleu, halo et
 * cercle de précision à partir de useUiStore().position. Le bouton
 * « Me localiser » recentre la carte (zoom 14) et demande l'autorisation si nécessaire.
 */
import { useEffect, useMemo, useRef } from "react";
import { LocateFixed } from "lucide-react";
import { fr } from "@mountain-live/core";
import { useUiStore } from "@/store/ui";
import { IconButton, toast } from "@/components/ui";
import { isMapAlive, useMap, useMapLayers } from "@/components/map/MapView";
import { LAYER_IDS, SOURCE_IDS, addLayerOrdered, geoJsonSource, removeLayerSafe, removeSourceSafe } from "@/components/map/layers";
import type { FeatureCollection } from "@/components/map/geojsonTypes";
import { EMPTY_COLLECTION, circlePolygon, pointFeature } from "./geojson";
import type { GeolocationState } from "./useGeolocation";

/** Zoom de recentrage sur la position (section 33). */
export const LOCATE_ZOOM = 14;
/** Au-delà de ce délai, la position est affichée comme ancienne (grisée). */
const STALE_AFTER_MS = 5 * 60_000;
const BLUE = "#1D6FA5";

export function UserLocation() {
  const { map, ready, styleVersion } = useMap();
  const position = useUiStore((s) => s.position);

  const collection = useMemo<FeatureCollection>(() => {
    if (!position) return EMPTY_COLLECTION;
    const stale = Date.now() - position.at > STALE_AFTER_MS;
    const features: FeatureCollection["features"] = [];
    if (position.accuracy && position.accuracy > 15) {
      const circle = circlePolygon(position, position.accuracy);
      features.push({ ...circle, properties: { kind: "accuracy", stale } });
    }
    features.push(pointFeature(position, { kind: "dot", stale }));
    return { type: "FeatureCollection", features };
  }, [position]);

  const dataRef = useRef(collection);
  dataRef.current = collection;
  const installed = useRef<unknown>(null);

  useMapLayers((m) => {
    if (!m.getSource(SOURCE_IDS.user)) m.addSource(SOURCE_IDS.user, { type: "geojson", data: dataRef.current });
    installed.current = dataRef.current;
    addLayerOrdered(m, {
      id: LAYER_IDS.userAccuracy,
      type: "fill",
      source: SOURCE_IDS.user,
      filter: ["==", ["get", "kind"], "accuracy"],
      paint: { "fill-color": BLUE, "fill-opacity": 0.12, "fill-outline-color": BLUE },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.userDotHalo,
      type: "circle",
      source: SOURCE_IDS.user,
      filter: ["==", ["get", "kind"], "dot"],
      paint: { "circle-radius": 15, "circle-color": BLUE, "circle-opacity": ["case", ["==", ["get", "stale"], true], 0.1, 0.22], "circle-pitch-alignment": "map" },
    });
    addLayerOrdered(m, {
      id: LAYER_IDS.userDot,
      type: "circle",
      source: SOURCE_IDS.user,
      filter: ["==", ["get", "kind"], "dot"],
      paint: {
        "circle-radius": 7,
        "circle-color": ["case", ["==", ["get", "stale"], true], "#7A8894", BLUE],
        "circle-stroke-color": "#FFFFFF",
        "circle-stroke-width": 3,
        "circle-pitch-alignment": "map",
      },
    });
    return () => {
      for (const id of [LAYER_IDS.userDot, LAYER_IDS.userDotHalo, LAYER_IDS.userAccuracy]) removeLayerSafe(m, id);
      removeSourceSafe(m, SOURCE_IDS.user);
      installed.current = null;
    };
  });

  useEffect(() => {
    if (!map || !ready || !isMapAlive(map) || installed.current === collection) return;
    const source = geoJsonSource(map, SOURCE_IDS.user);
    if (!source) return;
    source.setData(collection);
    installed.current = collection;
  }, [map, ready, styleVersion, collection]);

  return null;
}

export interface LocateButtonProps {
  geolocation: GeolocationState;
  className?: string;
}

/** Bouton « Me localiser » : recentre sur la position (zoom 14), demande l'autorisation au besoin. */
export function LocateButton({ geolocation, className }: LocateButtonProps) {
  const { map } = useMap();
  const position = useUiStore((s) => s.position);
  const { status, request, supported } = geolocation;

  const centerOn = (p: { lat: number; lng: number }) => {
    if (!map || !isMapAlive(map)) return;
    map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(LOCATE_ZOOM, map.getZoom()), duration: 900, essential: true });
  };

  const onClick = async () => {
    if (!supported) {
      toast.warning(fr.errors.locationUnavailable);
      return;
    }
    // Position récente déjà connue : recentrage immédiat, le suivi continue en arrière-plan.
    if (position && status === "watching" && Date.now() - position.at < 30_000) {
      centerOn(position);
      return;
    }
    const p = await request();
    if (p) centerOn(p);
    else if (position) centerOn(position);
    else toast.warning(geolocation.error ?? fr.errors.locationUnavailable);
  };

  const active = status === "watching" && position !== null;
  return (
    <IconButton
      aria-label={fr.mapUi.centerOnMe}
      title={fr.mapUi.centerOnMe}
      variant="glass"
      size={52}
      loading={status === "locating"}
      pressed={active}
      onClick={() => void onClick()}
      className={className}
    >
      <LocateFixed className={active ? "text-info" : undefined} />
    </IconButton>
  );
}
