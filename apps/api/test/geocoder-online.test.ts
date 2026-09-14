import { afterEach, describe, expect, it, vi } from "vitest";
import "./helpers"; // base SQLite temporaire (DATABASE_PATH) avant tout import de la base
import { config } from "../src/config";
import { geocodeOnline } from "../src/services/geocoder";

const poiResponse = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [9.0578, 42.2288] }, properties: { toponym: "Bergeries de Grotelle", category: ["lieu-dit non habité"], city: ["Corte"], postcode: ["20250"] } },
    { type: "Feature", geometry: { type: "Point", coordinates: [9.1, 42.2] }, properties: { toponym: "Rue de Grotelle", category: ["rue"], type: "street" } },
  ],
};

describe("géocodeur en ligne (fetch simulé)", () => {
  const originalFetch = globalThis.fetch;
  const originalEnabled = config.geocoder.enabled;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    config.geocoder.enabled = originalEnabled;
  });

  it("interroge les index poi et address avec la requête et la position, puis convertit les entités", async () => {
    config.geocoder.enabled = true;
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      const body = url.includes("index=poi") ? poiResponse : { type: "FeatureCollection", features: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const places = await geocodeOnline("Grotelle", { lat: 42.3, lng: 9.15 });
    expect(calls).toHaveLength(2);
    expect(calls.some((u) => u.includes("index=poi") && u.includes("q=Grotelle") && u.includes("lat=42.3") && u.includes("lon=9.15"))).toBe(true);
    expect(calls.some((u) => u.includes("index=address") && u.includes("type=municipality"))).toBe(true);
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe("Bergeries de Grotelle");
    expect(places[0].type).toBe("hamlet");
    expect(places[0].id).toMatch(/^g_[0-9a-f]{8}$/);
  });

  it("ne lève jamais d'exception quand le service est injoignable", async () => {
    config.geocoder.enabled = true;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(geocodeOnline("Grotelle")).resolves.toEqual([]);
  });

  it("reste inactif quand il est désactivé", async () => {
    config.geocoder.enabled = false;
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await geocodeOnline("Grotelle")).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
