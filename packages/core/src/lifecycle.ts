/**
 * Cycle de vie des signalements (section 5 & 26).
 * Implémentation complète : voir tâche "core".
 */
import type { Report, ReportStatus, ReportSubtype } from "./types";
import { SUBTYPE_BY_ID } from "./taxonomy";

/** Borne un TTL demandé dans les limites de la taxonomie. */
export function clampTtl(subtype: ReportSubtype, requestedMin?: number | null): number {
  const s = SUBTYPE_BY_ID[subtype];
  if (requestedMin == null || Number.isNaN(requestedMin)) return s.defaultTtlMin;
  return Math.min(s.maxTtlMin, Math.max(s.minTtlMin, Math.round(requestedMin)));
}

/**
 * Opacité d'affichage en fonction de l'âge (section 5) :
 * 1 pendant les 60 % premiers de la durée de vie, puis décroît linéairement vers 0.35.
 */
export function computeFade(createdAt: string | Date, expiresAt: string | Date, now: Date = new Date()): number {
  const c = new Date(createdAt).getTime();
  const e = new Date(expiresAt).getTime();
  const t = now.getTime();
  if (e <= c) return 0.35;
  const ratio = (t - c) / (e - c);
  if (ratio <= 0.6) return 1;
  if (ratio >= 1) return 0.35;
  return 1 - ((ratio - 0.6) / 0.4) * 0.65;
}

export function isExpired(report: Pick<Report, "expiresAt" | "endsAt">, now: Date = new Date()): boolean {
  const end = report.endsAt ? new Date(report.endsAt).getTime() : Infinity;
  return now.getTime() >= Math.min(new Date(report.expiresAt).getTime(), end);
}

export const VISIBLE_STATUSES: readonly ReportStatus[] = ["active", "confirmed", "probably_resolved", "disputed"];
