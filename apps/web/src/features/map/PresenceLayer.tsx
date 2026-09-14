/**
 * Fréquentation agrégée (section 8) : carte thermique légère construite à
 * partir des cellules ~1 km de GET /presence — jamais de position individuelle.
 * Visible sous le zoom 13 ; l'estimation globale est remontée au parent pour
 * l'aperçu de zone (« Environ N utilisateurs actifs dans cette zone »).
 */
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { PRESENCE_CELL_DEG, type BBox } from "@mountain-live/core";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useUiStore } from "@/store/ui";
import { isMapAlive, useMap, useMapLayers } from "@/components/map/MapView";
import { LAYER_IDS, SOURCE_IDS, addLayerOrdered, geoJsonSource, removeLayerSafe, removeSourceSafe } from "@/components/map/layers";
import { EMPTY_COLLECTION, presenceToCollection } from "./geojson";

export interface PresenceLayerProps {
  /** Bbox de la vue (non élargie). */
  bbox: BBox | null;
  onEstimate?: (activeUsers: number) => void;
}

/** Zoom à partir duquel la carte thermique disparaît (section 8 : pas de détail). */
export const PRESENCE_MAX_ZOOM = 13;
export const PRESENCE_REFETCH_MS = 60_000;

/** Bbox alignée sur la grille des cellules (0,01°) : clé de requête stable. */
export function presenceBBoxFor(bbox: BBox): BBox {
  const step = PRESENCE_CELL_DEG;
  const snap = (v: number, fn: (x: number) => number) => Number((fn(v / step) * step).toFixed(4));
  return { west: snap(bbox.west, Math.floor), south: snap(bbox.south, Math.floor), east: snap(bbox.east, Math.ceil), north: snap(bbox.north, Math.ceil) };
}

export function PresenceLayer({ bbox, onEstimate }: PresenceLayerProps) {
  const { map, ready, styleVersion } = useMap();
  const online = useUiStore((s) => s.online);
  const key = bbox ? `${bbox.west},${bbox.south},${bbox.east},${bbox.north}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const queryBBox = useMemo(() => (bbox ? presenceBBoxFor(bbox) : null), [key]);

  const { data } = useQuery({
    queryKey: queryBBox ? qk.presence(queryBBox) : ["presence", "none"],
    queryFn: () => api.presence.get(queryBBox as BBox),
    enabled: queryBBox !== null && online,
    refetchInterval: online ? PRESENCE_REFETCH_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: false,
  });

  const estimate = data?.activeUsersEstimate ?? 0;
  const onEstimateRef = useRef(onEstimate);
  onEstimateRef.current = onEstimate;
  useEffect(() => {
    onEstimateRef.current?.(online ? estimate : 0);
  }, [estimate, online]);

  const collection = useMemo(() => (data ? presenceToCollection(data.cells) : EMPTY_COLLECTION), [data]);
  const dataRef = useRef(collection);
  dataRef.current = collection;
  const installed = useRef<unknown>(null);

  useMapLayers((m) => {
    if (!m.getSource(SOURCE_IDS.presence)) m.addSource(SOURCE_IDS.presence, { type: "geojson", data: dataRef.current });
    installed.current = dataRef.current;
    addLayerOrdered(m, {
      id: LAYER_IDS.presenceHeat,
      type: "heatmap",
      source: SOURCE_IDS.presence,
      maxzoom: PRESENCE_MAX_ZOOM,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["coalesce", ["get", "count"], 1], 1, 0.35, 5, 0.7, 15, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 6, 0.6, PRESENCE_MAX_ZOOM, 1.1],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 12, 10, 24, PRESENCE_MAX_ZOOM, 46],
        // Vert forêt (faible) → vert clair → or → orange sécurité (forte). Jamais de rouge : réservé aux dangers.
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(47, 107, 58, 0)",
          0.2,
          "rgba(47, 107, 58, 0.35)",
          0.5,
          "rgba(143, 191, 152, 0.6)",
          0.8,
          "rgba(201, 162, 39, 0.7)",
          1,
          "rgba(217, 130, 43, 0.8)",
        ],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], PRESENCE_MAX_ZOOM - 1.5, 0.55, PRESENCE_MAX_ZOOM, 0],
      },
    });
    return () => {
      removeLayerSafe(m, LAYER_IDS.presenceHeat);
      removeSourceSafe(m, SOURCE_IDS.presence);
      installed.current = null;
    };
  });

  useEffect(() => {
    if (!map || !ready || !isMapAlive(map) || installed.current === collection) return;
    const source = geoJsonSource(map, SOURCE_IDS.presence);
    if (!source) return;
    source.setData(collection);
    installed.current = collection;
  }, [map, ready, styleVersion, collection]);

  return null;
}
