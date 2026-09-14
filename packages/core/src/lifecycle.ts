/**
 * Cycle de vie des signalements (sections 5, 6 et 26).
 *
 * - Durée de vie bornée par la taxonomie, ou heure de fin explicite pour les
 *   sous-types qui la demandent (chasse, travaux, fermetures).
 * - Affichage : récent = icône pleine, ancien = icône estompée (`computeFade`),
 *   trop ancien = archivé (`shouldArchive`).
 * - Statut dérivé des votes communautaires (`deriveStatus`), les sources
 *   officielles restant prioritaires (section 27).
 */
import type { ConfirmationKind, Report, ReportSource, ReportStatus, ReportSubtype } from "./types";
import { SUBTYPE_BY_ID } from "./taxonomy";

const MIN_MS = 60_000;

/** Statuts affichés sur la carte. */
export const VISIBLE_STATUSES: readonly ReportStatus[] = ["active", "confirmed", "probably_resolved", "disputed"];

/** Statuts terminaux : plus aucun vote n'est pris en compte. */
export const TERMINAL_STATUSES: readonly ReportStatus[] = ["resolved", "expired", "deleted"];

export function isVisibleStatus(status: ReportStatus): boolean {
  return VISIBLE_STATUSES.includes(status);
}

/** Borne un TTL demandé (minutes) dans les limites du sous-type ; absent → valeur par défaut. */
export function clampTtl(subtype: ReportSubtype, requestedMin?: number | null): number {
  const s = SUBTYPE_BY_ID[subtype];
  if (requestedMin == null || !Number.isFinite(requestedMin)) return s.defaultTtlMin;
  return Math.min(s.maxTtlMin, Math.max(s.minTtlMin, Math.round(requestedMin)));
}

/**
 * Date d'expiration d'un signalement.
 *
 * Pour un sous-type à heure de fin (`askEndTime`), une `endsAt` valide et
 * postérieure à la création prime sur toute durée (« chasse jusqu'à l'heure de
 * fin », « fermeture officielle dates début/fin »). Sinon : création + TTL borné.
 * Une `endsAt` fournie pour un autre sous-type est ignorée.
 */
export function computeExpiresAt(
  subtype: ReportSubtype,
  createdAt: Date,
  ttlMin?: number | null,
  endsAt?: string | null,
): Date {
  const def = SUBTYPE_BY_ID[subtype];
  if (def.askEndTime && endsAt) {
    const end = new Date(endsAt);
    if (!Number.isNaN(end.getTime()) && end.getTime() > createdAt.getTime()) return end;
  }
  return new Date(createdAt.getTime() + clampTtl(subtype, ttlMin) * MIN_MS);
}

/** Part de la durée de vie déjà écoulée, non bornée (< 0 avant création, > 1 après expiration). */
export function lifeRatio(createdAt: string | Date, expiresAt: string | Date, now: Date = new Date()): number {
  const c = new Date(createdAt).getTime();
  const e = new Date(expiresAt).getTime();
  if (Number.isNaN(c) || Number.isNaN(e) || e <= c) return 1;
  return (now.getTime() - c) / (e - c);
}

/**
 * Opacité d'affichage en fonction de l'âge (section 5) :
 * 1 pendant les 60 % premiers de la durée de vie, puis décroissance linéaire
 * jusqu'à 0,35 à l'expiration (et au-delà).
 */
export function computeFade(createdAt: string | Date, expiresAt: string | Date, now: Date = new Date()): number {
  const ratio = lifeRatio(createdAt, expiresAt, now);
  if (ratio <= 0.6) return 1;
  if (ratio >= 1) return 0.35;
  return 1 - ((ratio - 0.6) / 0.4) * 0.65;
}

/** Instant de fin effectif : la première des deux dates `expiresAt` / `endsAt`. */
export function effectiveEndMs(report: Pick<Report, "expiresAt"> & { endsAt?: string | null }): number {
  const exp = new Date(report.expiresAt).getTime();
  const end = report.endsAt ? new Date(report.endsAt).getTime() : NaN;
  const candidates = [exp, end].filter((t) => !Number.isNaN(t));
  return candidates.length ? Math.min(...candidates) : Infinity;
}

export function isExpired(report: Pick<Report, "expiresAt"> & { endsAt?: string | null }, now: Date = new Date()): boolean {
  return now.getTime() >= effectiveEndMs(report);
}

/** Minutes restantes avant expiration (0 si expiré). */
export function remainingMinutes(report: Pick<Report, "expiresAt"> & { endsAt?: string | null }, now: Date = new Date()): number {
  const end = effectiveEndMs(report);
  if (!Number.isFinite(end)) return Infinity;
  return Math.max(0, (end - now.getTime()) / MIN_MS);
}

/**
 * Fenêtre de « récence » d'un vote (minutes) : 25 % de la durée de vie,
 * bornée entre 1 h et 7 j. Sert à la fois au décompte des votes récents
 * (`deriveStatus`) et à la demi-vie des confirmations (score de confiance).
 */
export function recencyWindowMin(ttlMin: number = 24 * 60): number {
  const ttl = Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin : 24 * 60;
  return Math.min(7 * 24 * 60, Math.max(60, ttl * 0.25));
}

export interface VoteSummary {
  stillPresent: number;
  improved: number;
  gone: number;
  disputed: number;
  /** Votes « toujours présent » émis dans la fenêtre de récence. */
  recentStillPresent: number;
  /** Votes « plus présent » émis dans la fenêtre de récence. */
  recentGone: number;
  /** Date du dernier « toujours présent », ou null. */
  lastStillPresentAt: string | null;
}

/** Agrège une liste de votes (un par utilisateur) en compteurs pour `deriveStatus`. */
export function summarizeVotes(
  votes: readonly { kind: ConfirmationKind; createdAt: string | Date }[],
  now: Date = new Date(),
  windowMin: number = recencyWindowMin(),
): VoteSummary {
  const threshold = now.getTime() - windowMin * MIN_MS;
  const s: VoteSummary = {
    stillPresent: 0,
    improved: 0,
    gone: 0,
    disputed: 0,
    recentStillPresent: 0,
    recentGone: 0,
    lastStillPresentAt: null,
  };
  let lastMs = -Infinity;
  for (const v of votes) {
    const t = new Date(v.createdAt).getTime();
    const recent = !Number.isNaN(t) && t >= threshold;
    switch (v.kind) {
      case "still_present":
        s.stillPresent++;
        if (recent) s.recentStillPresent++;
        if (t > lastMs) {
          lastMs = t;
          s.lastStillPresentAt = new Date(t).toISOString();
        }
        break;
      case "improved":
        s.improved++;
        break;
      case "gone":
        s.gone++;
        if (recent) s.recentGone++;
        break;
      case "disputed":
        s.disputed++;
        break;
    }
  }
  return s;
}

export interface DeriveStatusInput {
  current: ReportStatus;
  source: ReportSource;
  stillPresent: number;
  improved: number;
  gone: number;
  disputed: number;
  recentStillPresent: number;
  recentGone: number;
  expired: boolean;
  /** Résolu explicitement par l'auteur ou un modérateur. */
  manuallyResolved: boolean;
}

/**
 * Le signal « plus présent » l'emporte-t-il sur « toujours présent » ?
 * La tendance récente prime ; à égalité de votes récents, on compare les totaux.
 */
function goneOutweighsPresent(i: DeriveStatusInput, strict: boolean): boolean {
  if (i.recentGone !== i.recentStillPresent) return i.recentGone > i.recentStillPresent;
  return strict ? i.gone > i.stillPresent : i.gone >= i.stillPresent;
}

/**
 * Dérive le statut d'un signalement (section 26). Règles, dans l'ordre :
 *
 * 1. `deleted` reste `deleted` ; une résolution manuelle reste `resolved`.
 * 2. Date dépassée → `expired`.
 * 3. Source officielle : les votes communautaires ne changent jamais le statut
 *    (jamais `disputed` ni `probably_resolved`, section 27) → `confirmed`.
 * 4. `disputed` si contestations ≥ 2 et ≥ « toujours présent ».
 * 5. `resolved` si « plus présent » ≥ 3 et que ce signal l'emporte (récents, puis totaux, strict).
 * 6. `probably_resolved` si (« plus présent » ≥ 1 et « amélioré » ≥ 1) ou « plus présent » ≥ 2,
 *    et que ce signal n'est pas dominé par les « toujours présent ».
 * 7. `confirmed` si « toujours présent » ≥ 2 ou source partenaire.
 * 8. Sinon `active`.
 */
export function deriveStatus(input: DeriveStatusInput): ReportStatus {
  if (input.current === "deleted") return "deleted";
  if (input.manuallyResolved) return "resolved";
  if (input.expired) return "expired";
  if (input.source === "official") return "confirmed";

  if (input.disputed >= 2 && input.disputed >= input.stillPresent) return "disputed";
  if (input.gone >= 3 && goneOutweighsPresent(input, true)) return "resolved";
  const resolutionSignal = (input.gone >= 1 && input.improved >= 1) || input.gone >= 2;
  if (resolutionSignal && goneOutweighsPresent(input, false)) return "probably_resolved";
  if (input.stillPresent >= 2 || input.source === "partner") return "confirmed";
  return "active";
}

/**
 * Le signalement doit-il être archivé (purge, « trop ancien ») ?
 * Vrai lorsque le signalement est terminé (expiré, résolu ou supprimé) depuis
 * au moins `retentionDays` jours. La date de référence est l'instant de fin
 * effectif pour une expiration, ou `updatedAt` pour une résolution / suppression
 * (la plus ancienne des deux si les deux s'appliquent).
 */
export function shouldArchive(
  report: Pick<Report, "status" | "expiresAt" | "updatedAt"> & { endsAt?: string | null },
  now: Date = new Date(),
  retentionDays = 30,
): boolean {
  const refs: number[] = [];
  const end = effectiveEndMs(report);
  if (now.getTime() >= end) refs.push(end);
  if (report.status === "resolved" || report.status === "deleted" || report.status === "expired") {
    const u = new Date(report.updatedAt).getTime();
    if (!Number.isNaN(u)) refs.push(u);
  }
  if (refs.length === 0) return false;
  const ref = Math.min(...refs);
  return now.getTime() - ref >= Math.max(0, retentionDays) * 24 * 60 * MIN_MS;
}
