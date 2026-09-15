/**
 * Contrat de transport de l'écran d'accueil : ce que l'API sert à la carte et
 * au panneau « Randonnées autour de vous ».
 */
import type { LngLat } from "../geo";
import type { PathSource } from "../navigation/types";
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
  /**
   * Provenance du tracé : `osm`, `ign` ou `gpx` = relevé réel ; `seed` ou
   * `local` = démonstration ou brouillon. `null` quand elle est inconnue.
   * L'affichage refuse de présenter comme itinéraire un tracé non relevé
   * (`routeVerdict`) : une jolie ligne sur des données fictives reste fictive.
   */
  source: PathSource | null;
  /** Longueur annoncée par la fiche (m) : sert à repérer un tracé qui coupe au plus court. */
  declaredLengthM: number | null;
}
