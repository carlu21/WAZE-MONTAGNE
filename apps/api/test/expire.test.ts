import { describe, expect, it } from "vitest";
import type { Report } from "@mountain-live/core";
import { call, CORSICA_BBOX, registerUser, setup } from "./helpers";

const { app, sqlite, runExpirationPass } = await setup();

describe("Expiration automatique", () => {
  it("passe en « expiré » les signalements dont la date est dépassée et les retire de la carte", async () => {
    const user = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: user.token,
      body: { subtype: "boars", lat: 42.2372, lng: 9.0581 },
    });
    const id = created.body.report.id;
    const before = runExpirationPass();
    expect(before.expired).toBe(0);

    const past = new Date(Date.now() - 60_000).toISOString();
    sqlite.prepare("UPDATE reports SET expires_at = ? WHERE id = ?").run(past, id);
    const result = runExpirationPass();
    expect(result.expired).toBe(1);

    const row = sqlite.prepare("SELECT status FROM reports WHERE id = ?").get(id) as { status: string };
    expect(row.status).toBe("expired");
    const list = await call<{ reports: Report[] }>(app, "GET", `/reports?bbox=${CORSICA_BBOX}`);
    expect(list.body.reports.some((r) => r.id === id)).toBe(false);
    const detail = await call<{ report: Report }>(app, "GET", `/reports/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.report.status).toBe("expired");
    expect(detail.body.report.fade).toBe(0.35);
  });

  it("expire un signalement dont l'heure de fin (chasse) est passée", async () => {
    const user = await registerUser(app);
    const endsAt = new Date(Date.now() + 2 * 3600_000).toISOString();
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: user.token,
      body: { subtype: "battue", lat: 41.77, lng: 9.19, endsAt },
    });
    expect(created.status).toBe(201);
    expect(created.body.report.expiresAt).toBe(endsAt);
    const id = created.body.report.id;
    sqlite.prepare("UPDATE reports SET ends_at = ?, expires_at = ? WHERE id = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      new Date(Date.now() + 3600_000).toISOString(),
      id,
    );
    runExpirationPass();
    const row = sqlite.prepare("SELECT status FROM reports WHERE id = ?").get(id) as { status: string };
    expect(row.status).toBe("expired");
  });

  it("purge définitivement les signalements expirés depuis plus de 90 jours", async () => {
    const user = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: user.token,
      body: { subtype: "many_hikers", lat: 42.21, lng: 9.02 },
    });
    const id = created.body.report.id;
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
    sqlite.prepare("UPDATE reports SET status = 'expired', expires_at = ?, updated_at = ? WHERE id = ?").run(old, old, id);
    const result = runExpirationPass();
    expect(result.purgedReports).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM reports WHERE id = ?").get(id)).toEqual({ n: 0 });
  });
});
