/**
 * Score de confiance communautaire (section 6).
 * Implémentation complète : voir tâche "core".
 */
import type { ConfidenceLabel, ReportSource } from "./types";

export interface ConfidenceInput {
  source: ReportSource;
  /** Niveau de fiabilité 1..5 du contributeur. */
  reporterLevel: number;
  /** Confirmations « toujours présent » avec leur date. */
  confirmations: { at: string | Date; voterLevel: number }[];
  /** Contestations avec leur date. */
  disputes: { at: string | Date; voterLevel: number }[];
  /** Votes « plus présent ». */
  goneVotes: { at: string | Date; voterLevel: number }[];
  createdAt: string | Date;
  now?: Date;
}

export function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 85) return "high";
  if (score >= 60) return "confirmed";
  if (score >= 35) return "probable";
  return "low";
}

/** Implémentation de référence (sera raffinée par la tâche core). */
export function computeConfidence(input: ConfidenceInput): number {
  const base = input.source === "official" ? 90 : input.source === "partner" ? 60 : 25;
  const rep = Math.max(0, Math.min(5, input.reporterLevel)) * 3;
  const conf = Math.min(40, input.confirmations.length * 8);
  const disp = Math.min(40, input.disputes.length * 10);
  return Math.max(0, Math.min(100, Math.round(base + rep + conf - disp)));
}
