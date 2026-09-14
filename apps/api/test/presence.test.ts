import { describe, expect, it } from "vitest";
import type { PresenceResponse } from "@mountain-live/core";
import { call, registerUser, setup } from "./helpers";

const { app, sqlite, runExpirationPass } = await setup();

describe("Présence agrégée", () => {
  it("agrège les pings par cellule sans jamais stocker d'identifiant ni de position exacte", async () => {
    const user = await registerUser(app);
    const exact = { lat: 42.22613, lng: 9.04537 };
    for (let i = 0; i < 3; i++) {
      const res = await call(app, "POST", "/presence", { token: user.token, body: exact });
      expect(res.status).toBe(204);
    }
    const anon = await call(app, "POST", "/presence", { body: { lat: 42.2262, lng: 9.0455 } });
    expect(anon.status).toBe(204);

    const columns = (sqlite.prepare("PRAGMA table_info(presence_pings)").all() as { name: string }[]).map((c) => c.name);
    expect(columns.sort()).toEqual(["bucket_start", "cell", "count"]);
    const rows = sqlite.prepare("SELECT cell, count FROM presence_pings").all() as { cell: string; count: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].cell).toBe("42.23:9.05");
    expect(rows[0].count).toBe(4);
    expect(JSON.stringify(rows)).not.toContain(user.id);
    expect(JSON.stringify(rows)).not.toContain("42.22613");

    const res = await call<PresenceResponse>(app, "GET", "/presence?bbox=9.0,42.2,9.1,42.3");
    expect(res.status).toBe(200);
    expect(res.body.cells).toHaveLength(1);
    expect(res.body.cells[0]).toEqual({ cell: "42.23:9.05", lat: 42.23, lng: 9.05, count: 4 });
    expect(res.body.activeUsersEstimate).toBe(4);
    expect(JSON.stringify(res.body)).not.toContain(user.id);

    const elsewhere = await call<PresenceResponse>(app, "GET", "/presence?bbox=6.0,44.0,7.0,45.0");
    expect(elsewhere.body.cells).toHaveLength(0);
  });

  it("purge les tranches de plus de 30 minutes", async () => {
    const stale = new Date(Date.now() - 45 * 60_000).toISOString();
    sqlite.prepare("INSERT INTO presence_pings (cell, bucket_start, count) VALUES ('41.80:9.22', ?, 7)").run(stale);
    const before = await call<PresenceResponse>(app, "GET", "/presence?bbox=9.1,41.7,9.3,41.9");
    expect(before.body.cells).toHaveLength(0);
    const result = runExpirationPass();
    expect(result.purgedPresence).toBeGreaterThanOrEqual(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM presence_pings WHERE cell = '41.80:9.22'").get()).toEqual({ n: 0 });
  });

  it("valide les coordonnées", async () => {
    const res = await call<{ error: { code: string } }>(app, "POST", "/presence", { body: { lat: 200, lng: 9 } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });
});
