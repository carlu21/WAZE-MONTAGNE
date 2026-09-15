/**
 * Représentation de la fréquentation (section 12 du moteur cartographique),
 * isolée de la carte pour rester testable et réutilisable : une couleur par
 * niveau, une intensité comparable d'un chemin à l'autre.
 */
import type { FrequentationLevel, HeatmapResponse } from "@mountain-live/core";
import type { FeatureCollection } from "@/components/map/geojsonTypes";
import { EMPTY_COLLECTION } from "@/features/map/geojson";

/** Couleurs par niveau : progression sobre, lisible en plein soleil comme en sombre. */
export const FREQUENTATION_COLORS: Record<FrequentationLevel, string> = {
  unknown: "#9AA6A0",
  very_low: "#7FA8C9",
  low: "#4E9A6B",
  moderate: "#D9A21B",
  high: "#E8730C",
  very_high: "#C8341F",
};

export function heatmapCollection(data: HeatmapResponse | null): FeatureCollection {
  if (!data || data.segments.length === 0) return EMPTY_COLLECTION;
  const max = Math.max(1, data.maxPassages);
  return {
    type: "FeatureCollection",
    features: data.segments.map((s) => ({
      type: "Feature",
      id: s.segmentId,
      geometry: { type: "LineString", coordinates: s.coordinates.map((c) => [c[0], c[1]]) },
      properties: {
        segmentId: s.segmentId,
        passages: s.passages,
        // Intensité 0..1 en racine : quelques chemins très fréquentés ne doivent
        // pas écraser visuellement tous les autres.
        intensity: Math.sqrt(Math.min(1, s.passages / max)),
        color: FREQUENTATION_COLORS[s.frequentation],
        insufficient: s.insufficientData,
      },
    })),
  };
}
