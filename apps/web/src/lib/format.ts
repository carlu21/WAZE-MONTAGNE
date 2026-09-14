/**
 * Formatage français pour l'interface web.
 *
 * - `formatRelative`  : « il y a 35 min » — délègue à @mountain-live/core (même
 *                       rendu que l'API et les notifications) ; style « long »
 *                       en toutes lettres via date-fns.
 * - `formatDateTime`  : « aujourd'hui à 18 h 05 », « hier à 9 h 30 », « 14 sept. à 18 h 05 »
 * - `formatDistance`  : ré-export de @mountain-live/core (« 320 m », « 1,2 km »)
 * - `formatCount`     : « 8 utilisateurs », « 1 utilisateur »
 * - `pluralize`       : règle française (pluriel à partir de 2)
 * - `formatBadgeCount`: « 3 », « 99+ »
 */
import { format as dfFormat, formatDistanceStrict, isToday, isYesterday, isValid } from "date-fns";
import { fr } from "date-fns/locale";
import { formatRelative as coreFormatRelative } from "@mountain-live/core";

export { formatDistance, formatTime, formatUntil, formatDuration, formatTtl } from "@mountain-live/core";

export type DateLike = string | number | Date;

/** Convertit une entrée quelconque en Date valide, ou null. */
export function toDate(input: DateLike | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return isValid(d) ? d : null;
}

export interface FormatRelativeOptions {
  /** Référence temporelle (par défaut : maintenant). */
  now?: Date;
  /** « il y a 35 min » (short, défaut) ou « il y a 35 minutes » (long). */
  style?: "short" | "long";
  /** Ajouter « il y a » / « dans » (défaut : true). */
  addSuffix?: boolean;
}

/**
 * Date relative : « à l'instant », « il y a 35 min », « il y a 2 h », « dans 3 j ».
 * Le style court est celui de @mountain-live/core (cohérent avec l'API) ;
 * le style long donne « il y a 35 minutes ». Chaîne vide pour une date invalide.
 */
export function formatRelative(date: DateLike | null | undefined, opts: FormatRelativeOptions = {}): string {
  const d = toDate(date);
  if (!d) return "";
  const now = opts.now ?? new Date();
  const diffMs = now.getTime() - d.getTime();
  if (Math.abs(diffMs) < 45_000) return "à l'instant";
  const addSuffix = opts.addSuffix ?? true;
  if ((opts.style ?? "short") === "short") {
    const out = coreFormatRelative(d, now);
    return addSuffix ? out : out.replace(/^il y a |^dans /, "");
  }
  return formatDistanceStrict(d, now, { locale: fr, addSuffix, roundingMethod: "floor" });
}

export interface FormatDateTimeOptions {
  /** « aujourd'hui à … » / « hier à … » quand c'est pertinent (défaut : true). */
  relativeDay?: boolean;
  /** short : « 14 sept. à 18 h 05 » ; long : « lundi 14 septembre 2026 à 18 h 05 ». */
  style?: "short" | "long";
  now?: Date;
}

/** Heure « 18 h 05 » (toujours avec les minutes, pour l'affichage d'horodatage). */
function timePart(d: Date): string {
  return dfFormat(d, "H 'h' mm", { locale: fr });
}

/** Date et heure lisibles en français. Chaîne vide si la date est invalide. */
export function formatDateTime(date: DateLike | null | undefined, opts: FormatDateTimeOptions = {}): string {
  const d = toDate(date);
  if (!d) return "";
  const style = opts.style ?? "short";
  if (opts.relativeDay ?? true) {
    if (isToday(d)) return `aujourd'hui à ${timePart(d)}`;
    if (isYesterday(d)) return `hier à ${timePart(d)}`;
  }
  const now = opts.now ?? new Date();
  if (style === "long") return dfFormat(d, "EEEE d MMMM yyyy 'à' H 'h' mm", { locale: fr });
  const sameYear = d.getFullYear() === now.getFullYear();
  return dfFormat(d, sameYear ? "d MMM 'à' H 'h' mm" : "d MMM yyyy 'à' H 'h' mm", { locale: fr });
}

/** Date seule : « 14 sept. 2026 » ou « lundi 14 septembre 2026 ». */
export function formatDate(date: DateLike | null | undefined, style: "short" | "long" = "short"): string {
  const d = toDate(date);
  if (!d) return "";
  return dfFormat(d, style === "long" ? "EEEE d MMMM yyyy" : "d MMM yyyy", { locale: fr });
}

const numberFormat = new Intl.NumberFormat("fr-FR");

/** Nombre avec séparateur de milliers français (« 1 234 »). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return numberFormat.format(n);
}

/**
 * Pluriel français : le pluriel s'applique à partir de 2 (« 0 utilisateur », « 1 utilisateur »,
 * « 2 utilisateurs »). Le pluriel par défaut ajoute un « s ».
 */
export function pluralize(n: number, singular: string, plural: string = `${singular}s`): string {
  return Math.abs(n) >= 2 ? plural : singular;
}

/** « 8 utilisateurs », « 1 signalement », « 1 234 confirmations ». */
export function formatCount(n: number, singular: string, plural?: string): string {
  return `${formatNumber(n)} ${pluralize(n, singular, plural)}`;
}

/** Compteur de pastille : « 3 », « 99+ ». Chaîne vide si ≤ 0. */
export function formatBadgeCount(n: number, max = 99): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n > max ? `${max}+` : String(Math.floor(n));
}

/** Pourcentage entier : « 72 % ». */
export function formatPercent(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)} %`;
}

/** Altitude : « 1 850 m ». */
export function formatElevation(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return "—";
  return `${formatNumber(Math.round(m))} m`;
}

/** Initiales (1 à 2 lettres) à partir d'un pseudo ou d'un nom. */
export function initials(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  const parts = clean.split(/[\s_\-.]+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : (parts[0]?.charAt(1) ?? "");
  return (first + second).toUpperCase();
}
