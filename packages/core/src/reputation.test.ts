import { describe, expect, it } from "vitest";
import {
  BADGE_THRESHOLDS,
  LEVEL_THRESHOLDS,
  computeBadges,
  computeReliability,
  levelFromScore,
  reliabilityWeight,
  type ReliabilityInput,
} from "./reputation";
import { BADGES } from "./taxonomy";

const base: ReliabilityInput = {
  reportsTotal: 0,
  reportsConfirmed: 0,
  reportsDisputed: 0,
  usefulConfirmations: 0,
  flagsUpheldAgainst: 0,
  accountAgeDays: 100,
};
const rel = (patch: Partial<ReliabilityInput>) => computeReliability({ ...base, ...patch });

describe("levelFromScore", () => {
  it("applique les seuils", () => {
    expect(LEVEL_THRESHOLDS).toEqual([0, 10, 30, 80, 200]);
    expect(levelFromScore(-50)).toBe(1);
    expect(levelFromScore(9)).toBe(1);
    expect(levelFromScore(10)).toBe(2);
    expect(levelFromScore(29)).toBe(2);
    expect(levelFromScore(30)).toBe(3);
    expect(levelFromScore(79)).toBe(3);
    expect(levelFromScore(80)).toBe(4);
    expect(levelFromScore(199)).toBe(4);
    expect(levelFromScore(200)).toBe(5);
  });
});

describe("computeReliability", () => {
  it("un nouvel utilisateur est niveau 1 sans plafond signalé", () => {
    const r = rel({ accountAgeDays: 0 });
    expect(r).toEqual({ score: 0, level: 1, progress: 0, cap: null });
  });
  it("monte avec les signalements confirmés et les confirmations utiles", () => {
    const r = rel({ reportsTotal: 4, reportsConfirmed: 4, accountAgeDays: 30 });
    expect(r.score).toBeCloseTo(12.41, 2);
    expect(r.level).toBe(2);
    expect(r.progress).toBeCloseTo(0.12, 2);
    expect(rel({ usefulConfirmations: 30 }).level).toBe(3);
    const top = rel({ reportsTotal: 80, reportsConfirmed: 70, accountAgeDays: 365 });
    expect(top.level).toBe(5);
    expect(top.progress).toBe(1);
    expect(top.score).toBeCloseTo(215);
  });
  it("le bonus d'ancienneté est plafonné à 5 points", () => {
    expect(rel({ accountAgeDays: 365 }).score).toBe(5);
    expect(rel({ accountAgeDays: 5000 }).score).toBe(5);
  });
  it("baisse avec les contestations et peut devenir négatif (interne)", () => {
    const r = rel({ reportsTotal: 15, reportsConfirmed: 10, reportsDisputed: 5 });
    expect(r.score).toBeCloseTo(11.37, 2);
    expect(r.level).toBe(2);
    expect(r.cap).toBeNull();
    const neg = rel({ flagsUpheldAgainst: 2 });
    expect(neg.score).toBeLessThan(0);
    expect(neg.level).toBe(1);
  });
  it("plafonne un compte majoritairement contesté au niveau 2", () => {
    const r = rel({ reportsTotal: 10, reportsConfirmed: 5, reportsDisputed: 5, usefulConfirmations: 60 });
    expect(levelFromScore(r.score)).toBe(3);
    expect(r.level).toBe(2);
    expect(r.cap).toBe("disputes");
    expect(r.progress).toBe(1);
  });
  it("plafonne selon les sanctions de modération", () => {
    const soft = rel({ reportsTotal: 40, reportsConfirmed: 40, flagsUpheldAgainst: 1 });
    expect(levelFromScore(soft.score)).toBe(4);
    expect(soft.level).toBe(3);
    expect(soft.cap).toBe("flags");
    const hard = rel({ reportsTotal: 40, reportsConfirmed: 40, flagsUpheldAgainst: 3 });
    expect(hard.level).toBe(1);
    expect(hard.cap).toBe("flags");
  });
  it("plafonne un compte de moins de 7 jours au niveau 2", () => {
    const r = rel({ reportsTotal: 20, reportsConfirmed: 20, accountAgeDays: 2 });
    expect(r.level).toBe(2);
    expect(r.cap).toBe("new_account");
    expect(rel({ reportsTotal: 20, reportsConfirmed: 20, accountAgeDays: 7 }).level).toBe(3);
  });
  it("tolère des entrées négatives ou invalides", () => {
    const r = rel({ reportsTotal: -3, reportsConfirmed: Number.NaN, reportsDisputed: -1, accountAgeDays: -10 });
    expect(r.level).toBe(1);
    expect(r.score).toBe(0);
  });
});

describe("reliabilityWeight", () => {
  it("va de 0,6 (niveau 1) à 1,4 (niveau 5)", () => {
    expect(reliabilityWeight(1)).toBeCloseTo(0.6);
    expect(reliabilityWeight(3)).toBeCloseTo(1);
    expect(reliabilityWeight(5)).toBeCloseTo(1.4);
    expect(reliabilityWeight(0)).toBeCloseTo(0.6);
    expect(reliabilityWeight(9)).toBeCloseTo(1.4);
    expect(reliabilityWeight(Number.NaN)).toBeCloseTo(0.6);
  });
});

describe("computeBadges", () => {
  const none = { reportsTotal: 0, confirmationsTotal: 0, confirmedInSameZoneMax: 0, usefulConfirmations: 0, isVerifiedPartner: false };
  it("n'attribue rien sans activité", () => {
    expect(computeBadges(none)).toEqual([]);
  });
  it("attribue chaque badge à son seuil", () => {
    expect(computeBadges({ ...none, reportsTotal: BADGE_THRESHOLDS.scoutReports })).toEqual(["scout"]);
    expect(computeBadges({ ...none, reportsTotal: 4, confirmationsTotal: 6 })).toEqual(["scout", "contributor"]);
    expect(computeBadges({ ...none, confirmationsTotal: 10 })).toEqual(["contributor"]);
    expect(computeBadges({ ...none, confirmedInSameZoneMax: 25 })).toEqual(["local_expert"]);
    expect(computeBadges({ ...none, usefulConfirmations: 50 })).toEqual(["sentinel"]);
    expect(computeBadges({ ...none, isVerifiedPartner: true })).toEqual(["verified_partner"]);
  });
  it("renvoie les badges dans l'ordre de la taxonomie", () => {
    const all = computeBadges({ reportsTotal: 30, confirmationsTotal: 60, confirmedInSameZoneMax: 25, usefulConfirmations: 50, isVerifiedPartner: true });
    expect(all).toEqual(Object.keys(BADGES));
  });
});
