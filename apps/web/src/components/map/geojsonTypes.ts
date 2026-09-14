/**
 * Types GeoJSON minimaux (RFC 7946) utilisés par les couches de la carte.
 * `@types/geojson` n'est pas exposé à l'application (pnpm strict) ; ces types
 * sont structurellement compatibles avec ce qu'attend MapLibre.
 */
export type Position = [lng: number, lat: number] | [lng: number, lat: number, elevation: number];

export interface Point {
  type: "Point";
  coordinates: Position;
}

export interface LineString {
  type: "LineString";
  coordinates: Position[];
}

export interface Polygon {
  type: "Polygon";
  coordinates: Position[][];
}

export type Geometry = Point | LineString | Polygon;

export type Properties = Record<string, unknown> | null;

export interface Feature<G extends Geometry = Geometry, P extends Properties = Properties> {
  type: "Feature";
  id?: string | number;
  geometry: G;
  properties: P;
}

export interface FeatureCollection<G extends Geometry = Geometry, P extends Properties = Properties> {
  type: "FeatureCollection";
  features: Feature<G, P>[];
}
