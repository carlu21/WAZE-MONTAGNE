import type { Area, AreaType } from "@mountain-live/core";

export const AREA_TYPE_ORDER: readonly AreaType[] = ["commune", "hamlet", "massif", "trail", "summit", "pass", "refuge", "lake", "spring", "place"];
export const AREA_TYPE_PLURAL: Record<AreaType, string> = {
  commune: "Communes",
  massif: "Massifs",
  trail: "Sentiers",
  summit: "Sommets",
  pass: "Cols",
  refuge: "Refuges",
  lake: "Lacs",
  place: "Lieux",
  hamlet: "Lieux-dits et hameaux",
  spring: "Sources",
};

/** Regroupe des résultats de recherche par type, dans l'ordre d'affichage. */
export function groupAreasByType(areas: readonly Area[]): { type: AreaType; label: string; items: Area[] }[] {
  const map = new Map<AreaType, Area[]>();
  for (const a of areas) {
    const list = map.get(a.type) ?? [];
    list.push(a);
    map.set(a.type, list);
  }
  return AREA_TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({ type: t, label: AREA_TYPE_PLURAL[t], items: map.get(t)! }));
}

export const RECENT_AREAS_KEY = "ml.recentAreas";

export function loadRecentAreas(): Area[] {
  try {
    const raw = localStorage.getItem(RECENT_AREAS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Area[]).filter((a) => a && typeof a.id === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentArea(area: Area): void {
  try {
    const list = [area, ...loadRecentAreas().filter((a) => a.id !== area.id)].slice(0, 6);
    localStorage.setItem(RECENT_AREAS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Secteurs populaires du pilote corse (recherchés par nom au chargement). */
export const POPULAR_SECTORS: readonly string[] = ["GR20", "Bavella", "Restonica", "Monte Cinto", "Lac de Nino", "Col de Vergio"];
