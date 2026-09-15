/**
 * Randonnées autour de la position (sections 10, 17, 18).
 *
 * La requête n'est lancée qu'une fois la position connue : proposer des
 * randonnées « proches » d'un centre de carte arbitraire tromperait sur la
 * seule chose que cet écran promet. Le rayon s'élargit côté serveur, et la
 * position est arrondie pour ne pas relancer la requête à chaque pas.
 */
import { useQuery } from "@tanstack/react-query";
import type { ActivityMode, NearbyResponse, NearbySort } from "@mountain-live/core";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useUiStore } from "@/store/ui";

/**
 * Arrondi de la position servant de clé de requête : ~100 m. En dessous, la
 * liste se rejouerait à chaque relevé GPS pour un résultat identique.
 */
export const NEARBY_POSITION_PRECISION = 3;

export interface NearbyState {
  data: NearbyResponse | null;
  isLoading: boolean;
  /** Position connue ? Sinon l'écran demande l'autorisation plutôt que de deviner. */
  hasPosition: boolean;
  error: unknown;
}

export function roundPosition(value: number, precision = NEARBY_POSITION_PRECISION): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function useNearby(opts: { activity: ActivityMode | "all"; sort: NearbySort; limit?: number }): NearbyState {
  const position = useUiStore((s) => s.position);
  const online = useUiStore((s) => s.online);
  const lat = position ? roundPosition(position.lat) : null;
  const lng = position ? roundPosition(position.lng) : null;

  const query = useQuery({
    queryKey: qk.nearby({ lat, lng, activity: opts.activity, sort: opts.sort, limit: opts.limit ?? 12 }),
    queryFn: () =>
      api.nearbyTrails({
        lat: lat as number,
        lng: lng as number,
        activity: opts.activity,
        sort: opts.sort,
        limit: opts.limit ?? 12,
      }),
    enabled: lat !== null && lng !== null && online,
    staleTime: 5 * 60_000,
  });

  return {
    data: query.data ?? null,
    isLoading: query.isFetching,
    hasPosition: lat !== null && lng !== null,
    error: query.error,
  };
}
