import { describe, expect, it } from "vitest";
import { SUBTYPE_BY_ID, SUBTYPES, createReportSchema, ttlOptions } from "@mountain-live/core";
import {
  DESCRIPTION_MAX,
  DRAFT_MESSAGES,
  applySubtype,
  buildCreateReportInput,
  createDraft,
  defaultEndsAt,
  defaultTtlMinutes,
  draftReducer,
  expiryText,
  fromLocalInputValue,
  isPositionValid,
  parseStep,
  roundUpToQuarter,
  toLocalInputValue,
  validateDraft,
  validityLabelForDraft,
  validityLabelForReport,
  type DraftPosition,
} from "./wizardState";

/** 14/09/2026 à 9 h 07 (heure locale). */
const NOW = new Date(2026, 8, 14, 9, 7, 0, 0);
const GPS: DraftPosition = { lat: 42.305123456, lng: 9.150449876, accuracy: 12, source: "gps", adjusted: false };
const MAP_CENTER: DraftPosition = { lat: 42.25, lng: 9.05, accuracy: null, source: "map", adjusted: false };

describe("buildCreateReportInput", () => {
  it("sous-type à durée : ttlMinutes par défaut, niveau « Modéré », coordonnées arrondies, sans heure de fin", () => {
    const draft = applySubtype({ ...createDraft("c_test"), position: GPS }, "fallen_tree", NOW);
    const input = buildCreateReportInput(draft);
    expect(input).not.toBeNull();
    expect(input).toMatchObject({
      subtype: "fallen_tree",
      lat: 42.305123,
      lng: 9.15045,
      clientId: "c_test",
      dangerLevel: "moderate",
      ttlMinutes: SUBTYPE_BY_ID.fallen_tree.defaultTtlMin,
    });
    expect(input?.endsAt).toBeUndefined();
    expect(input?.description).toBeUndefined();
    expect(createReportSchema.safeParse(input).success).toBe(true);
  });

  it("sous-type à heure de fin : endsAt ISO (UTC), ni ttlMinutes ni niveau de danger", () => {
    const draft = applySubtype({ ...createDraft("c_hunt"), position: GPS }, "hunting", NOW);
    const input = buildCreateReportInput(draft);
    expect(input?.ttlMinutes).toBeUndefined();
    expect(input?.dangerLevel).toBeUndefined();
    expect(input?.endsAt).toBe(new Date(2026, 8, 14, 15, 15).toISOString());
    expect(createReportSchema.safeParse(input).success).toBe(true);
  });

  it("commentaire nettoyé et omis s'il est vide ; durée choisie respectée", () => {
    let draft = applySubtype({ ...createDraft("c_1"), position: GPS }, "rockfall", NOW);
    draft = draftReducer(draft, { type: "description", description: "  Passage difficile  " });
    draft = draftReducer(draft, { type: "ttl", ttlMinutes: 7 * 24 * 60 });
    const input = buildCreateReportInput(draft);
    expect(input?.description).toBe("Passage difficile");
    expect(input?.ttlMinutes).toBe(7 * 24 * 60);
    draft = draftReducer(draft, { type: "description", description: "   " });
    expect(buildCreateReportInput(draft)?.description).toBeUndefined();
  });

  it("renvoie null sans sous-type ou sans position", () => {
    expect(buildCreateReportInput(createDraft("c"))).toBeNull();
    expect(buildCreateReportInput(applySubtype(createDraft("c"), "herd", NOW))).toBeNull();
  });
});

describe("durées par défaut (section 5)", () => {
  it("defaultTtlMinutes est la durée par défaut de la taxonomie et figure toujours dans ttlOptions", () => {
    for (const s of SUBTYPES) {
      expect(defaultTtlMinutes(s.id)).toBe(s.defaultTtlMin);
      expect(ttlOptions(s.id).some((o) => o.minutes === s.defaultTtlMin)).toBe(true);
    }
  });

  it("applySubtype présélectionne la durée par défaut, « Modéré » si demandé, et une heure de fin sinon", () => {
    const tree = applySubtype(createDraft("c"), "fallen_tree", NOW);
    expect(tree.ttlMinutes).toBe(5 * 24 * 60);
    expect(tree.dangerLevel).toBe("moderate");
    expect(tree.endsAtLocal).toBeNull();
    expect(tree.category).toBe("danger");

    const herd = applySubtype(createDraft("c"), "herd", NOW);
    expect(herd.dangerLevel).toBeNull();
    expect(herd.ttlMinutes).toBe(4 * 60);

    const closed = applySubtype(createDraft("c"), "path_closed", NOW);
    expect(closed.ttlMinutes).toBeNull();
    expect(closed.endsAtLocal).toBe("2026-09-21T09:15");
  });

  it("defaultEndsAt : +6 h pour la chasse, +7 j pour une fermeture, arrondi au quart d'heure", () => {
    expect(defaultEndsAt("hunting", NOW)).toEqual(new Date(2026, 8, 14, 15, 15));
    expect(defaultEndsAt("battue", NOW)).toEqual(new Date(2026, 8, 14, 15, 15));
    expect(defaultEndsAt("path_closed", NOW)).toEqual(new Date(2026, 8, 21, 9, 15));
    expect(defaultEndsAt("works", NOW)).toEqual(new Date(2026, 8, 21, 9, 15));
    expect(roundUpToQuarter(new Date(2026, 0, 1, 10, 0, 0))).toEqual(new Date(2026, 0, 1, 10, 0, 0));
    expect(roundUpToQuarter(new Date(2026, 0, 1, 10, 46, 30))).toEqual(new Date(2026, 0, 1, 11, 0, 0));
  });

  it("toLocalInputValue / fromLocalInputValue : aller-retour en heure locale", () => {
    const d = new Date(2026, 11, 3, 7, 5);
    expect(toLocalInputValue(d)).toBe("2026-12-03T07:05");
    expect(fromLocalInputValue("2026-12-03T07:05")).toEqual(d);
    expect(fromLocalInputValue("")).toBeNull();
    expect(fromLocalInputValue("n'importe quoi")).toBeNull();
  });
});

describe("position", () => {
  it("valide une position GPS ou un point placé à la main, pas le centre de carte brut", () => {
    expect(isPositionValid(GPS)).toBe(true);
    expect(isPositionValid(MAP_CENTER)).toBe(false);
    expect(isPositionValid({ ...MAP_CENTER, adjusted: true })).toBe(true);
    expect(isPositionValid(null)).toBe(false);
    expect(isPositionValid({ ...GPS, lat: Number.NaN })).toBe(false);
  });
});

describe("validateDraft", () => {
  it("refuse sans position, avec un message français", () => {
    const v = validateDraft(applySubtype(createDraft("c"), "fallen_tree", NOW), NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.position).toBe(DRAFT_MESSAGES.positionMissing);
  });

  it("refuse le centre de carte non ajusté, accepte une fois le point placé", () => {
    const base = applySubtype({ ...createDraft("c"), position: MAP_CENTER }, "spring_dry", NOW);
    const v1 = validateDraft(base, NOW);
    expect(v1.ok).toBe(false);
    if (!v1.ok) expect(v1.errors.position).toBe(DRAFT_MESSAGES.positionToAdjust);
    const v2 = validateDraft({ ...base, position: { ...MAP_CENTER, adjusted: true } }, NOW);
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.input.ttlMinutes).toBe(SUBTYPE_BY_ID.spring_dry.defaultTtlMin);
  });

  it("refuse une heure de fin passée ou invalide", () => {
    const hunt = applySubtype({ ...createDraft("c"), position: GPS }, "hunting", NOW);
    const past = validateDraft({ ...hunt, endsAtLocal: "2026-09-14T08:00" }, NOW);
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.errors.endsAt).toBe(DRAFT_MESSAGES.endsAtPast);
    const invalid = validateDraft({ ...hunt, endsAtLocal: "" }, NOW);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors.endsAt).toBe(DRAFT_MESSAGES.endsAtInvalid);
    expect(validateDraft(hunt, NOW).ok).toBe(true);
  });

  it("refuse un commentaire trop long", () => {
    const draft = { ...applySubtype({ ...createDraft("c"), position: GPS }, "herd", NOW), description: "x".repeat(DESCRIPTION_MAX + 1) };
    const v = validateDraft(draft, NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.description).toBe(DRAFT_MESSAGES.descriptionTooLong);
  });
});

describe("draftReducer", () => {
  it("changer de catégorie réinitialise le sous-type mais garde position, photo et commentaire", () => {
    const photo = new Blob(["x"], { type: "image/jpeg" });
    let draft = applySubtype({ ...createDraft("c"), position: GPS, photo, description: "vu ce matin" }, "fallen_tree", NOW);
    draft = draftReducer(draft, { type: "category", category: "animals" });
    expect(draft.subtype).toBeNull();
    expect(draft.dangerLevel).toBeNull();
    expect(draft.ttlMinutes).toBeNull();
    expect(draft.position).toBe(GPS);
    expect(draft.photo).toBe(photo);
    expect(draft.description).toBe("vu ce matin");
  });

  it("tronque le commentaire à 600 caractères et remplace le brouillon sur reset", () => {
    const draft = draftReducer(createDraft("c"), { type: "description", description: "a".repeat(700) });
    expect(draft.description).toHaveLength(DESCRIPTION_MAX);
    const fresh = createDraft("c2");
    expect(draftReducer(draft, { type: "reset", draft: fresh })).toBe(fresh);
  });
});

describe("libellés", () => {
  it("parseStep n'accepte que les étapes connues", () => {
    expect(parseStep("category")).toBe("category");
    expect(parseStep("done")).toBe("done");
    expect(parseStep("autre")).toBeNull();
    expect(parseStep(undefined)).toBeNull();
  });

  it("expiryText et validité (brouillon et signalement)", () => {
    expect(expiryText(5 * 24 * 60)).toBe("Ce signalement expirera automatiquement dans 5 j.");
    const tree = applySubtype({ ...createDraft("c"), position: GPS }, "fallen_tree", NOW);
    expect(validityLabelForDraft(tree, NOW)).toBe("Visible pendant 5 j");
    const hunt = applySubtype({ ...createDraft("c"), position: GPS }, "hunting", NOW);
    expect(validityLabelForDraft(hunt, NOW)).toMatch(/^Visible jusqu'à 15 h 15/);
    expect(validityLabelForReport({ expiresAt: new Date(NOW.getTime() + 5 * 24 * 60 * 60_000).toISOString(), endsAt: null }, NOW)).toBe("Visible pendant 5 j");
    expect(validityLabelForReport({ expiresAt: new Date(2026, 8, 14, 15, 15).toISOString(), endsAt: new Date(2026, 8, 14, 15, 15).toISOString() }, NOW)).toMatch(/^Visible jusqu'à 15 h 15/);
  });
});
