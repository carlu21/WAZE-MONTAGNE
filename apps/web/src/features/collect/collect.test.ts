import { describe, expect, it } from "vitest";
import {
  LICENCE_LABELS,
  ORIGIN_QUESTION,
  QUALITY_LABELS,
  QUALITY_TONE,
  REUSE_LABELS,
  REUSE_TONE,
  RIGHTS_QUESTION,
  SOURCE_TYPE_LABELS,
  TRACE_STATUS_LABELS,
  formatFromFileName,
} from "./labels";

/**
 * Libellés de la collecte. Ce que ces tests protègent n'est pas cosmétique :
 * si « à vérifier » s'affichait comme un succès, un administrateur croirait
 * exploitable une source dont personne n'a lu les conditions.
 */
describe("libellés de la collecte", () => {
  it("nomme chaque licence du contrat", () => {
    for (const [id, label] of Object.entries(LICENCE_LABELS)) {
      expect(label.length, id).toBeGreaterThan(1);
    }
    expect(LICENCE_LABELS.unknown).toMatch(/inconnue/i);
    expect(LICENCE_LABELS["cc-by-nc"]).not.toBe(LICENCE_LABELS["cc-by"]);
  });

  it("ne présente jamais « à vérifier » comme un succès", () => {
    expect(REUSE_TONE.approved).toBe("success");
    expect(REUSE_TONE.review_required).toBe("neutral");
    expect(REUSE_TONE.forbidden).toBe("danger");
    expect(REUSE_LABELS.review_required).toMatch(/vérifier/i);
  });

  it("distingue visuellement une trace inutilisable d'une trace moyenne", () => {
    expect(QUALITY_TONE.unusable).toBe("danger");
    expect(QUALITY_TONE.fair).toBe("neutral");
    expect(QUALITY_TONE.excellent).toBe("success");
    expect(Object.keys(QUALITY_LABELS)).toHaveLength(5);
  });

  it("couvre les quatre statuts d'une trace et les huit types de source", () => {
    for (const key of ["review_required", "approved", "rejected", "merged"]) {
      expect(TRACE_STATUS_LABELS[key]).toBeTruthy();
    }
    expect(Object.keys(SOURCE_TYPE_LABELS)).toHaveLength(8);
  });

  it("reconnaît les extensions acceptées, et rejette les autres", () => {
    expect(formatFromFileName("parcours.gpx")).toBe("gpx");
    expect(formatFromFileName("PARCOURS.GPX")).toBe("gpx");
    expect(formatFromFileName("trace.kml")).toBe("kml");
    expect(formatFromFileName("trace.geojson")).toBe("geojson");
    expect(formatFromFileName("trace.json")).toBe("geojson");
    expect(formatFromFileName("archive.zip")).toBeNull();
    expect(formatFromFileName("sans-extension")).toBeNull();
    expect(formatFromFileName("")).toBeNull();
  });

  it("pose les deux questions de provenance et de droits", () => {
    expect(ORIGIN_QUESTION).toMatch(/provenance/i);
    expect(RIGHTS_QUESTION).toMatch(/droits/i);
  });
});
