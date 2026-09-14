import { describe, expect, it } from "vitest";
import {
  VISIBLE_STATUSES,
  TERMINAL_STATUSES,
  clampTtl,
  computeExpiresAt,
  computeFade,
  deriveStatus,
  effectiveEndMs,
  isExpired,
  isVisibleStatus,
  lifeRatio,
  recencyWindowMin,
  remainingMinutes,
  shouldArchive,
  summarizeVotes,
  type DeriveStatusInput,
} from "./lifecycle";
import { SUBTYPE_BY_ID } from "./taxonomy";

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
const T0 = new Date("2026-09-14T08:00:00.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);

describe("clampTtl", () => {
  it("renvoie la durée par défaut sans demande", () => {
    expect(clampTtl("wildlife", null)).toBe(SUBTYPE_BY_ID.wildlife.defaultTtlMin);
    expect(clampTtl("wildlife", undefined)).toBe(120);
    expect(clampTtl("wildlife", Number.NaN)).toBe(120);
  });
  it("borne entre min et max du sous-type", () => {
    expect(clampTtl("wildlife", 10)).toBe(60);
    expect(clampTtl("wildlife", 100_000)).toBe(180);
    expect(clampTtl("wildlife", 90.4)).toBe(90);
    expect(clampTtl("rockfall", 1)).toBe(2 * 24 * 60);
  });
});

describe("computeExpiresAt", () => {
  it("l'heure de fin prime pour les sous-types à heure de fin", () => {
    const end = at(5 * H).toISOString();
    expect(computeExpiresAt("hunting", T0, 60, end).toISOString()).toBe(end);
  });
  it("ignore une heure de fin passée ou invalide et retombe sur le TTL borné", () => {
    expect(computeExpiresAt("hunting", T0, null, at(-H).toISOString()).getTime()).toBe(at(6 * H).getTime());
    expect(computeExpiresAt("hunting", T0, null, "pas-une-date").getTime()).toBe(at(6 * H).getTime());
    expect(computeExpiresAt("hunting", T0, 100 * 60, null).getTime()).toBe(at(14 * H).getTime());
  });
  it("ignore l'heure de fin pour les sous-types sans heure de fin", () => {
    expect(computeExpiresAt("herd", T0, null, at(3 * D).toISOString()).getTime()).toBe(at(4 * H).getTime());
  });
});

describe("computeFade / lifeRatio", () => {
  const c = T0;
  const e = at(10 * H);
  it("vaut 1 jusqu'à 60 % de la vie", () => {
    expect(computeFade(c, e, at(0))).toBe(1);
    expect(computeFade(c, e, at(3 * H))).toBe(1);
    expect(computeFade(c, e, at(6 * H))).toBe(1);
    expect(computeFade(c, e, at(-H))).toBe(1);
  });
  it("décroît linéairement vers 0,35", () => {
    expect(computeFade(c, e, at(8 * H))).toBeCloseTo(0.675, 6);
    expect(computeFade(c, e, at(10 * H))).toBe(0.35);
    expect(computeFade(c, e, at(20 * H))).toBe(0.35);
  });
  it("est monotone décroissant", () => {
    let prev = 1;
    for (let h = 0; h <= 12; h += 0.5) {
      const f = computeFade(c, e, at(h * H));
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });
  it("gère les bornes dégénérées", () => {
    expect(computeFade(c, c, at(0))).toBe(0.35);
    expect(computeFade("invalide", e, at(0))).toBe(0.35);
    expect(lifeRatio(c, e, at(5 * H))).toBeCloseTo(0.5);
  });
});

describe("isExpired / effectiveEndMs / remainingMinutes", () => {
  const r = { expiresAt: at(2 * H).toISOString(), endsAt: null as string | null };
  it("compare à expiresAt", () => {
    expect(isExpired(r, at(H))).toBe(false);
    expect(isExpired(r, at(2 * H))).toBe(true);
  });
  it("prend la première des deux dates", () => {
    const withEnd = { ...r, endsAt: at(H).toISOString() };
    expect(effectiveEndMs(withEnd)).toBe(at(H).getTime());
    expect(isExpired(withEnd, at(90 * MIN))).toBe(true);
    expect(remainingMinutes(withEnd, at(30 * MIN))).toBe(30);
    expect(remainingMinutes(withEnd, at(3 * H))).toBe(0);
  });
});

describe("recencyWindowMin", () => {
  it("vaut 25 % de la durée de vie, entre 1 h et 7 j", () => {
    expect(recencyWindowMin(24 * 60)).toBe(360);
    expect(recencyWindowMin()).toBe(360);
    expect(recencyWindowMin(60)).toBe(60);
    expect(recencyWindowMin(365 * 24 * 60)).toBe(7 * 24 * 60);
    expect(recencyWindowMin(Number.NaN)).toBe(360);
  });
});

describe("summarizeVotes", () => {
  it("compte les votes et les votes récents", () => {
    const now = at(10 * H);
    const s = summarizeVotes(
      [
        { kind: "still_present", createdAt: at(9 * H) },
        { kind: "still_present", createdAt: at(1 * H) },
        { kind: "gone", createdAt: at(9.5 * H) },
        { kind: "gone", createdAt: at(0) },
        { kind: "improved", createdAt: at(2 * H) },
        { kind: "disputed", createdAt: at(2 * H) },
      ],
      now,
      120,
    );
    expect(s).toEqual({
      stillPresent: 2,
      improved: 1,
      gone: 2,
      disputed: 1,
      recentStillPresent: 1,
      recentGone: 1,
      lastStillPresentAt: at(9 * H).toISOString(),
    });
  });
  it("renvoie des zéros sans votes", () => {
    expect(summarizeVotes([], T0).stillPresent).toBe(0);
    expect(summarizeVotes([], T0).lastStillPresentAt).toBeNull();
  });
});

describe("deriveStatus", () => {
  const base: DeriveStatusInput = {
    current: "active",
    source: "community",
    stillPresent: 0,
    improved: 0,
    gone: 0,
    disputed: 0,
    recentStillPresent: 0,
    recentGone: 0,
    expired: false,
    manuallyResolved: false,
  };
  const d = (patch: Partial<DeriveStatusInput>) => deriveStatus({ ...base, ...patch });

  it("deleted et résolution manuelle sont définitifs", () => {
    expect(d({ current: "deleted", expired: true, stillPresent: 9 })).toBe("deleted");
    expect(d({ current: "resolved", manuallyResolved: true, expired: true, stillPresent: 9 })).toBe("resolved");
    expect(d({ source: "official", manuallyResolved: true })).toBe("resolved");
  });
  it("expiré prime sur les votes", () => {
    expect(d({ expired: true, stillPresent: 5, recentStillPresent: 5 })).toBe("expired");
    expect(d({ source: "official", expired: true })).toBe("expired");
  });
  it("une source officielle n'est jamais contestée ni résolue par la communauté", () => {
    expect(d({ source: "official", disputed: 10, gone: 10, recentGone: 10 })).toBe("confirmed");
    expect(d({ source: "official" })).toBe("confirmed");
  });
  it("contesté si ≥ 2 contestations et au moins autant que de confirmations", () => {
    expect(d({ disputed: 2 })).toBe("disputed");
    expect(d({ disputed: 2, stillPresent: 2 })).toBe("disputed");
    expect(d({ disputed: 1 })).toBe("active");
    expect(d({ disputed: 2, stillPresent: 3 })).toBe("confirmed");
    expect(d({ source: "partner", disputed: 2 })).toBe("disputed");
  });
  it("résolu si ≥ 3 « plus présent » et que le signal l'emporte", () => {
    expect(d({ gone: 3, recentGone: 3 })).toBe("resolved");
    expect(d({ gone: 3 })).toBe("resolved");
    expect(d({ gone: 3, stillPresent: 3 })).toBe("probably_resolved");
    expect(d({ gone: 3, recentGone: 1, stillPresent: 2, recentStillPresent: 2 })).toBe("confirmed");
  });
  it("probablement résolu avec un signal de résolution non dominé", () => {
    expect(d({ gone: 1, improved: 1 })).toBe("probably_resolved");
    expect(d({ gone: 2 })).toBe("probably_resolved");
    expect(d({ gone: 2, stillPresent: 10 })).toBe("confirmed");
    expect(d({ gone: 2, recentGone: 2, stillPresent: 10, recentStillPresent: 0 })).toBe("probably_resolved");
    expect(d({ gone: 1 })).toBe("active");
    expect(d({ improved: 3 })).toBe("active");
  });
  it("confirmé avec 2 confirmations ou une source partenaire", () => {
    expect(d({ stillPresent: 2 })).toBe("confirmed");
    expect(d({ stillPresent: 1 })).toBe("active");
    expect(d({ source: "partner" })).toBe("confirmed");
  });
  it("recalcule un ancien statut expiré si la date a été prolongée", () => {
    expect(d({ current: "expired", expired: false })).toBe("active");
  });
});

describe("shouldArchive", () => {
  const base = { status: "active" as const, expiresAt: at(2 * H).toISOString(), endsAt: null, updatedAt: T0.toISOString() };
  it("n'archive pas un signalement en cours", () => {
    expect(shouldArchive(base, at(H))).toBe(false);
    expect(shouldArchive(base, at(40 * D), Infinity)).toBe(false);
  });
  it("archive après la rétention suivant l'expiration", () => {
    expect(shouldArchive(base, at(2 * H + 10 * D))).toBe(false);
    expect(shouldArchive(base, at(2 * H + 30 * D))).toBe(true);
    expect(shouldArchive(base, at(2 * H), 0)).toBe(true);
  });
  it("archive un signalement résolu ou supprimé selon updatedAt", () => {
    const resolved = { ...base, status: "resolved" as const, expiresAt: at(90 * D).toISOString() };
    expect(shouldArchive(resolved, at(31 * D))).toBe(true);
    expect(shouldArchive(resolved, at(29 * D))).toBe(false);
    const deleted = { ...base, status: "deleted" as const, updatedAt: at(D).toISOString(), expiresAt: at(90 * D).toISOString() };
    expect(shouldArchive(deleted, at(2 * D))).toBe(false);
    expect(shouldArchive(deleted, at(32 * D))).toBe(true);
  });
});

describe("statuts", () => {
  it("expose les statuts visibles et terminaux", () => {
    expect(VISIBLE_STATUSES).toEqual(["active", "confirmed", "probably_resolved", "disputed"]);
    expect(TERMINAL_STATUSES).toEqual(["resolved", "expired", "deleted"]);
    expect(isVisibleStatus("confirmed")).toBe(true);
    expect(isVisibleStatus("expired")).toBe(false);
  });
});
