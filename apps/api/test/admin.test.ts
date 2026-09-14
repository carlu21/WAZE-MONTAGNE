import { describe, expect, it } from "vitest";
import type { AdminStats, ContentFlag, Report } from "@mountain-live/core";
import { call, registerUser, setup } from "./helpers";

const { app, sqlite } = await setup();

describe("Administration et modération", () => {
  it("refuse l'accès à un simple utilisateur (403) et à un anonyme (401)", async () => {
    const user = await registerUser(app);
    const forbidden = await call<{ error: { code: string } }>(app, "GET", "/admin/stats", { token: user.token });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("forbidden");
    const anon = await call(app, "GET", "/admin/stats");
    expect(anon.status).toBe(401);
    const pro = await call(app, "GET", "/pro/dashboard", { token: user.token });
    expect(pro.status).toBe(403);
  });

  it("expose les statistiques, la liste paginée et la modification d'un signalement", async () => {
    const admin = await registerUser(app, { role: "admin" });
    const author = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: author.token,
      body: { subtype: "fallen_tree", lat: 42.23, lng: 9.05, dangerLevel: "low" },
    });
    const id = created.body.report.id;

    const stats = await call<AdminStats>(app, "GET", "/admin/stats", { token: admin.token });
    expect(stats.status).toBe(200);
    expect(stats.body.reportsTotal).toBeGreaterThanOrEqual(1);
    expect(stats.body.reportsByCategory.danger).toBeGreaterThanOrEqual(1);
    expect(stats.body.usersTotal).toBeGreaterThanOrEqual(2);

    const list = await call<{ reports: Report[]; total: number }>(app, "GET", "/admin/reports?category=danger", { token: admin.token });
    expect(list.status).toBe(200);
    expect(list.body.reports.some((r) => r.id === id)).toBe(true);
    expect(list.body.total).toBeGreaterThanOrEqual(1);

    const patched = await call<{ report: Report }>(app, "PATCH", `/admin/reports/${id}`, {
      token: admin.token,
      body: { subtype: "obstacle", source: "partner" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.report.category).toBe("path");
    expect(patched.body.report.source).toBe("partner");

    const del = await call(app, "DELETE", `/admin/reports/${id}`, { token: admin.token });
    expect(del.status).toBe(204);
    const row = sqlite.prepare("SELECT status, deleted_at FROM reports WHERE id = ?").get(id) as { status: string; deleted_at: string | null };
    expect(row.status).toBe("deleted");
    expect(row.deleted_at).toBeTruthy();
    const gone = await call(app, "GET", `/reports/${id}`);
    expect(gone.status).toBe(404);
  });

  it("traite les signalements de contenu : trois flags → contesté, action de suspension", async () => {
    const moderator = await registerUser(app, { role: "moderator" });
    const author = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: author.token,
      body: { subtype: "fire", lat: 41.78, lng: 9.2, dangerLevel: "critical" },
    });
    const id = created.body.report.id;
    const flaggers = await Promise.all([registerUser(app), registerUser(app), registerUser(app)]);
    for (const f of flaggers) {
      const res = await call<{ flag: ContentFlag }>(app, "POST", "/flags", { token: f.token, body: { reportId: id, reason: "false_info" } });
      expect(res.status).toBe(201);
    }
    const duplicate = await call(app, "POST", "/flags", { token: flaggers[0].token, body: { reportId: id, reason: "spam" } });
    expect(duplicate.status).toBe(200);
    const disputed = await call<{ report: Report }>(app, "GET", `/reports/${id}`);
    expect(disputed.body.report.status).toBe("disputed");

    const flags = await call<{ flags: (ContentFlag & { report: Report | null })[]; total: number }>(app, "GET", "/admin/flags?status=open", { token: moderator.token });
    expect(flags.status).toBe(200);
    expect(flags.body.total).toBe(3);
    expect(flags.body.flags[0].report?.id).toBe(id);

    const resolved = await call<{ flag: ContentFlag }>(app, "PATCH", `/admin/flags/${flags.body.flags[0].id}`, {
      token: moderator.token,
      body: { status: "resolved", action: "suspend_author", resolutionNote: "Fausse alerte incendie répétée" },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.flag.status).toBe("resolved");
    expect(resolved.body.flag.resolvedBy).toBe(moderator.id);
    const suspended = await call<{ error: { code: string } }>(app, "GET", "/auth/me", { token: author.token });
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.code).toBe("suspended");

    const lifted = await call<{ user: { suspendedUntil: string | null } }>(app, "POST", `/admin/users/${author.id}/suspend`, {
      token: moderator.token,
      body: { hours: 0 },
    });
    expect(lifted.status).toBe(200);
    expect(lifted.body.user.suspendedUntil).toBeNull();
    expect((await call(app, "GET", "/auth/me", { token: author.token })).status).toBe(200);
  });

  it("gère les utilisateurs (recherche sans hash) et les alertes officielles", async () => {
    const admin = await registerUser(app, { role: "admin" });
    const target = await registerUser(app, { pseudo: `Cible-${Date.now()}` });
    const users = await call<{ users: Record<string, unknown>[]; total: number }>(app, "GET", `/admin/users?q=${encodeURIComponent(target.pseudo)}`, { token: admin.token });
    expect(users.status).toBe(200);
    expect(users.body.total).toBe(1);
    expect(users.body.users[0].email).toBe(target.email);
    expect(JSON.stringify(users.body)).not.toContain("scrypt$");

    const alert = await call<{ officialAlert: { id: string; centroidLat: number } }>(app, "POST", "/admin/alerts", {
      token: admin.token,
      body: {
        organisation: "Préfecture de la Corse-du-Sud",
        title: "Risque incendie très sévère",
        body: "Accès au massif réglementé.",
        category: "danger",
        severity: "critical",
        geometry: { type: "Polygon", coordinates: [[[9.17, 41.76], [9.27, 41.76], [9.27, 41.83], [9.17, 41.76]]] },
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(alert.status).toBe(201);
    expect(alert.body.officialAlert.centroidLat).toBeCloseTo(41.78, 1);
    const listed = await call<{ officialAlerts: { id: string }[] }>(app, "GET", "/alerts/official?bbox=9.1,41.7,9.3,41.9");
    expect(listed.body.officialAlerts.some((a) => a.id === alert.body.officialAlert.id)).toBe(true);
    const del = await call(app, "DELETE", `/admin/alerts/${alert.body.officialAlert.id}`, { token: admin.token });
    expect(del.status).toBe(204);
    const after = await call<{ officialAlerts: { id: string }[] }>(app, "GET", "/alerts/official?bbox=9.1,41.7,9.3,41.9");
    expect(after.body.officialAlerts.some((a) => a.id === alert.body.officialAlert.id)).toBe(false);
  });

  it("ouvre le tableau de bord professionnel aux comptes officiels", async () => {
    const official = await registerUser(app, { role: "official" });
    await call(app, "POST", "/reports", { token: official.token, body: { subtype: "path_closed", lat: 42.27, lng: 9.11 } });
    const dash = await call<{ reportsTotal: number; byCategory: Record<string, number>; timeline: unknown[]; period: { from: string; to: string } }>(
      app,
      "GET",
      "/pro/dashboard",
      { token: official.token },
    );
    expect(dash.status).toBe(200);
    expect(dash.body.reportsTotal).toBeGreaterThanOrEqual(1);
    expect(dash.body.byCategory.path).toBeGreaterThanOrEqual(1);
    expect(dash.body.timeline.length).toBeGreaterThanOrEqual(30);
  });
});
