import { describe, expect, it } from "vitest";
import {
  addDays,
  addMinutes,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTime,
  formatUntil,
  isSameDay,
  minutesBetween,
  toDate,
} from "./time";

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;
// Heure locale : les libellés d'heure suivent le fuseau de l'appareil.
const NOW = new Date(2026, 8, 14, 12, 0, 0);
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

describe("formatRelative", () => {
  it("« à l'instant » sous 45 secondes", () => {
    expect(formatRelative(NOW, NOW)).toBe("à l'instant");
    expect(formatRelative(ago(10 * S), NOW)).toBe("à l'instant");
    expect(formatRelative(ago(44 * S), NOW)).toBe("à l'instant");
  });
  it("minutes, heures, jours, semaines", () => {
    expect(formatRelative(ago(45 * S), NOW)).toBe("il y a 1 min");
    expect(formatRelative(ago(3 * MIN), NOW)).toBe("il y a 3 min");
    expect(formatRelative(ago(59 * MIN + 30 * S), NOW)).toBe("il y a 59 min");
    expect(formatRelative(ago(60 * MIN), NOW)).toBe("il y a 1 h");
    expect(formatRelative(ago(2 * H), NOW)).toBe("il y a 2 h");
    expect(formatRelative(ago(23 * H + 59 * MIN), NOW)).toBe("il y a 23 h");
    expect(formatRelative(ago(D), NOW)).toBe("il y a 1 j");
    expect(formatRelative(ago(3 * D), NOW)).toBe("il y a 3 j");
    expect(formatRelative(ago(6 * D + 23 * H), NOW)).toBe("il y a 6 j");
    expect(formatRelative(ago(7 * D), NOW)).toBe("il y a 1 sem.");
    expect(formatRelative(ago(14 * D), NOW)).toBe("il y a 2 sem.");
    expect(formatRelative(ago(34 * D), NOW)).toBe("il y a 4 sem.");
  });
  it("mois et années", () => {
    expect(formatRelative(ago(35 * D), NOW)).toBe("il y a 1 mois");
    expect(formatRelative(ago(70 * D), NOW)).toBe("il y a 2 mois");
    expect(formatRelative(ago(400 * D), NOW)).toBe("il y a 1 an");
    expect(formatRelative(ago(800 * D), NOW)).toBe("il y a 2 ans");
  });
  it("dates futures et entrées diverses", () => {
    expect(formatRelative(new Date(NOW.getTime() + 2 * H), NOW)).toBe("dans 2 h");
    expect(formatRelative(new Date(NOW.getTime() + 20 * S), NOW)).toBe("à l'instant");
    expect(formatRelative(ago(3 * MIN).toISOString(), NOW)).toBe("il y a 3 min");
    expect(formatRelative(ago(3 * MIN).getTime(), NOW.getTime())).toBe("il y a 3 min");
    expect(formatRelative("invalide", NOW)).toBe("");
  });
});

describe("formatUntil", () => {
  it("le jour même : « jusqu'à 13 h »", () => {
    expect(formatUntil(new Date(2026, 8, 14, 13, 0), NOW)).toBe("jusqu'à 13 h");
    expect(formatUntil(new Date(2026, 8, 14, 13, 30), NOW)).toBe("jusqu'à 13 h 30");
    expect(formatUntil(new Date(2026, 8, 14, 9, 5), NOW)).toBe("jusqu'à 9 h 05");
  });
  it("un autre jour : « jusqu'au 15/09 à 18 h »", () => {
    expect(formatUntil(new Date(2026, 8, 15, 18, 0), NOW)).toBe("jusqu'au 15/09 à 18 h");
    expect(formatUntil(new Date(2027, 0, 14, 18, 0), NOW)).toBe("jusqu'au 14/01/2027 à 18 h");
    expect(formatUntil("invalide", NOW)).toBe("");
  });
});

describe("formats de date", () => {
  const d = new Date(2026, 8, 14, 18, 5);
  it("formatTime / formatDate / formatDateShort / formatDateTime", () => {
    expect(formatTime(d)).toBe("18 h 05");
    expect(formatTime(new Date(2026, 8, 14, 0, 0))).toBe("0 h");
    expect(formatDateShort(d)).toBe("14/09");
    expect(formatDate(d)).toBe("14/09/2026");
    expect(formatDateTime(d)).toBe("14/09/2026 à 18 h 05");
    expect(formatDateTime("n'importe quoi")).toBe("");
  });
  it("formatDuration", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(-5)).toBe("0 min");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(90)).toBe("1 h 30");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(1440)).toBe("1 j");
    expect(formatDuration(1800)).toBe("1 j 6 h");
    expect(formatDuration(Number.NaN)).toBe("0 min");
  });
});

describe("utilitaires", () => {
  it("toDate", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate("invalide")).toBeNull();
    expect(toDate("2026-09-14T08:00:00.000Z")?.toISOString()).toBe("2026-09-14T08:00:00.000Z");
    expect(toDate(NOW)?.getTime()).toBe(NOW.getTime());
    expect(toDate(NOW)).not.toBe(NOW);
  });
  it("isSameDay / addDays / addMinutes / minutesBetween", () => {
    expect(isSameDay(NOW, new Date(2026, 8, 14, 23, 59))).toBe(true);
    expect(isSameDay(NOW, new Date(2026, 8, 15, 0, 0))).toBe(false);
    expect(isSameDay("x", NOW)).toBe(false);
    expect(addDays(NOW, 1).getDate()).toBe(15);
    expect(addMinutes(NOW, 90).getTime()).toBe(NOW.getTime() + 90 * MIN);
    expect(minutesBetween(NOW, addMinutes(NOW, 30))).toBe(30);
    expect(minutesBetween(addMinutes(NOW, 30), NOW)).toBe(-30);
    expect(minutesBetween("x", NOW)).toBe(0);
  });
});
