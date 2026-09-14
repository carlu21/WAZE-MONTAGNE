import { describe, expect, it } from "vitest";
import { BASEMAPS, BASEMAP_ORDER, buildBasemapStyle } from "./basemaps";

describe("fonds de carte", () => {
  it("propose cinq fonds dont deux vues aériennes hybrides", () => {
    expect(BASEMAP_ORDER).toEqual(["topo", "satellite", "ortho", "classic", "relief"]);
    expect(BASEMAPS.satellite.overlays?.map((o) => o.id)).toEqual(["roads", "places"]);
    expect(BASEMAPS.ortho.tiles[0]).toContain("data.geopf.fr/wmts");
  });
  it("construit un style avec les couches routes et noms par-dessus les images", () => {
    const style = buildBasemapStyle("satellite");
    const ids = style.layers.map((l) => l.id);
    expect(ids).toEqual(["background", "basemap", "basemap-roads", "basemap-places"]);
    expect(Object.keys(style.sources)).toContain("basemap-places");
  });
  it("ajoute l'ombrage au fond relief seulement", () => {
    expect(buildBasemapStyle("relief").layers.some((l) => l.type === "hillshade")).toBe(true);
    expect(buildBasemapStyle("topo").layers.some((l) => l.type === "hillshade")).toBe(false);
  });
});
