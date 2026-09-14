import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORIES, SUBTYPES } from "@mountain-live/core";
import {
  CATEGORY_COLORS,
  CLUSTER_CIRCLE_PAINT,
  allMarkerSpecs,
  buildMarkerSvg,
  categoryMarkerImageId,
  loadMarkerImages,
  markerImageId,
  markerVariantFor,
} from "./markers";

describe("buildMarkerSvg", () => {
  it("produit un SVG avec la couleur de fond et l'icône lucide en blanc", () => {
    const svg = buildMarkerSvg({ icon: "tree-pine", color: "#C8341F", size: 40 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('fill="#C8341F"');
    expect(svg).toContain('width="40"');
    expect(svg).toContain('height="48"');
    expect(svg).toContain("lucide-tree-pine");
    // L'icône lucide imbriquée est tracée en blanc et positionnée dans la pastille.
    expect(svg).toContain('stroke="#FFFFFF" stroke-width="2.4"');
    expect(svg).toContain('<svg x="10" y="9"');
  });

  it("gère les variantes officiel, sélectionné, estompé et disque", () => {
    expect(buildMarkerSvg({ icon: "flame", color: "#C8341F", official: true })).toContain("#C9A227");
    expect(buildMarkerSvg({ icon: "flame", color: "#C8341F", selected: true })).toContain("#14351B");
    expect(buildMarkerSvg({ icon: "flame", color: "#C8341F", faded: true })).toContain('opacity="0.45"');
    const disc = buildMarkerSvg({ icon: "flame", color: "#C8341F", shape: "disc", size: 30 });
    expect(disc).toContain("<circle");
    expect(disc).toContain('height="30"');
  });

  it("échappe la couleur pour éviter toute injection d'attribut", () => {
    const svg = buildMarkerSvg({ icon: "flame", color: '"><script>' });
    expect(svg).not.toContain("<script>");
  });
});

describe("identifiants et constantes", () => {
  it("génère un identifiant unique par sous-type et variante", () => {
    const ids = new Set(allMarkerSpecs().map((s) => s.id));
    expect(ids.size).toBe(SUBTYPES.length * 3 + CATEGORIES.length * 3);
    expect(markerImageId("herd")).toBe("ml-marker-herd-default");
    expect(markerImageId("herd", "selected")).toBe("ml-marker-herd-selected");
    expect(categoryMarkerImageId("danger", "official")).toBe("ml-marker-cat-danger-official");
  });

  it("reprend les couleurs de la taxonomie", () => {
    for (const c of CATEGORIES) expect(CATEGORY_COLORS[c.id]).toBe(c.color);
    expect(CLUSTER_CIRCLE_PAINT["circle-stroke-width"]).toBe(3);
  });

  it("choisit la variante selon la source et la sélection", () => {
    expect(markerVariantFor("official")).toBe("official");
    expect(markerVariantFor("partner")).toBe("default");
    expect(markerVariantFor("community", true)).toBe("selected");
  });
});

describe("loadMarkerImages", () => {
  const OriginalImage = globalThis.Image;
  afterEach(() => {
    globalThis.Image = OriginalImage;
  });

  it("enregistre chaque image une seule fois en pixelRatio 2", async () => {
    class FakeImage {
      width = 0;
      height = 0;
      decoding = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;
    const registered = new Map<string, unknown>();
    const map = {
      hasImage: vi.fn((id: string) => registered.has(id)),
      addImage: vi.fn((id: string, img: FakeImage, opts: { pixelRatio: number }) => {
        registered.set(id, { img, opts });
      }),
    };
    await loadMarkerImages(map as never);
    expect(registered.size).toBe(SUBTYPES.length * 3 + CATEGORIES.length * 3);
    const first = registered.get(markerImageId("rockfall")) as { img: FakeImage; opts: { pixelRatio: number } };
    expect(first.opts.pixelRatio).toBe(2);
    expect(first.img.width).toBe(72);
    expect(first.img.height).toBe(86);
    const calls = map.addImage.mock.calls.length;
    await loadMarkerImages(map as never);
    expect(map.addImage.mock.calls.length).toBe(calls);
  });
});
