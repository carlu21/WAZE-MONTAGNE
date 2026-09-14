import { describe, expect, it } from "vitest";
import { formatBadgeCount, formatCount, formatDateTime, formatDistance, formatNumber, formatRelative, initials, pluralize } from "./format";

describe("format", () => {
  const now = new Date("2026-09-14T12:00:00");

  it("formatRelative : court (core) et long (date-fns)", () => {
    expect(formatRelative(new Date(now.getTime() - 35 * 60_000), { now })).toBe("il y a 35 min");
    expect(formatRelative(new Date(now.getTime() - 2 * 3_600_000), { now })).toBe("il y a 2 h");
    expect(formatRelative(new Date(now.getTime() + 3 * 3_600_000), { now })).toBe("dans 3 h");
    expect(formatRelative(new Date(now.getTime() - 10_000), { now })).toBe("à l'instant");
    expect(formatRelative(new Date(now.getTime() - 35 * 60_000), { now, style: "long" })).toBe("il y a 35 minutes");
    expect(formatRelative(new Date(now.getTime() - 35 * 60_000), { now, addSuffix: false })).toBe("35 min");
    expect(formatRelative("pas une date")).toBe("");
  });

  it("formatDateTime : aujourd'hui / hier / date courte", () => {
    const today = new Date();
    today.setHours(18, 5, 0, 0);
    expect(formatDateTime(today)).toBe("aujourd'hui à 18 h 05");
    expect(formatDateTime(new Date("2026-03-02T09:30:00"), { relativeDay: false, now })).toBe("2 mars à 9 h 30");
    expect(formatDateTime(new Date("2025-03-02T09:30:00"), { relativeDay: false, now })).toBe("2 mars 2025 à 9 h 30");
  });

  it("pluriel et compteurs français", () => {
    expect(pluralize(0, "utilisateur")).toBe("utilisateur");
    expect(pluralize(1, "utilisateur")).toBe("utilisateur");
    expect(pluralize(2, "utilisateur")).toBe("utilisateurs");
    expect(pluralize(3, "cheval", "chevaux")).toBe("chevaux");
    expect(formatCount(1, "signalement")).toBe("1 signalement");
    // Intl (fr-FR) sépare les milliers par une espace fine insécable (U+202F).
    expect(formatCount(1234, "confirmation")).toBe("1\u202f234 confirmations");
    expect(formatNumber(NaN)).toBe("—");
    expect(formatBadgeCount(0)).toBe("");
    expect(formatBadgeCount(7)).toBe("7");
    expect(formatBadgeCount(150)).toBe("99+");
  });

  it("distance (core) et initiales", () => {
    expect(formatDistance(320)).toBe("320 m");
    expect(formatDistance(1234)).toBe("1,2 km");
    expect(initials("Marie Dupont")).toBe("MD");
    expect(initials("rando")).toBe("RA");
    expect(initials("")).toBe("?");
  });
});
