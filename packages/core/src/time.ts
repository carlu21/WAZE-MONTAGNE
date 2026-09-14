/**
 * Formatage des dates et durées en français, sans dépendance externe.
 *
 * Toutes les fonctions acceptent une `Date`, une chaîne ISO ou un timestamp,
 * et renvoient une chaîne vide pour une date invalide (jamais d'exception),
 * afin qu'un enregistrement corrompu ne casse jamais un écran.
 *
 * Les heures sont exprimées dans le fuseau local de l'appareil (ce que
 * l'utilisateur attend sur le terrain).
 */

export type DateInput = string | number | Date;

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** Convertit une entrée quelconque en `Date` valide, ou `null`. */
export function toDate(input: DateInput | null | undefined): Date | null {
  if (input == null) return null;
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isSameDay(a: DateInput, b: DateInput): boolean {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function addDays(date: DateInput, days: number): Date {
  const d = toDate(date) ?? new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export function addMinutes(date: DateInput, minutes: number): Date {
  const d = toDate(date) ?? new Date();
  return new Date(d.getTime() + minutes * MINUTE_MS);
}

/** Minutes (signées) entre `from` et `to` : positif si `to` est après `from`. */
export function minutesBetween(from: DateInput, to: DateInput): number {
  const a = toDate(from);
  const b = toDate(to);
  if (!a || !b) return 0;
  return (b.getTime() - a.getTime()) / MINUTE_MS;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Unité relative « humaine » d'une durée absolue :
 * min (< 1 h) → h (< 24 h) → j (< 7 j) → sem. (< 5 sem.) → mois (< 1 an) → an(s).
 */
function relativeUnit(ms: number): string {
  if (ms < HOUR_MS) return `${Math.max(1, Math.floor(ms / MINUTE_MS))} min`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} h`;
  if (ms < WEEK_MS) return `${Math.floor(ms / DAY_MS)} j`;
  if (ms < 5 * WEEK_MS) return `${Math.floor(ms / WEEK_MS)} sem.`;
  if (ms < 365 * DAY_MS) return `${Math.max(1, Math.floor(ms / (30.44 * DAY_MS)))} mois`;
  const years = Math.floor(ms / (365.25 * DAY_MS));
  return `${years} an${years > 1 ? "s" : ""}`;
}

/**
 * Date relative en français : « à l'instant », « il y a 3 min », « il y a 2 h »,
 * « il y a 3 j », « il y a 2 sem. ». Les dates futures donnent « dans 2 h ».
 */
export function formatRelative(date: DateInput, now: DateInput = new Date()): string {
  const d = toDate(date);
  const n = toDate(now);
  if (!d || !n) return "";
  const diff = n.getTime() - d.getTime();
  const abs = Math.abs(diff);
  if (abs < 45 * SECOND_MS) return "à l'instant";
  const unit = relativeUnit(abs);
  return diff >= 0 ? `il y a ${unit}` : `dans ${unit}`;
}

/** Heure courte : « 13 h », « 13 h 05 ». */
export function formatTime(date: DateInput): string {
  const d = toDate(date);
  if (!d) return "";
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h} h` : `${h} h ${pad2(m)}`;
}

/** Date courte sans année : « 14/09 ». */
export function formatDateShort(date: DateInput): string {
  const d = toDate(date);
  if (!d) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

/** Date complète : « 14/09/2026 ». */
export function formatDate(date: DateInput): string {
  const d = toDate(date);
  if (!d) return "";
  return `${formatDateShort(d)}/${d.getFullYear()}`;
}

/** Date et heure : « 14/09/2026 à 18 h 05 ». */
export function formatDateTime(date: DateInput): string {
  const d = toDate(date);
  if (!d) return "";
  return `${formatDate(d)} à ${formatTime(d)}`;
}

/**
 * Échéance en français : « jusqu'à 13 h » le jour même, sinon
 * « jusqu'au 14/09 à 18 h » (l'année est ajoutée si elle diffère de l'année courante).
 */
export function formatUntil(date: DateInput, now: DateInput = new Date()): string {
  const d = toDate(date);
  const n = toDate(now) ?? new Date();
  if (!d) return "";
  if (isSameDay(d, n)) return `jusqu'à ${formatTime(d)}`;
  const day = d.getFullYear() === n.getFullYear() ? formatDateShort(d) : formatDate(d);
  return `jusqu'au ${day} à ${formatTime(d)}`;
}

/**
 * Durée précise en minutes : « 45 min », « 1 h 30 », « 2 h », « 3 j », « 2 j 6 h ».
 * (Pour les libellés de durée de vie arrondis, voir `formatTtl` dans la taxonomie.)
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  if (total < 24 * 60) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? `${h} h` : `${h} h ${pad2(m)}`;
  }
  const days = Math.floor(total / (24 * 60));
  const hours = Math.floor((total % (24 * 60)) / 60);
  return hours === 0 ? `${days} j` : `${days} j ${hours} h`;
}
