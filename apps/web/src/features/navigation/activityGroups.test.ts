import { describe, expect, it } from "vitest";
import { dayLabel, groupActivitiesByDay } from "./activityGroups";

const NOW = new Date("2025-09-15T18:00:00").getTime();
const day = (iso: string, distanceM: number, id = iso) => ({ id, savedAt: new Date(iso).getTime(), stats: { distanceM } });

describe("regroupement des activités par jour", () => {
  it("nomme aujourd'hui et hier, puis date en toutes lettres", () => {
    expect(dayLabel(new Date("2025-09-15T08:00:00").getTime(), NOW)).toBe("Aujourd'hui");
    expect(dayLabel(new Date("2025-09-14T23:30:00").getTime(), NOW)).toBe("Hier");
    expect(dayLabel(new Date("2025-09-08T10:00:00").getTime(), NOW)).toContain("septembre");
  });

  it("totalise le nombre de sorties et la distance de chaque jour", () => {
    const groups = groupActivitiesByDay(
      [day("2025-09-15T08:00:00", 4200), day("2025-09-14T09:00:00", 9000), day("2025-09-15T16:00:00", 1800)],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(["Aujourd'hui", "Hier"]);
    expect(groups[0].count).toBe(2);
    expect(groups[0].distanceM).toBe(6000);
    expect(groups[1].distanceM).toBe(9000);
  });

  it("classe les jours du plus récent au plus ancien", () => {
    const groups = groupActivitiesByDay([day("2025-09-01T10:00:00", 1), day("2025-09-15T10:00:00", 1), day("2025-09-08T10:00:00", 1)], NOW);
    expect(groups.map((g) => g.key)).toEqual(["2025-09-15", "2025-09-08", "2025-09-01"]);
  });

  it("supporte une liste vide", () => {
    expect(groupActivitiesByDay([], NOW)).toEqual([]);
  });
});
