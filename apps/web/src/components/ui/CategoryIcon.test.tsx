import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BADGES, CATEGORIES, CONFIRMATION_KINDS, PRACTICES, SUBTYPES } from "@mountain-live/core";
import { CategoryIcon, iconNameFor } from "./CategoryIcon";
import { FALLBACK_ICON, findLucideIcon, kebabToPascal, resolveLucideIcon, resolveLucideIconName } from "./icons";

/** Toutes les icônes déclarées dans la taxonomie, avec leur origine pour un message d'erreur lisible. */
function taxonomyIcons(): { origin: string; icon: string }[] {
  return [
    ...CATEGORIES.map((c) => ({ origin: `catégorie ${c.id}`, icon: c.icon })),
    ...SUBTYPES.map((s) => ({ origin: `sous-type ${s.id}`, icon: s.icon })),
    ...PRACTICES.map((p) => ({ origin: `pratique ${p.id}`, icon: p.icon })),
    ...Object.entries(BADGES).map(([id, b]) => ({ origin: `badge ${id}`, icon: b.icon })),
    ...CONFIRMATION_KINDS.map((k) => ({ origin: `confirmation ${k.id}`, icon: k.icon })),
  ];
}

describe("résolution des icônes lucide", () => {
  it("convertit le kebab-case en PascalCase", () => {
    expect(kebabToPascal("tree-pine")).toBe("TreePine");
    expect(kebabToPascal("loader-2")).toBe("Loader2");
    expect(kebabToPascal("map-pin")).toBe("MapPin");
    expect(kebabToPascal("Compass")).toBe("Compass");
  });

  it("résout chaque icône de la taxonomie sans repli « map-pin »", () => {
    const unresolved: string[] = [];
    for (const { origin, icon } of taxonomyIcons()) {
      const resolved = resolveLucideIconName(icon);
      const component = findLucideIcon(resolved);
      if (!component || (resolved === FALLBACK_ICON && icon !== FALLBACK_ICON)) unresolved.push(`${origin} → « ${icon} »`);
    }
    expect(unresolved, `Icônes non résolues :\n${unresolved.join("\n")}`).toEqual([]);
  });

  it("utilise le repli pour un nom inconnu", () => {
    expect(resolveLucideIconName("icone-inexistante")).toBe(FALLBACK_ICON);
    expect(resolveLucideIcon("icone-inexistante")).toBe(findLucideIcon("map-pin"));
    expect(resolveLucideIconName(null)).toBe(FALLBACK_ICON);
  });

  it("applique les alias (horse, anciens noms)", () => {
    expect(resolveLucideIconName("horse")).not.toBe(FALLBACK_ICON);
    expect(resolveLucideIconName("alert-triangle")).not.toBe(FALLBACK_ICON);
  });
});

describe("<CategoryIcon />", () => {
  it("rend chaque sous-type sous forme de SVG", () => {
    for (const s of SUBTYPES) {
      const { container, unmount } = render(<CategoryIcon subtype={s.id} size={20} />);
      const svg = container.querySelector("svg");
      expect(svg, `sous-type ${s.id}`).not.toBeNull();
      expect(svg?.getAttribute("width")).toBe("20");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("expose un libellé accessible quand `label` est fourni", () => {
    const { getByRole } = render(<CategoryIcon category="danger" label="Danger" />);
    expect(getByRole("img", { name: "Danger" })).toBeInTheDocument();
  });

  it("respecte la priorité name > subtype > category", () => {
    expect(iconNameFor({ name: "flag", subtype: "herd", category: "water" })).toBe("flag");
    expect(iconNameFor({ subtype: "herd", category: "water" })).toBe("beef");
    expect(iconNameFor({ category: "water" })).toBe("droplets");
    expect(iconNameFor({})).toBeUndefined();
  });
});
