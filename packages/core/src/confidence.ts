/**
 * Score de confiance communautaire (section 6), 0..100.
 *
 * Le score dépend du caractère officiel de la source, de la réputation du
 * contributeur, du nombre et de la récence des confirmations, et des
 * contradictions (contestations, votes « plus présent »).
 */
import type { ConfidenceLabel, ReportSource } from "./types";
import { recencyWindowMin } from "./lifecycle";
import { reliabilityWeight } from "./reputation";
import { formatRelative } from "./time";

export interface ConfidenceVote {
  at: string | Date;
  /** Niveau de fiabilité 1..5 du votant. */
  voterLevel: number;
}

export interface ConfidenceInput {
  source: ReportSource;
  /** Niveau de fiabilité 1..5 du contributeur. */
  reporterLevel: number;
  /** Confirmations « toujours présent » avec leur date. */
  confirmations: ConfidenceVote[];
  /** Contestations avec leur date. */
  disputes: ConfidenceVote[];
  /** Votes « plus présent ». */
  goneVotes: ConfidenceVote[];
  createdAt: string | Date;
  now?: Date;
  /**
   * Durée de vie du sous-type (minutes), utilisée pour la demi-vie des
   * confirmations (25 % de la durée de vie, entre 1 h et 7 j). Défaut : 24 h.
   */
  ttlMin?: number;
}

export const CONFIDENCE_BASE: Record<ReportSource, number> = { official: 90, partner: 60, community: 25 };
/** Score plancher par source : une information officielle reste « très fiable ». */
export const CONFIDENCE_FLOOR: Record<ReportSource, number> = { official: 85, partner: 50, community: 0 };

export const CONFIDENCE_RULES = {
  /** Bonus réputation du contributeur : (niveau − 1) × 3 → 0..12. */
  reporterBonusPerLevel: 3,
  /** Plafond du bonus de confirmations (rendement décroissant). */
  confirmationsMax: 45,
  /** Nombre d'« unités » de confirmation (poids × récence) pour atteindre ~63 % du plafond. */
  confirmationSaturationUnits: 4,
  disputePenalty: 12,
  disputesMax: 45,
  gonePenalty: 6,
  goneMax: 30,
} as const;

export interface ConfidenceBreakdown {
  base: number;
  reporterBonus: number;
  confirmationsBonus: number;
  disputesPenalty: number;
  gonePenalty: number;
  /** Plancher appliqué (source). */
  floor: number;
  /** Score final 0..100, arrondi. */
  score: number;
  /** Demi-vie utilisée pour la récence (minutes). */
  halfLifeMin: number;
}

/** Demi-vie des confirmations (minutes) : 25 % de la durée de vie, entre 1 h et 7 j. */
export function confidenceHalfLifeMin(ttlMin?: number): number {
  return recencyWindowMin(ttlMin);
}

const toMs = (d: string | Date): number => new Date(d).getTime();

/** Poids de récence 1 → 0 (exponentiel, demi-vie donnée). Les dates futures comptent 1. */
function recencyWeight(at: string | Date, nowMs: number, halfLifeMin: number): number {
  const t = toMs(at);
  if (Number.isNaN(t)) return 0;
  const ageMin = Math.max(0, (nowMs - t) / 60_000);
  return Math.pow(2, -ageMin / halfLifeMin);
}

export function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 85) return "high";
  if (score >= 60) return "confirmed";
  if (score >= 35) return "probable";
  return "low";
}

/**
 * Détail du calcul :
 * - base par source (officiel 90, partenaire 60, communauté 25) ;
 * - bonus réputation du contributeur 0..12 ;
 * - confirmations : chaque vote vaut poids(niveau) × récence ; la somme `u` est
 *   convertie en bonus 45 × (1 − e^(−u/4)), donc à rendement décroissant, borné à +45 ;
 * - contestations : −12 × poids(niveau) chacune, borné à −45 ;
 * - « plus présent » : −6 chacun, borné à −30 ;
 * - plancher par source (officiel 85, partenaire 50), puis bornes 0..100.
 */
export function computeConfidenceBreakdown(input: ConfidenceInput): ConfidenceBreakdown {
  const nowMs = (input.now ?? new Date()).getTime();
  const halfLifeMin = confidenceHalfLifeMin(input.ttlMin);
  const R = CONFIDENCE_RULES;

  const base = CONFIDENCE_BASE[input.source];
  const level = Number.isFinite(input.reporterLevel) ? Math.max(1, Math.min(5, Math.round(input.reporterLevel))) : 1;
  const reporterBonus = (level - 1) * R.reporterBonusPerLevel;

  let units = 0;
  for (const c of input.confirmations) {
    units += reliabilityWeight(c.voterLevel) * recencyWeight(c.at, nowMs, halfLifeMin);
  }
  const confirmationsBonus = R.confirmationsMax * (1 - Math.exp(-units / R.confirmationSaturationUnits));

  let disputesPenalty = 0;
  for (const d of input.disputes) disputesPenalty += R.disputePenalty * reliabilityWeight(d.voterLevel);
  disputesPenalty = Math.min(R.disputesMax, disputesPenalty);

  const gonePenalty = Math.min(R.goneMax, input.goneVotes.length * R.gonePenalty);

  const floor = CONFIDENCE_FLOOR[input.source];
  const raw = base + reporterBonus + confirmationsBonus - disputesPenalty - gonePenalty;
  const score = Math.round(Math.max(floor, Math.min(100, Math.max(0, raw))));

  return { base, reporterBonus, confirmationsBonus, disputesPenalty, gonePenalty, floor, score, halfLifeMin };
}

/** Score de confiance 0..100 (voir `computeConfidenceBreakdown`). */
export function computeConfidence(input: ConfidenceInput): number {
  return computeConfidenceBreakdown(input).score;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

/**
 * Phrase courte en français expliquant le score, ex. :
 * « Confirmé par 8 utilisateurs, dernière confirmation il y a 12 min ».
 */
export function confidenceExplanation(input: ConfidenceInput): string {
  const now = input.now ?? new Date();
  const n = input.confirmations.length;
  const parts: string[] = [];

  if (n > 0) {
    let lastMs = -Infinity;
    for (const c of input.confirmations) {
      const t = toMs(c.at);
      if (!Number.isNaN(t) && t > lastMs) lastMs = t;
    }
    const ago = Number.isFinite(lastMs) ? formatRelative(new Date(lastMs), now) : "";
    const who = plural(n, "utilisateur", "utilisateurs");
    if (input.source === "official") parts.push(`Information officielle, confirmée par ${who}`);
    else if (n === 1) parts.push(ago ? `Confirmé par 1 utilisateur ${ago}` : "Confirmé par 1 utilisateur");
    else parts.push(ago ? `Confirmé par ${who}, dernière confirmation ${ago}` : `Confirmé par ${who}`);
  } else if (input.source === "official") {
    parts.push("Information officielle");
  } else if (input.source === "partner") {
    parts.push("Signalé par un partenaire vérifié");
  } else {
    parts.push("Pas encore confirmé par la communauté");
  }

  const d = input.disputes.length;
  if (d > 0) parts.push(`contesté par ${plural(d, "utilisateur", "utilisateurs")}`);
  const g = input.goneVotes.length;
  if (g > 0) parts.push(`plus présent selon ${plural(g, "utilisateur", "utilisateurs")}`);

  return parts.join(" · ");
}
