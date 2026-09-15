/**
 * Données de la carte de fréquentation (section 12 du moteur cartographique).
 *
 * L'emprise est arrondie pour éviter une requête à chaque pixel de
 * déplacement, et la couche n'est interrogée qu'à partir d'un certain zoom :
 * à l'échelle d'une île, une heatmap de sentiers n'a aucun sens.
 */
import { useQuery } from "@tanstack/react-query";
import type { ActivityMode, BBox, HeatmapPeriod, HeatmapResponse } from "@mountain-live/core";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useUiStore } from "@/store/ui";

/** Zoom minimal d'affichage de la fréquentation. */
export const HEATMAP_MIN_ZOOM = 11;

/** Arrondi de l'emprise (degrés) : une requête couvre les petits déplacements. */
export function roundBBox(b: BBox, step = 0.02): BBox {
  const down = (v: number) => Math.floor(v / step) * step;
  const up = (v: number) => Math.ceil(v / step) * step;
  return { west: down(b.west), south: down(b.south), east: up(b.east), north: up(b.north) };
}

export interface HeatmapState {
  data: HeatmapResponse | null;
  isLoading: boolean;
  /** Le zoom est trop faible pour afficher la fréquentation. */
  zoomedOut: boolean;
}

export function useHeatmap(bbox: BBox | null, zoom: number): HeatmapState {
  const { enabled, period, activity } = useUiStore((s) => s.heatmap);
  const online = useUiStore((s) => s.online);
  const zoomedOut = zoom < HEATMAP_MIN_ZOOM;
  const box = bbox ? roundBBox(bbox) : null;
  const query = useQuery({
    queryKey: qk.heatmap(box ?? { west: 0, south: 0, east: 0, north: 0 }, period, activity),
    queryFn: () => api.network.heatmap({ bbox: box!, period: period as HeatmapPeriod, activity: activity as ActivityMode | "all" }),
    enabled: enabled && online && box !== null && !zoomedOut,
    staleTime: 5 * 60_000,
  });
  return { data: query.data ?? null, isLoading: query.isFetching, zoomedOut };
}
