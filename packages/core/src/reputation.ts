/**
 * Réputation des contributeurs (section 16).
 *
 * Principe : un nouvel utilisateur démarre au niveau 1 ; le niveau monte avec
 * les signalements confirmés par la communauté et les confirmations utiles,
 * et baisse avec les signalements contestés et les contenus sanctionnés par la
 * modération. Le score brut est INTERNE (il peut être négatif) et ne doit
 * jamais être affiché : seul le niveau 1..5 est public.
 */
import type { BadgeId } from "./types";
import { BADGES } from "./taxonomy";

export type ReliabilityLevel = 1 | 2 | 3 | 4 | 5;

export interface ReliabilityInput {
  /** Signalements publiés (hors supprimés). */
  reportsTotal: number;
  /** Signalements ayant atteint le statut « confirmé » (ou mieux). */
  reportsConfirmed: number;
  /** Signalements passés « contesté ». */
  reportsDisputed: number;
  /** Confirmations émises par l'utilisateur et allant dans le sens du consensus final. */
  usefulConfirmations: number;
  /** Signalements de contenu contre l'utilisateur jugés fondés par la modération. */
  flagsUpheldAgainst: number;
  /** Ancienneté du compte en jours. */
  accountAgeDays: number;
}

export type ReliabilityCap = "new_account" | "disputes" | "flags";

export interface ReliabilityResult {
  /** Score brut interne, éventuellement négatif. Ne jamais l'afficher. */
  score: number;
  /** Niveau public 1..5. */
  level: ReliabilityLevel;
  /** Progression 0..1 vers le niveau suivant (1 au niveau 5 ou si plafonné). */
  progress: number;
  /** Raison d'un plafonnement du niveau, ou null. */
  cap: ReliabilityCap | null;
}

/** Barème des points (documenté pour la modération). */
export const RELIABILITY_POINTS = {
  confirmedReport: 3,
  usefulConfirmation: 1,
  disputedReport: -4,
  upheldFlag: -10,
  /** Bonus d'ancienneté maximal, atteint après `seniorityDays` jours. */
  seniorityMaxBonus: 5,
  seniorityDays: 365,
} as const;

/** Score minimal pour atteindre chaque niveau (index 0 = niveau 1). */
export const LEVEL_THRESHOLDS: readonly number[] = [0, 10, 30, 80, 200];

/** Règles de plafonnement (anti-abus). */
export const RELIABILITY_CAPS = {
  /** Un compte de moins de 7 jours ne dépasse pas le niveau 2. */
  newAccountDays: 7,
  newAccountMaxLevel: 2 as ReliabilityLevel,
  /** À partir de 4 signalements, si la moitié ou plus sont contestés : niveau 2 max. */
  disputeRatioMinReports: 4,
  disputeRatio: 0.5,
  disputeMaxLevel: 2 as ReliabilityLevel,
  /** 1 signalement fondé contre soi : niveau 3 max ; 3 ou plus : niveau 1. */
  flagsSoftMaxLevel: 3 as ReliabilityLevel,
  flagsHardCount: 3,
  flagsHardMaxLevel: 1 as ReliabilityLevel,
} as const;

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

export function levelFromScore(score: number): ReliabilityLevel {
  let level: ReliabilityLevel = 1;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (score >= LEVEL_THRESHOLDS[i]) level = (i + 1) as ReliabilityLevel;
  }
  return level;
}

/**
 * Calcule le score interne et le niveau public.
 *
 * score = 3 × confirmés + 1 × confirmations utiles − 4 × contestés − 10 × sanctions
 *         + bonus d'ancienneté (0..5, linéaire sur un an).
 * Niveaux : < 10 → 1, < 30 → 2, < 80 → 3, < 200 → 4, sinon 5, puis plafonds
 * (compte récent, ratio de contestations, sanctions de modération).
 */
export function computeReliability(input: ReliabilityInput): ReliabilityResult {
  const total = nonNeg(input.reportsTotal);
  const confirmed = nonNeg(input.reportsConfirmed);
  const disputed = nonNeg(input.reportsDisputed);
  const useful = nonNeg(input.usefulConfirmations);
  const flags = nonNeg(input.flagsUpheldAgainst);
  const ageDays = nonNeg(input.accountAgeDays);

  const seniority =
    RELIABILITY_POINTS.seniorityMaxBonus * Math.min(1, ageDays / RELIABILITY_POINTS.seniorityDays);

  const score =
    confirmed * RELIABILITY_POINTS.confirmedReport +
    useful * RELIABILITY_POINTS.usefulConfirmation +
    disputed * RELIABILITY_POINTS.disputedReport +
    flags * RELIABILITY_POINTS.upheldFlag +
    seniority;

  let level = levelFromScore(score);
  let cap: ReliabilityCap | null = null;

  // Plafonds appliqués du plus sévère au plus doux ; on retient la première raison bloquante.
  const applyCap = (max: ReliabilityLevel, reason: ReliabilityCap): void => {
    if (level > max) {
      level = max;
      cap = reason;
    }
  };
  if (flags >= RELIABILITY_CAPS.flagsHardCount) applyCap(RELIABILITY_CAPS.flagsHardMaxLevel, "flags");
  else if (flags >= 1) applyCap(RELIABILITY_CAPS.flagsSoftMaxLevel, "flags");
  if (
    total >= RELIABILITY_CAPS.disputeRatioMinReports &&
    disputed / total >= RELIABILITY_CAPS.disputeRatio
  ) {
    applyCap(RELIABILITY_CAPS.disputeMaxLevel, "disputes");
  }
  if (ageDays < RELIABILITY_CAPS.newAccountDays) applyCap(RELIABILITY_CAPS.newAccountMaxLevel, "new_account");

  let progress = 1;
  if (level < 5 && cap === null) {
    const lo = LEVEL_THRESHOLDS[level - 1];
    const hi = LEVEL_THRESHOLDS[level];
    progress = Math.max(0, Math.min(1, (score - lo) / (hi - lo)));
  }

  return { score: Math.round(score * 100) / 100, level, progress, cap };
}

/**
 * Poids d'un vote selon le niveau du votant (utilisé par le score de confiance) :
 * niveau 1 → 0,6 · 2 → 0,8 · 3 → 1 · 4 → 1,2 · 5 → 1,4. Hors bornes : ramené à 1..5.
 */
export function reliabilityWeight(level: number): number {
  const l = Number.isFinite(level) ? Math.max(1, Math.min(5, Math.round(level))) : 1;
  return 0.6 + (l - 1) * 0.2;
}

export interface BadgeInput {
  reportsTotal: number;
  confirmationsTotal: number;
  /** Nombre maximal de signalements confirmés dans une même zone. */
  confirmedInSameZoneMax: number;
  usefulConfirmations: number;
  isVerifiedPartner: boolean;
}

/** Seuils des badges, alignés sur les descriptions de `BADGES` (taxonomie). */
export const BADGE_THRESHOLDS = {
  scoutReports: 1,
  contributorTotal: 10,
  localExpertConfirmedSameZone: 25,
  sentinelUsefulConfirmations: 50,
} as const;

/** Badges obtenus, dans l'ordre de `BADGES`. */
export function computeBadges(input: BadgeInput): BadgeId[] {
  const reports = nonNeg(input.reportsTotal);
  const confirmations = nonNeg(input.confirmationsTotal);
  const earned = new Set<BadgeId>();
  if (reports >= BADGE_THRESHOLDS.scoutReports) earned.add("scout");
  if (reports + confirmations >= BADGE_THRESHOLDS.contributorTotal) earned.add("contributor");
  if (nonNeg(input.confirmedInSameZoneMax) >= BADGE_THRESHOLDS.localExpertConfirmedSameZone) earned.add("local_expert");
  if (nonNeg(input.usefulConfirmations) >= BADGE_THRESHOLDS.sentinelUsefulConfirmations) earned.add("sentinel");
  if (input.isVerifiedPartner) earned.add("verified_partner");
  return (Object.keys(BADGES) as BadgeId[]).filter((id) => earned.has(id));
}
