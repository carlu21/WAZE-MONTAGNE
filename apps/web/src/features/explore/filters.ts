/**
 * Filtres de découverte de la page EXPLORER.
 *
 * Explorer n'est PAS une seconde carte principale : c'est là qu'on cherche où
 * aller. Trois axes, ceux qu'on se pose vraiment avant de partir — combien de
 * temps, quelle difficulté, quelle activité — plus « à proximité », qui est un
 * tri et non un filtre (il ne cache rien, il rapproche).
 */
import type { ActivityMode, NearbyTrail } from "@mountain-live/core";

export type DurationFilter = "all" | "short" | "half" | "day";
export type DifficultyFilter = "all" | "easy" | "moderate" | "hard";

export const DURATION_OPTIONS: { id: DurationFilter; label: string }[] = [
  { id: "all", label: "Toutes durées" },
  { id: "short", label: "< 2 h" },
  { id: "half", label: "2 – 4 h" },
  { id: "day", label: "Journée" },
];

export const DIFFICULTY_OPTIONS: { id: DifficultyFilter; label: string }[] = [
  { id: "all", label: "Toutes difficultés" },
  { id: "easy", label: "Facile" },
  { id: "moderate", label: "Intermédiaire" },
  { id: "hard", label: "Difficile" },
];

export const ACTIVITY_OPTIONS: { id: ActivityMode | "all"; label: string }[] = [
  { id: "all", label: "Toutes activités" },
  { id: "hiking", label: "Randonnée" },
  { id: "trail", label: "Trail" },
  { id: "mtb", label: "VTT" },
  { id: "equestrian", label: "Cheval" },
];

const HOUR = 3_600_000;

export function matchesDuration(durationMs: number, filter: DurationFilter): boolean {
  switch (filter) {
    case "short":
      return durationMs <= 2 * HOUR;
    case "half":
      return durationMs > 2 * HOUR && durationMs <= 4 * HOUR;
    case "day":
      return durationMs > 4 * HOUR;
    default:
      return true;
  }
}

/** « Difficile » englobe les parcours d'experts : personne ne cherche « expert » à part. */
export function matchesDifficulty(difficulty: NearbyTrail["difficulty"], filter: DifficultyFilter): boolean {
  if (filter === "all") return true;
  if (filter === "hard") return difficulty === "hard" || difficulty === "expert";
  return difficulty === filter;
}

export interface ExploreFilters {
  duration: DurationFilter;
  difficulty: DifficultyFilter;
  activity: ActivityMode | "all";
  /** Limite l'affichage aux départs réellement proches (m) ; `null` = pas de limite. */
  nearbyM: number | null;
}

export const DEFAULT_EXPLORE_FILTERS: ExploreFilters = { duration: "all", difficulty: "all", activity: "all", nearbyM: null };

/** Nombre de filtres réellement actifs — affiché pour qu'on sache pourquoi la liste est courte. */
export function activeFilterCount(filters: ExploreFilters): number {
  let n = 0;
  if (filters.duration !== "all") n += 1;
  if (filters.difficulty !== "all") n += 1;
  if (filters.activity !== "all") n += 1;
  if (filters.nearbyM !== null) n += 1;
  return n;
}

export function filterTrails(trails: readonly NearbyTrail[], filters: ExploreFilters): NearbyTrail[] {
  return trails.filter(
    (t) =>
      matchesDuration(t.durationMs, filters.duration) &&
      matchesDifficulty(t.difficulty, filters.difficulty) &&
      (filters.activity === "all" || t.activity === filters.activity) &&
      (filters.nearbyM === null || t.approachM <= filters.nearbyM),
  );
}
