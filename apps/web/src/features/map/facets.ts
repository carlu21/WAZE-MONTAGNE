/**
 * Facettes de la catégorie « Chasse / activités » (section 11) : la liste des filtres
 * distingue « Chasse » et « Activités » alors que la taxonomie n'a qu'une catégorie.
 * Le masquage se fait côté client par sous-types exclus (useUiStore().excludedSubtypes).
 */
import type { ReportSubtype } from "@mountain-live/core";

export const HUNTING_SUBTYPES: readonly ReportSubtype[] = ["hunting", "battue", "zone_occupied"];
export const OTHER_ACTIVITY_SUBTYPES: readonly ReportSubtype[] = ["forestry_works", "sport_event", "pastoral_activity"];

export type ActivityFacet = "hunting" | "activities";
export const FACET_SUBTYPES: Record<ActivityFacet, readonly ReportSubtype[]> = { hunting: HUNTING_SUBTYPES, activities: OTHER_ACTIVITY_SUBTYPES };

export function isFacetExcluded(facet: ActivityFacet, excluded: readonly ReportSubtype[]): boolean {
  return FACET_SUBTYPES[facet].every((s) => excluded.includes(s));
}

/** Filtre une liste de signalements selon les sous-types exclus. */
export function applyExcludedSubtypes<T extends { subtype: ReportSubtype }>(items: readonly T[], excluded: readonly ReportSubtype[]): T[] {
  if (excluded.length === 0) return items as T[];
  return items.filter((r) => !excluded.includes(r.subtype));
}

/**
 * Nouvel état (catégories, sous-types exclus) après un tap sur la puce d'une facette.
 * - facette active → on la masque (si les deux facettes finissent masquées, la catégorie est retirée) ;
 * - facette inactive → on l'affiche (catégorie ajoutée si les filtres sont restreints).
 */
export function toggleFacet(
  facet: ActivityFacet,
  filters: readonly string[],
  excluded: readonly ReportSubtype[],
): { filters: string[]; excluded: ReportSubtype[] } {
  const other: ActivityFacet = facet === "hunting" ? "activities" : "hunting";
  const categoryOn = filters.length === 0 || filters.includes("activity");
  const facetOn = categoryOn && !isFacetExcluded(facet, excluded);
  const otherOn = categoryOn && !isFacetExcluded(other, excluded);
  if (facetOn) {
    if (!otherOn || filters.length === 0) {
      // Dernière facette visible (ou « tout afficher ») : on restreint aux autres catégories.
      const base = filters.length === 0 ? ["danger", "path", "animals", "water", "crowd"] : filters.filter((c) => c !== "activity");
      const nextExcluded = otherOn ? [...FACET_SUBTYPES[facet]] : [];
      return { filters: otherOn ? [...filters.length ? filters : base, ...(filters.length ? [] : ["activity"])] : base, excluded: otherOn ? nextExcluded : [] };
    }
    return { filters: [...filters], excluded: [...new Set([...excluded, ...FACET_SUBTYPES[facet]])] };
  }
  const nextFilters = filters.length === 0 || filters.includes("activity") ? [...filters] : [...filters, "activity"];
  const nextExcluded = excluded.filter((s) => !FACET_SUBTYPES[facet].includes(s));
  // Si l'autre facette n'était pas visible, elle doit rester masquée.
  const keepOtherHidden = !otherOn ? [...FACET_SUBTYPES[other]] : [];
  return { filters: nextFilters, excluded: [...new Set([...nextExcluded, ...keepOtherHidden])] };
}
