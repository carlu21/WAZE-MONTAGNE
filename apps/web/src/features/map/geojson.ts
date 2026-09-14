/**
 * Construction des données GeoJSON des couches de la carte (fonctions pures,
 * testées dans geojson.test.ts) et règles du zoom intelligent (section 10).
 *
 * Zoom intelligent : sous le zoom 10 seuls les signalements de priorité 3
 * (dangers majeurs, chasse, fermetures…) sont affichés ; sous le zoom 12 les
 * priorités ≥ 2 ; au-delà, tout. La règle existe sous deux formes cohérentes :
 * - `priorityThresholdForZoom` / `filterByZoom` : filtrage des données (les
 *   clusters ne comptent que ce qui est visible) ;
 * - `zoomPriorityFilter` : expression MapLibre appliquée à la couche.
 */
import type { FilterSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Point, Polygon, Position, Properties } from "@/components/map/geojsonTypes";
import {
  SUBTYPE_BY_ID,
  type LatLng,
  type OfficialAlert,
  type PresenceCell,
  type Report,
  type ReportCategory,
  type ReportSubtype,
} from "@mountain-live/core";
import { categoryMarkerImageId, markerImageId, markerVariantFor } from "@/components/map/markers";

export type Priority = 1 | 2 | 3;

/** Seuils de zoom du zoom intelligent. */
export const ZOOM_PRIORITY_3_BELOW = 10;
export const ZOOM_PRIORITY_2_BELOW = 12;

/** Rayon (m) du halo « position approximative » des espèces sensibles (floutage serveur ≤ 400 m). */
export const BLUR_RADIUS_M = 400;

export type ReportFeatureProperties = {
  id: string;
  subtype: ReportSubtype;
  category: ReportCategory;
  priority: Priority;
  /** Opacité 0,35..1 (ancienneté, section 5). */
  fade: number;
  official: boolean;
  blurred: boolean;
  /** Identifiant d'image MapLibre (markers.ts). */
  markerImage: string;
  /** Rayon du halo de floutage en px au zoom 20 (voir `metersToPixelsAtZoom`). */
  blurPx20: number;
};

export type ReportFeature = Feature<Point, ReportFeatureProperties>;
export type ReportFeatureCollection = FeatureCollection<Point, ReportFeatureProperties>;

export const EMPTY_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

/** Priorité d'affichage d'un signalement (taxonomie ; 2 si le sous-type est inconnu). */
export function reportPriority(report: Pick<Report, "subtype">): Priority {
  return SUBTYPE_BY_ID[report.subtype]?.priority ?? 2;
}

/** Priorité minimale visible à ce zoom : 3 sous 10, 2 sous 12, sinon 1. */
export function priorityThresholdForZoom(zoom: number): Priority {
  if (!Number.isFinite(zoom)) return 1;
  if (zoom < ZOOM_PRIORITY_3_BELOW) return 3;
  if (zoom < ZOOM_PRIORITY_2_BELOW) return 2;
  return 1;
}

export function isVisibleAtZoom(priority: number, zoom: number): boolean {
  return priority >= priorityThresholdForZoom(zoom);
}

/** Signalements visibles à ce zoom (données transmises à la source groupée). */
export function filterByZoom<T extends Pick<Report, "subtype">>(reports: readonly T[], zoom: number): T[] {
  const min = priorityThresholdForZoom(zoom);
  return min === 1 ? [...reports] : reports.filter((r) => reportPriority(r) >= min);
}

/**
 * Expression de filtre MapLibre équivalente, sur la propriété `priority`
 * (évaluée aux zooms entiers, comme tout filtre utilisant ["zoom"]).
 */
export function zoomPriorityFilter(): FilterSpecification {
  return [
    "case",
    ["<", ["zoom"], ZOOM_PRIORITY_3_BELOW],
    [">=", ["coalesce", ["get", "priority"], 2], 3],
    ["<", ["zoom"], ZOOM_PRIORITY_2_BELOW],
    [">=", ["coalesce", ["get", "priority"], 2], 2],
    true,
  ] as unknown as FilterSpecification;
}

/** Mètres/pixel de la projection Web Mercator (tuiles de 512 px) à un zoom et une latitude. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** Taille en px d'une distance au sol, à un zoom donné (pour les expressions « exponential 2 »). */
export function metersToPixelsAtZoom(meters: number, lat: number, zoom: number): number {
  const mpp = metersPerPixel(lat, zoom);
  return mpp > 0 ? meters / mpp : 0;
}

function clampFade(fade: unknown): number {
  const f = typeof fade === "number" && Number.isFinite(fade) ? fade : 1;
  return Math.min(1, Math.max(0.35, f));
}

export function reportToFeature(report: Report, selected = false): ReportFeature {
  const official = report.source === "official";
  return {
    type: "Feature",
    id: report.id,
    geometry: { type: "Point", coordinates: [report.lng, report.lat] },
    properties: {
      id: report.id,
      subtype: report.subtype,
      category: report.category,
      priority: reportPriority(report),
      fade: clampFade(report.fade),
      official,
      blurred: Boolean(report.blurred),
      markerImage: markerImageId(report.subtype, markerVariantFor(report.source, selected)),
      blurPx20: report.blurred ? Math.round(metersToPixelsAtZoom(BLUR_RADIUS_M, report.lat, 20)) : 0,
    },
  };
}

export interface ToFeatureCollectionOptions {
  /** Priorité minimale (voir `priorityThresholdForZoom`). Défaut : 1 (tout). */
  minPriority?: Priority;
  /** Signalement sélectionné : image « selected ». */
  selectedId?: string | null;
}

/**
 * Collection des signalements pour la source groupée. Les entrées sans
 * coordonnées valides sont ignorées ; l'ordre d'entrée est conservé
 * (l'API trie déjà par priorité puis récence).
 */
export function toFeatureCollection(reports: readonly Report[], opts: ToFeatureCollectionOptions = {}): ReportFeatureCollection {
  const min = opts.minPriority ?? 1;
  const features: ReportFeature[] = [];
  for (const r of reports) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    if (reportPriority(r) < min) continue;
    features.push(reportToFeature(r, opts.selectedId === r.id));
  }
  return { type: "FeatureCollection", features };
}

/* ------------------------------------------------------------------ */
/* Alertes officielles                                                  */
/* ------------------------------------------------------------------ */

export type AlertFeatureProperties = {
  id: string;
  title: string;
  organisation: string;
  category: ReportCategory;
  severity: OfficialAlert["severity"];
  markerImage: string;
};

export interface AlertCollections {
  polygons: FeatureCollection<Polygon, AlertFeatureProperties>;
  points: FeatureCollection<Point, AlertFeatureProperties>;
}

function alertProperties(a: OfficialAlert): AlertFeatureProperties {
  return {
    id: a.id,
    title: a.title,
    organisation: a.organisation,
    category: a.category,
    severity: a.severity,
    markerImage: categoryMarkerImageId(a.category, "official"),
  };
}

/**
 * Alertes officielles : les polygones alimentent une couche de remplissage,
 * et chaque alerte (point ou centroïde du polygone) reçoit un marqueur « officiel ».
 */
export function alertsToCollections(alerts: readonly OfficialAlert[]): AlertCollections {
  const polygons: AlertCollections["polygons"] = { type: "FeatureCollection", features: [] };
  const points: AlertCollections["points"] = { type: "FeatureCollection", features: [] };
  for (const a of alerts) {
    const props = alertProperties(a);
    if (a.geometry.type === "Polygon" && a.geometry.coordinates.length > 0) {
      polygons.features.push({ type: "Feature", id: a.id, geometry: { type: "Polygon", coordinates: a.geometry.coordinates }, properties: props });
    }
    const lng = a.geometry.type === "Point" ? a.geometry.coordinates[0] : a.centroidLng;
    const lat = a.geometry.type === "Point" ? a.geometry.coordinates[1] : a.centroidLat;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      points.features.push({ type: "Feature", id: a.id, geometry: { type: "Point", coordinates: [lng, lat] }, properties: props });
    }
  }
  return { polygons, points };
}

/* ------------------------------------------------------------------ */
/* Présence agrégée (section 8 : jamais de position individuelle)       */
/* ------------------------------------------------------------------ */

export type PresenceFeatureProperties = {
  count: number;
};

/** Cellules de présence (~1 km) → points pondérés pour la carte thermique. */
export function presenceToCollection(cells: readonly PresenceCell[]): FeatureCollection<Point, PresenceFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: cells
      .filter((c) => c.count > 0 && Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map((c) => ({
        type: "Feature",
        id: c.cell,
        geometry: { type: "Point", coordinates: [c.lng, c.lat] },
        properties: { count: c.count },
      })),
  };
}

/* ------------------------------------------------------------------ */
/* Géométrie utilitaire                                                 */
/* ------------------------------------------------------------------ */

/** Polygone approchant un cercle géodésique (cercle de précision GPS). */
export function circlePolygon(center: LatLng, radiusM: number, steps = 48): Feature<Polygon, Record<string, never>> {
  const r = Math.max(0, radiusM);
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.max(0.01, Math.cos((center.lat * Math.PI) / 180)));
  const ring: Position[] = [];
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([center.lng + dLng * Math.cos(a), center.lat + dLat * Math.sin(a)]);
  }
  ring.push(ring[0]);
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} };
}

export function pointFeature<P extends Properties = Record<string, unknown>>(p: LatLng, properties: P): Feature<Point, P> {
  return { type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] }, properties };
}
