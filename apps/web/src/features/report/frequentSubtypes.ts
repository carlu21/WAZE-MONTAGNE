/**
 * Raccourcis « fréquents » de l'assistant : les 4 sous-types les plus publiés
 * sur cet appareil (compteur local, jamais envoyé au serveur), complétés par
 * des valeurs par défaut issues du cahier des charges (section 32).
 */
import { CATEGORY_BY_ID, SUBTYPE_BY_ID, isSubtype, type ReportSubtype } from "@mountain-live/core";
import { useMemo } from "react";

export const USAGE_STORAGE_KEY = "ml.report.usage";
export const SHORTCUT_COUNT = 4;

/** Arbre tombé, Chasse en cours, Troupeau / chiens de protection, Source sèche. */
export const DEFAULT_SHORTCUTS: readonly ReportSubtype[] = ["fallen_tree", "hunting", "guard_dogs", "spring_dry"];

/** Ligne secondaire des raccourcis (situation concrète plutôt que libellé de taxonomie). */
const SHORTCUT_HINTS: Partial<Record<ReportSubtype, string>> = {
  fallen_tree: "Arbre en travers du chemin",
  hunting: "Chasse ou battue en cours",
  guard_dogs: "Troupeau et patous",
  spring_dry: "Plus d'eau à la source",
  herd: "Troupeau sur le chemin",
  battue: "Battue en cours",
  rockfall: "Chute de pierres, éboulis",
  path_closed: "Accès fermé",
};

export function shortcutHint(subtype: ReportSubtype): string {
  return SHORTCUT_HINTS[subtype] ?? CATEGORY_BY_ID[SUBTYPE_BY_ID[subtype].category].label;
}

/** Sous-ensemble de Storage utilisé (injectable dans les tests). */
export type UsageStore = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): UsageStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readUsage(store: UsageStore | null = defaultStorage()): Record<string, number> {
  if (!store) return {};
  try {
    const raw = store.getItem(USAGE_STORAGE_KEY);
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (isSubtype(k) && typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
    }
    return out;
  } catch {
    return {};
  }
}

/** Incrémente le compteur d'un sous-type après une publication réussie (ou mise en file). */
export function recordSubtypeUse(subtype: ReportSubtype, store: UsageStore | null = defaultStorage()): void {
  if (!store || !isSubtype(subtype)) return;
  try {
    const usage = readUsage(store);
    usage[subtype] = (usage[subtype] ?? 0) + 1;
    store.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage));
  } catch {
    /* stockage indisponible : les raccourcis par défaut restent utilisés */
  }
}

/**
 * Sous-types à proposer en raccourci : les plus utilisés d'abord (compteur
 * décroissant, égalité départagée par l'ordre des valeurs par défaut puis de la
 * taxonomie), complétés par les valeurs par défaut jusqu'à `limit`.
 */
export function frequentSubtypes(
  limit: number = SHORTCUT_COUNT,
  store: UsageStore | null = defaultStorage(),
  defaults: readonly ReportSubtype[] = DEFAULT_SHORTCUTS,
): ReportSubtype[] {
  const usage = readUsage(store);
  const rank = (s: ReportSubtype) => {
    const i = defaults.indexOf(s);
    return i === -1 ? defaults.length + Object.keys(SUBTYPE_BY_ID).indexOf(s) : i;
  };
  const used = (Object.keys(usage) as ReportSubtype[]).sort((a, b) => usage[b] - usage[a] || rank(a) - rank(b));
  const out: ReportSubtype[] = [];
  for (const s of [...used, ...defaults]) {
    if (out.length >= limit) break;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Raccourcis calculés une fois au montage (le compteur ne bouge qu'après une publication). */
export function useFrequentSubtypes(limit: number = SHORTCUT_COUNT): ReportSubtype[] {
  return useMemo(() => frequentSubtypes(limit), [limit]);
}
