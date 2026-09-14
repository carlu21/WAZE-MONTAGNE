/**
 * Présentation des lieux (Area) : libellés de type, icônes, zoom de cadrage.
 * Partagé par la recherche de la carte ; réutilisable par la page Explorer.
 */
import type { Area, AreaType } from "@mountain-live/core";

export const AREA_TYPE_LABELS: Record<AreaType, string> = {
  commune: "Commune",
  massif: "Massif",
  trail: "Sentier",
  summit: "Sommet",
  pass: "Col",
  place: "Lieu",
  refuge: "Refuge",
  lake: "Lac",
};

/** Icônes lucide (kebab-case) par type de lieu. */
export const AREA_TYPE_ICONS: Record<AreaType, string> = {
  commune: "building-2",
  massif: "mountain",
  trail: "route",
  summit: "mountain-snow",
  pass: "signpost",
  place: "map-pin",
  refuge: "house",
  lake: "waves",
};

/** Zoom de cadrage quand le lieu n'a pas d'emprise (bbox). */
export const AREA_TYPE_ZOOM: Record<AreaType, number> = {
  commune: 12.5,
  massif: 11,
  trail: 12.5,
  summit: 13.5,
  pass: 13.5,
  place: 13.5,
  refuge: 14,
  lake: 13.5,
};

export function areaTypeLabel(type: AreaType | string): string {
  return (AREA_TYPE_LABELS as Record<string, string>)[type] ?? "Lieu";
}

/** Sous-titre d'un lieu : « Sommet · 2 706 m ». */
export function areaSubtitle(area: Area, formatElevation: (m: number) => string): string {
  const parts = [areaTypeLabel(area.type)];
  if (area.elevation !== null && Number.isFinite(area.elevation)) parts.push(formatElevation(area.elevation));
  return parts.join(" · ");
}
