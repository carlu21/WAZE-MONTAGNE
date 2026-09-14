import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_RULES,
  computeConfidence,
  computeConfidenceBreakdown,
  confidenceExplanation,
  confidenceHalfLifeMin,
  confidenceLabel,
  type ConfidenceInput,
  type ConfidenceVote,
} from "./confidence";

const MIN = 60_000;
const H = 60 * MIN;
const NOW = new Date("2026-09-14T12:00:00.000Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const votes = (n: number, ageMs = 0, level = 3): ConfidenceVote[] =>
  Array.from({ length: n }, () => ({ at: ago(ageMs), voterLevel: level }));

const base: ConfidenceInput = {
  source: "community",
  reporterLevel: 1,
  confirmations: [],
  disputes: [],
  goneVotes: [],
  createdAt: ago(2 * H),
  now: NOW,
};
const score = (patch: Partial<ConfidenceInput>): number => computeConfidence({ ...base, ...patch });

describe("confidenceLabel", () => {
  it("applique les seuils 85 / 60 / 35", () => {
    expect(confidenceLabel(100)).toBe("high");
    expect(confidenceLabel(85)).toBe("high");
    expect(confidenceLabel(84)).toBe("confirmed");
    expect(confidenceLabel(60)).toBe("confirmed");
    expect(confidenceLabel(59)).toBe("probable");
    expect(confidenceLabel(35)).toBe("probable");
    expect(confidenceLabel(34)).toBe("low");
    expect(confidenceLabel(0)).toBe("low");
  });
});

describe("computeConfidence — bases et planchers", () => {
  it("part de la base de la source", () => {
    expect(score({})).toBe(25);
    expect(score({ source: "partner" })).toBe(60);
    expect(score({ source: "official" })).toBe(90);
  });
  it("ajoute le bonus de réputation du contributeur (0..12)", () => {
    expect(score({ reporterLevel: 5 })).toBe(37);
    expect(score({ reporterLevel: 3 })).toBe(31);
    expect(score({ reporterLevel: 0 })).toBe(25);
    expect(score({ reporterLevel: 99 })).toBe(37);
  });
  it("une source officielle ne descend jamais sous 85, un partenaire sous 50", () => {
    const off = score({ source: "official", disputes: votes(10, 0, 5), goneVotes: votes(10) });
    expect(off).toBe(85);
    expect(confidenceLabel(off)).toBe("high");
    expect(score({ source: "partner", disputes: votes(10, 0, 5), goneVotes: votes(10) })).toBe(50);
  });
  it("reste borné entre 0 et 100", () => {
    expect(score({ disputes: votes(6), goneVotes: votes(10) })).toBe(0);
    expect(score({ source: "official", reporterLevel: 5, confirmations: votes(50, 0, 5) })).toBe(100);
  });
});

describe("computeConfidence — confirmations", () => {
  it("augmente de façon monotone avec le nombre de confirmations", () => {
    let prev = score({});
    for (let n = 1; n <= 30; n++) {
      const s = score({ confirmations: votes(n) });
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
  it("a un rendement décroissant borné à +45", () => {
    const one = computeConfidenceBreakdown({ ...base, confirmations: votes(1) }).confirmationsBonus;
    const two = computeConfidenceBreakdown({ ...base, confirmations: votes(2) }).confirmationsBonus;
    const many = computeConfidenceBreakdown({ ...base, confirmations: votes(200, 0, 5) }).confirmationsBonus;
    expect(two - one).toBeLessThan(one);
    expect(many).toBeLessThanOrEqual(CONFIDENCE_RULES.confirmationsMax);
    expect(many).toBeGreaterThan(44);
  });
  it("pondère par le niveau du votant", () => {
    expect(score({ confirmations: votes(3, 0, 5) })).toBeGreaterThan(score({ confirmations: votes(3, 0, 1) }));
  });
  it("pondère par la récence (demi-vie = 25 % de la durée de vie)", () => {
    expect(confidenceHalfLifeMin()).toBe(360);
    expect(confidenceHalfLifeMin(60)).toBe(60);
    expect(confidenceHalfLifeMin(365 * 24 * 60)).toBe(7 * 24 * 60);
    const fresh = score({ confirmations: votes(5, 0) });
    const old = score({ confirmations: votes(5, 60 * H) });
    expect(fresh).toBeGreaterThan(old);
    expect(old).toBe(score({}));
    // Une confirmation à venir (horloge décalée) compte comme fraîche.
    expect(score({ confirmations: [{ at: new Date(NOW.getTime() + H), voterLevel: 3 }] })).toBe(
      score({ confirmations: votes(1, 0) }),
    );
  });
  it("une durée de vie longue conserve plus longtemps la valeur des confirmations", () => {
    const sixHoursOld = votes(5, 6 * H);
    expect(score({ confirmations: sixHoursOld, ttlMin: 7 * 24 * 60 })).toBeGreaterThan(
      score({ confirmations: sixHoursOld, ttlMin: 60 }),
    );
  });
  it("ignore une date invalide", () => {
    expect(score({ confirmations: [{ at: "n'importe quoi", voterLevel: 3 }] })).toBe(25);
  });
});

describe("computeConfidence — contradictions", () => {
  it("chaque contestation retire 12 points pondérés, bornés à −45", () => {
    const b1 = computeConfidenceBreakdown({ ...base, disputes: votes(1) });
    expect(b1.disputesPenalty).toBeCloseTo(12);
    const b4 = computeConfidenceBreakdown({ ...base, disputes: votes(4) });
    expect(b4.disputesPenalty).toBe(45);
    expect(computeConfidenceBreakdown({ ...base, disputes: votes(1, 0, 5) }).disputesPenalty).toBeCloseTo(16.8);
  });
  it("chaque vote « plus présent » retire 6 points, bornés à −30", () => {
    expect(computeConfidenceBreakdown({ ...base, goneVotes: votes(1) }).gonePenalty).toBe(6);
    expect(computeConfidenceBreakdown({ ...base, goneVotes: votes(10) }).gonePenalty).toBe(30);
  });
  it("décroît de façon monotone avec les contestations", () => {
    const withConf = { confirmations: votes(8) };
    let prev = score(withConf);
    for (let n = 1; n <= 6; n++) {
      const s = score({ ...withConf, disputes: votes(n) });
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });
  it("le détail est cohérent avec le score", () => {
    const b = computeConfidenceBreakdown({ ...base, reporterLevel: 4, confirmations: votes(3), disputes: votes(1), goneVotes: votes(1) });
    const raw = b.base + b.reporterBonus + b.confirmationsBonus - b.disputesPenalty - b.gonePenalty;
    expect(b.score).toBe(Math.round(Math.max(b.floor, Math.min(100, Math.max(0, raw)))));
    expect(b.halfLifeMin).toBe(360);
  });
});

describe("confidenceExplanation", () => {
  it("décrit les confirmations et leur récence", () => {
    expect(confidenceExplanation({ ...base, confirmations: [...votes(7, 3 * H), ...votes(1, 12 * MIN)] })).toBe(
      "Confirmé par 8 utilisateurs, dernière confirmation il y a 12 min",
    );
    expect(confidenceExplanation({ ...base, confirmations: votes(1, 12 * MIN) })).toBe("Confirmé par 1 utilisateur il y a 12 min");
  });
  it("décrit l'absence de confirmation selon la source", () => {
    expect(confidenceExplanation(base)).toBe("Pas encore confirmé par la communauté");
    expect(confidenceExplanation({ ...base, source: "official" })).toBe("Information officielle");
    expect(confidenceExplanation({ ...base, source: "partner" })).toBe("Signalé par un partenaire vérifié");
    expect(confidenceExplanation({ ...base, source: "official", confirmations: votes(3, 0) })).toBe(
      "Information officielle, confirmée par 3 utilisateurs",
    );
  });
  it("ajoute les contradictions", () => {
    expect(confidenceExplanation({ ...base, disputes: votes(2), goneVotes: votes(1) })).toBe(
      "Pas encore confirmé par la communauté · contesté par 2 utilisateurs · plus présent selon 1 utilisateur",
    );
  });
});
