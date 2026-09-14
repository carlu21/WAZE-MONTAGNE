import { DEFAULT_FILTERS_BY_PRACTICE, PRACTICES, type Practice, type ReportCategory } from "@mountain-live/core";

export const PRACTICES_KEY = "ml.practices";

/** Pratiques proposées à l'onboarding (section 21) : Randonnée, Trail, Équitation, VTT, Chasse, Pêche, Autre. */
export const ONBOARDING_PRACTICES: readonly Practice[] = ["hiker", "trail", "rider", "mtb", "hunter", "fisher", "other"];

export function isPractice(x: unknown): x is Practice {
  return typeof x === "string" && PRACTICES.some((p) => p.id === x);
}

export function loadPractices(): Practice[] {
  try {
    const raw = localStorage.getItem(PRACTICES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPractice) : [];
  } catch {
    return [];
  }
}

export function savePractices(practices: readonly Practice[]): void {
  try {
    localStorage.setItem(PRACTICES_KEY, JSON.stringify(practices));
  } catch {
    /* stockage indisponible : préférence non mémorisée */
  }
}

/** Union ordonnée des catégories recommandées pour un ensemble de pratiques (section 11). */
export function filtersForPractices(practices: readonly Practice[]): ReportCategory[] {
  const out: ReportCategory[] = [];
  for (const p of practices) {
    for (const c of DEFAULT_FILTERS_BY_PRACTICE[p] ?? []) if (!out.includes(c)) out.push(c);
  }
  // Toutes les catégories sélectionnées = « tout afficher » (tableau vide).
  return out.length >= 6 ? [] : out;
}

export function practiceLabel(id: Practice): string {
  return PRACTICES.find((p) => p.id === id)?.label ?? id;
}
