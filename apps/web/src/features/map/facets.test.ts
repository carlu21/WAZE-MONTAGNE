import { describe, expect, it } from "vitest";
import { applyExcludedSubtypes, isFacetExcluded, toggleFacet } from "./facets";

describe("facettes Chasse / Activités", () => {
  it("masque la chasse en gardant les activités", () => {
    const r = toggleFacet("hunting", [], []);
    expect(r.filters).toContain("activity");
    expect(isFacetExcluded("hunting", r.excluded)).toBe(true);
    expect(isFacetExcluded("activities", r.excluded)).toBe(false);
  });
  it("retire la catégorie quand les deux facettes sont masquées", () => {
    const first = toggleFacet("hunting", ["danger", "activity"], []);
    const second = toggleFacet("activities", first.filters, first.excluded);
    expect(second.filters).toEqual(["danger"]);
    expect(second.excluded).toEqual([]);
  });
  it("réactive une facette sans afficher l'autre", () => {
    const r = toggleFacet("hunting", ["danger"], []);
    expect(r.filters).toEqual(["danger", "activity"]);
    expect(isFacetExcluded("activities", r.excluded)).toBe(true);
    expect(applyExcludedSubtypes([{ subtype: "battue" }, { subtype: "sport_event" }], r.excluded).map((x) => x.subtype)).toEqual(["battue"]);
  });
});
