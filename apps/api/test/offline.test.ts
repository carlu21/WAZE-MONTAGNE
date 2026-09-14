import { describe, expect, it } from "vitest";
import type { AreaSummary, AroundResponse, OfflineBundle, Report, SearchAreasResponse } from "@mountain-live/core";
import { call, registerUser, setup } from "./helpers";

const { app, sqlite, seedReference } = await setup();
seedReference();

describe("Hors connexion, explorer et autour de moi", () => {
  it("assemble un bundle hors connexion complet pour une bbox", async () => {
    const user = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: user.token,
      body: { subtype: "refuge", lat: 42.285, lng: 9.0728, description: "Refuge ouvert" },
    });
    expect(created.status).toBe(201);
    // La zone est déduite du lieu de référence le plus proche.
    expect(created.body.report.zone).toBeTruthy();

    const bundle = await call<OfflineBundle>(app, "GET", "/offline/bundle?bbox=8.9,42.15,9.25,42.4", { token: user.token });
    expect(bundle.status).toBe(200);
    expect(bundle.body.bbox).toEqual({ west: 8.9, south: 42.15, east: 9.25, north: 42.4 });
    expect(bundle.body.reports.some((r) => r.id === created.body.report.id)).toBe(true);
    expect(bundle.body.trails.length).toBeGreaterThan(0);
    expect(bundle.body.waterPoints.length).toBeGreaterThan(0);
    expect(bundle.body.areas.some((a) => a.name === "Corte")).toBe(true);
    expect(bundle.body.generatedAt).toBeTruthy();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM offline_zones WHERE user_id = ?").get(user.id)).toEqual({ n: 1 });

    const missing = await call<{ error: { code: string } }>(app, "GET", "/offline/bundle");
    expect(missing.status).toBe(400);
  });

  it("recherche des lieux sans tenir compte des accents ni de la casse", async () => {
    const res = await call<SearchAreasResponse>(app, "GET", "/areas/search?q=EVISA");
    expect(res.status).toBe(200);
    expect(res.body.areas[0]?.name).toBe("Évisa");
    const refuges = await call<SearchAreasResponse>(app, "GET", "/areas/search?q=refuge");
    expect(refuges.body.areas.length).toBeGreaterThan(5);
    expect(refuges.body.areas.length).toBeLessThanOrEqual(15);
    const none = await call<SearchAreasResponse>(app, "GET", "/areas/search?q=zzzz");
    expect(none.body.areas).toHaveLength(0);
  });

  it("renvoie la fiche d'un lieu et la vue « autour de moi » triée par distance", async () => {
    const user = await registerUser(app);
    await call(app, "POST", "/reports", { token: user.token, body: { subtype: "hunting", lat: 41.77, lng: 9.19, endsAt: new Date(Date.now() + 3600_000).toISOString() } });
    await call(app, "POST", "/reports", { token: user.token, body: { subtype: "access_restriction", lat: 41.79, lng: 9.22 } });

    const area = await call<AreaSummary>(app, "GET", "/areas/a_bavella");
    expect(area.status).toBe(200);
    expect(area.body.area.name).toBe("Bavella");
    expect(area.body.activities.some((r) => r.subtype === "hunting")).toBe(true);
    expect(area.body.restrictions.some((r) => r.subtype === "access_restriction")).toBe(true);
    expect(area.body.waterPoints.length).toBeGreaterThan(0);
    expect(area.body.crowdLevel).toBe("low");
    expect((await call(app, "GET", "/areas/inconnu")).status).toBe(404);

    const around = await call<AroundResponse>(app, "GET", "/around?lat=41.7953&lng=9.2233&radius=5000");
    expect(around.status).toBe(200);
    expect(around.body.items.length).toBeGreaterThanOrEqual(2);
    const distances = around.body.items.map((r) => r.distanceM ?? 0);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(around.body.waterPoints[0].distanceM).toBeLessThanOrEqual(around.body.waterPoints.at(-1)?.distanceM ?? 0);
    expect(around.body.waterPoints.every((w) => w.distanceM <= 5000)).toBe(true);
  });

  it("liste sentiers et points d'eau par bbox", async () => {
    const trails = await call<{ trails: { name: string }[] }>(app, "GET", "/trails?bbox=9.0,42.2,9.1,42.25");
    expect(trails.body.trails.some((t) => t.name.startsWith("Restonica"))).toBe(true);
    const water = await call<{ waterPoints: { name: string }[] }>(app, "GET", "/water-points?bbox=9.0,42.2,9.1,42.25");
    expect(water.body.waterPoints.some((w) => w.name === "Lac de Melo")).toBe(true);
  });
});
