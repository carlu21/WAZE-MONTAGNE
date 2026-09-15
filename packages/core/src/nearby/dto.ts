/**
 * Contrat de transport de l'écran d'accueil : ce que l'API sert à la carte et
 * au panneau « Randonnées autour de vous ».
 */
import type { LngLat } from "../geo";
import type { NearbySort, NearbyTrail } from "./types";

export interface NearbyRequest {
  lat: number;
  lng: number;
  /** Filtre d'activité ; « all » ne filtre pas. */
  activity?: string;
  sort?: NearbySort;
  limit?: number;
  /** Rayon imposé (m) : sinon la recherche s'élargit d'elle-même. */
  radiusM?: number;
}

export interface NearbyResponse {
  trails: NearbyTrail[];
  radiusM: number;
  widened: boolean;
  sort: NearbySort;
  note: string | null;
  generatedAt: string;
}

/** Tracé complet d'un itinéraire, chargé à la sélection d'une carte. */
export interface TrailGeometryResponse {
  id: string;
  name: string;
  coordinates: LngLat[];
  elevations: number[] | null;
}
