/**
 * Mise en forme de l'écran d'accueil.
 *
 * Isolé du rendu pour une raison précise : la confusion entre les DEUX
 * DISTANCES (section 19) est l'erreur qui rendrait l'écran trompeur — « à 4 km
 * de vous » n'est pas « randonnée de 9,8 km ». Les deux formulations sont
 * produites ici, volontairement dissemblables, et testées.
 */
import { formatDistance, formatDurationShort, type FrequentationLevel } from "@mountain-live/core";
import type { NearbySort, TrailDifficulty, TrailShape } from "@mountain-live/core";

export const DIFFICULTY_LABELS: Record<TrailDifficulty, string> = {
  easy: "Facile",
  moderate: "Modérée",
  hard: "Difficile",
  expert: "Expert",
};

/** Teinte de la difficulté : jamais le rouge, réservé aux dangers réels. */
export const DIFFICULTY_TONE: Record<TrailDifficulty, "success" | "info" | "neutral" | "accent"> = {
  easy: "success",
  moderate: "info",
  hard: "neutral",
  expert: "accent",
};

export const SHAPE_LABELS: Record<TrailShape, string> = {
  loop: "Boucle",
  out_and_back: "Aller-retour",
  linear: "Itinéraire linéaire",
};

export const SORT_LABELS: Record<NearbySort, string> = {
  closest: "Plus proches",
  popular: "Plus populaires",
  easiest: "Plus faciles",
  shortest: "Plus courtes",
  quietest: "Moins fréquentées",
};

export const FREQUENTATION_LABELS: Record<FrequentationLevel, string> = {
  unknown: "Fréquentation inconnue",
  very_low: "Très calme",
  low: "Calme",
  moderate: "Modérée",
  high: "Fréquentée",
  very_high: "Très fréquentée",
};

/** DISTANCE 1 — de vous au départ. */
export function approachLabel(m: number): string {
  if (!Number.isFinite(m) || m < 0) return "Distance inconnue";
  if (m < 120) return "Départ ici même";
  return `À ${formatDistance(m)} de vous`;
}

/** DISTANCE 2 — longueur de la randonnée. Jamais la même phrase que l'approche. */
export function lengthLabel(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return "Longueur inconnue";
  return formatDistance(m);
}

/** Durée de marche ; dit honnêtement quand elle n'est qu'une estimation. */
export function durationLabel(ms: number, observed: boolean): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return observed ? formatDurationShort(ms) : `≈ ${formatDurationShort(ms)}`;
}

/** Dénivelé positif. */
export function elevationLabel(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return "—";
  return `+${Math.round(m)} m`;
}

/**
 * Fréquentation, ou rien du tout. Une fréquentation inconnue n'est PAS
 * « calme » : on ne l'affiche pas plutôt que de laisser croire à un chemin
 * désert (section 21).
 */
export function frequentationLabel(level: FrequentationLevel | null, passagesToday: number | null): string | null {
  if (passagesToday !== null && passagesToday > 0) {
    return `${passagesToday} passage${passagesToday > 1 ? "s" : ""} aujourd'hui`;
  }
  if (level === null || level === "unknown") return null;
  return FREQUENTATION_LABELS[level];
}

/** Zoom de cadrage sur une randonnée selon sa longueur. */
export function fitZoomFor(lengthM: number): number {
  if (lengthM > 20_000) return 11;
  if (lengthM > 8_000) return 12.5;
  if (lengthM > 3_000) return 13.5;
  return 14.5;
}

/**
 * Faut-il proposer « Me guider vers le départ » plutôt que « Démarrer » ?
 * Au-delà de quelques centaines de mètres, on ne démarre pas une randonnée :
 * on rejoint d'abord son départ (section 16).
 */
export const AT_TRAILHEAD_M = 300;

export function atTrailhead(approachM: number): boolean {
  return Number.isFinite(approachM) && approachM <= AT_TRAILHEAD_M;
}
