/**
 * Types du moteur de navigation (« Waze de la montagne ») partagés entre
 * l'API (réseau de chemins, import OSM) et le client (suivi temps réel).
 *
 * Conventions : géométries en `[lng, lat]` (GeoJSON), distances en mètres,
 * caps en degrés dans [0, 360), durées en millisecondes.
 */
import type { LatLng } from "../types";
import type { LngLat } from "../geo";

/** Activité en cours : adapte vitesse estimée, chemins praticables et seuils. */
export type ActivityMode = "hiking" | "trail" | "mtb" | "equestrian" | "other";

/** Toutes les activités, dans l'ordre d'affichage. */
export const ACTIVITY_MODES: readonly ActivityMode[] = ["hiking", "trail", "mtb", "equestrian", "other"];

/** Mode de suivi : compromis précision / batterie (section 2). */
export type TrackingMode = "eco" | "normal" | "precise";

/** Nature d'un chemin (vocabulaire OpenStreetMap simplifié). */
export type PathKind =
  | "path" // sentier
  | "track" // piste forestière / chemin d'exploitation
  | "footway" // chemin piéton aménagé
  | "bridleway" // chemin équestre
  | "cycleway" // piste cyclable
  | "steps" // escaliers
  | "road" // route ouverte (liaison)
  | "via_ferrata"
  | "unknown";

export type PathSource = "osm" | "ign" | "seed" | "gpx" | "local";

/**
 * Provenance d'un ITINÉRAIRE. Les mêmes valeurs que pour un segment, plus deux
 * qui n'ont de sens qu'à l'échelle d'un parcours : `official` (une commune, un
 * parc, un office de tourisme) et `partner` (un guide, un berger, un
 * accompagnateur). Un seul type pour les deux échelles serait plus simple mais
 * mentirait : personne ne « publie officiellement » un tronçon de 40 mètres.
 */
export type TrailSource = PathSource | "official" | "partner";

/** Segment du réseau de chemins : une arête du graphe, nœuds aux extrémités. */
export interface PathSegment {
  id: string;
  name: string | null;
  kind: PathKind;
  /** Revêtement (OSM `surface`) : ground, gravel, rock, paved… */
  surface: string | null;
  /** Difficulté alpine (OSM `sac_scale`) : hiking, mountain_hiking, … */
  sacScale: string | null;
  /** Largeur en mètres si connue. */
  widthM: number | null;
  /** Pratiques autorisées (false = interdit ou impraticable). */
  foot: boolean;
  bicycle: boolean;
  horse: boolean;
  /** Gué / traversée de rivière sur ce segment. */
  ford: boolean;
  /** Statut temporaire (fermeture administrative) ou null. */
  status: "open" | "closed" | null;
  /** Géométrie `[lng, lat][]`, au moins deux points. */
  coordinates: LngLat[];
  /** Altitudes (m) alignées sur `coordinates`, ou null si inconnues. */
  elevations: number[] | null;
  lengthM: number;
  source: PathSource;
  /**
   * Identifiant de l'objet SOURCE dont ce segment est issu, par exemple
   * `way/891234` pour OpenStreetMap. Un way découpé à ses intersections donne
   * plusieurs segments (`osm_891234_0`, `_1`, `_2`) qui partagent tous ce même
   * identifiant : c'est lui qui permet de relier une relation OSM au réseau,
   * sans analyser les chaînes de caractères des identifiants de segments.
   */
  sourceFeatureId: string | null;
}

/** Relevé de position (GPS/GNSS ou source externe). */
export interface GpsFix {
  lat: number;
  lng: number;
  /** Rayon d'incertitude horizontale (m), null si inconnu. */
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  /** Cap de déplacement fourni par le récepteur (degrés), null si inconnu. */
  heading: number | null;
  /** Vitesse sol (m/s), null si inconnue. */
  speed: number | null;
  /** Horodatage (ms epoch). */
  at: number;
}

/** Itinéraire suivi : sentier de la base, trace GPX importée ou trace inversée. */
export interface NavRoute {
  id: string;
  name: string;
  coordinates: LngLat[];
  /** Altitudes alignées sur `coordinates`, ou null. */
  elevations: (number | null)[] | null;
  /** Distance cumulée (m) à chaque sommet ; `cumulative[0] === 0`. */
  cumulative: number[];
  lengthM: number;
  /** Dénivelé positif total (m) si connu (sinon calculé sur `elevations`). */
  elevationGainM: number | null;
  source: "trail" | "gpx" | "track";
}

/** Projection d'un point sur une polyligne. */
export interface Projection {
  /** Distance du point à la polyligne (m). */
  distanceM: number;
  /** Indice du segment [i, i+1] retenu. */
  index: number;
  /** Position fractionnaire sur ce segment (0..1). */
  t: number;
  /** Point projeté. */
  snapped: LatLng;
  /** Abscisse curviligne (m) depuis le début de la polyligne. */
  along: number;
  /** Cap du segment retenu (degrés). */
  segmentBearing: number;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  alt: number | null;
  at: number;
  accuracy: number | null;
}

export type GpsQuality = "good" | "fair" | "poor" | "lost";
