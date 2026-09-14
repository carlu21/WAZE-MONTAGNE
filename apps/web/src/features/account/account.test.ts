import { describe, expect, it } from "vitest";
import { registerSchema } from "@mountain-live/core";
import { filtersForPractices } from "./practices";
import { splashTarget } from "./splash";

describe("compte", () => {
  it("valide un formulaire d'inscription", () => {
    const ok = registerSchema.safeParse({ email: "a@b.fr", password: "12345678", pseudo: "Anna L.", practices: ["hiker"], consent: true });
    expect(ok.success).toBe(true);
    const ko = registerSchema.safeParse({ email: "a@b", password: "123", pseudo: "A", practices: [], consent: false });
    expect(ko.success).toBe(false);
  });

  it("redirige selon l'état de l'onboarding", () => {
    expect(splashTarget({ onboardingDone: false, hasToken: false })).toBe("/onboarding");
    expect(splashTarget({ onboardingDone: true, hasToken: false })).toBe("/map");
    expect(splashTarget({ onboardingDone: false, hasToken: true })).toBe("/map");
  });

  it("fusionne les filtres recommandés des pratiques", () => {
    expect(filtersForPractices(["rider"])).toEqual(["animals", "activity", "path", "water", "danger"]);
    expect(filtersForPractices(["hiker", "mtb"])).toContain("crowd");
    // Toutes les catégories → tout afficher
    expect(filtersForPractices(["professional"])).toEqual([]);
  });
});
