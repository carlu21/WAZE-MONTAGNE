import { describe, expect, it } from "vitest";
import { PREVIEW_PEEK_BASE, PREVIEW_PEEK_MAX, previewPeekHeight } from "./TrailPreviewSheet";
import {
  AT_TRAILHEAD_M,
  DIFFICULTY_LABELS,
  DIFFICULTY_TONE,
  SHAPE_LABELS,
  SORT_LABELS,
  approachLabel,
  atTrailhead,
  durationLabel,
  elevationLabel,
  fitZoomFor,
  frequentationLabel,
  lengthLabel,
} from "./format";

/**
 * Ce que ces tests protègent : qu'on ne puisse pas lire « 9,4 km » en croyant
 * que c'est la distance jusqu'au départ, et qu'un chemin dont on ne sait rien
 * ne soit pas présenté comme désert.
 */
describe("les deux distances", () => {
  it("ne formule jamais l'approche et la longueur de la même façon", () => {
    const approche = approachLabel(4200);
    const longueur = lengthLabel(9400);
    expect(approche).toMatch(/de vous/);
    expect(longueur).not.toMatch(/de vous/);
    expect(approche).not.toBe(longueur);
    // Même valeur : les deux phrases restent distinctes.
    expect(approachLabel(9400)).not.toBe(lengthLabel(9400));
  });

  it("dit « départ ici même » quand on y est déjà", () => {
    expect(approachLabel(0)).toMatch(/ici même/i);
    expect(approachLabel(80)).toMatch(/ici même/i);
    expect(approachLabel(500)).toMatch(/de vous/);
  });

  it("ne produit ni NaN ni distance négative", () => {
    expect(approachLabel(Number.NaN)).toBe("Distance inconnue");
    expect(approachLabel(-10)).toBe("Distance inconnue");
    expect(lengthLabel(0)).toBe("Longueur inconnue");
    expect(lengthLabel(Number.NaN)).toBe("Longueur inconnue");
  });
});

describe("durée et dénivelé", () => {
  it("marque d'un « ≈ » une durée qui n'est qu'estimée", () => {
    expect(durationLabel(3600_000, false)).toMatch(/^≈/);
    expect(durationLabel(3600_000, true)).not.toMatch(/^≈/);
  });

  it("supporte l'absence de donnée", () => {
    expect(durationLabel(0, true)).toBe("—");
    expect(durationLabel(Number.NaN, false)).toBe("—");
    expect(elevationLabel(0)).toBe("—");
    expect(elevationLabel(620)).toBe("+620 m");
  });
});

describe("fréquentation", () => {
  it("n'affiche rien plutôt que de laisser croire à un chemin désert", () => {
    expect(frequentationLabel(null, null)).toBeNull();
    expect(frequentationLabel("unknown", null)).toBeNull();
  });

  it("préfère le comptage réel quand il existe", () => {
    expect(frequentationLabel("high", 27)).toBe("27 passages aujourd'hui");
    expect(frequentationLabel(null, 1)).toBe("1 passage aujourd'hui");
    // Zéro passage aujourd'hui n'efface pas le niveau connu par ailleurs.
    expect(frequentationLabel("low", 0)).toBe("Calme");
  });
});

describe("libellés", () => {
  it("couvre les quatre difficultés, les trois formes et les cinq tris", () => {
    expect(Object.keys(DIFFICULTY_LABELS)).toHaveLength(4);
    expect(Object.keys(SHAPE_LABELS)).toHaveLength(3);
    expect(Object.keys(SORT_LABELS)).toHaveLength(5);
    expect(SORT_LABELS.closest).toMatch(/proche/i);
  });

  it("ne teinte jamais une difficulté en rouge : le rouge est réservé au danger", () => {
    for (const tone of Object.values(DIFFICULTY_TONE)) {
      expect(tone).not.toBe("danger");
    }
  });

  it("distingue une boucle d'un aller-retour", () => {
    expect(SHAPE_LABELS.loop).not.toBe(SHAPE_LABELS.out_and_back);
  });
});

describe("cadrage et départ", () => {
  it("dézoome sur les longs itinéraires", () => {
    expect(fitZoomFor(30_000)).toBeLessThan(fitZoomFor(2_000));
    expect(fitZoomFor(9_000)).toBeLessThan(fitZoomFor(4_000));
  });

  it("propose de démarrer seulement quand on est au départ", () => {
    expect(atTrailhead(0)).toBe(true);
    expect(atTrailhead(AT_TRAILHEAD_M)).toBe(true);
    expect(atTrailhead(AT_TRAILHEAD_M + 1)).toBe(false);
    expect(atTrailhead(4200)).toBe(false);
    expect(atTrailhead(Number.NaN)).toBe(false);
  });
});

describe("palier d'aperçu de la fiche", () => {
  it("s'agrandit pour montrer un refus, sans jamais avaler la carte", () => {
    expect(previewPeekHeight(null, null)).toBe(PREVIEW_PEEK_BASE);
    expect(previewPeekHeight("tracé schématique", null)).toBeGreaterThan(PREVIEW_PEEK_BASE);
    // Les deux encarts réunis dépasseraient l'écran : le palier est plafonné.
    expect(previewPeekHeight("tracé schématique", { message: "Aucun itinéraire", note: null, direction: null })).toBe(PREVIEW_PEEK_MAX);
  });
});
