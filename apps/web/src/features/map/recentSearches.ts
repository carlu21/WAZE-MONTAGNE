/**
 * Recherches récentes de lieux (localStorage, 6 entrées maximum).
 * Tolérant : un stockage indisponible (navigation privée) ne casse rien.
 */
import type { Area } from "@mountain-live/core";

export const RECENT_SEARCHES_KEY = "ml.recentSearches";
export const RECENT_SEARCHES_MAX = 6;

export function loadRecentSearches(): Area[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is Area => typeof a === "object" && a !== null && typeof (a as Area).id === "string" && typeof (a as Area).name === "string",
    );
  } catch {
    return [];
  }
}

function persist(list: Area[]): void {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    /* stockage indisponible */
  }
}

/** Place le lieu en tête (sans doublon) et renvoie la nouvelle liste. */
export function pushRecentSearch(area: Area): Area[] {
  const list = [area, ...loadRecentSearches().filter((a) => a.id !== area.id)].slice(0, RECENT_SEARCHES_MAX);
  persist(list);
  return list;
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    /* stockage indisponible */
  }
}
