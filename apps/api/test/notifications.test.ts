import { describe, expect, it } from "vitest";
import type { Notification, Report } from "@mountain-live/core";
import { call, registerUser, setup } from "./helpers";

const { app } = await setup();

describe("Notifications", () => {
  it("liste, marque comme lue (une puis toutes) et refuse la notification d'un autre compte", async () => {
    const author = await registerUser(app);
    const voter = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: author.token,
      body: { subtype: "herd", lat: 42.35, lng: 9.1 },
    });
    const id = created.body.report.id;
    await call(app, "POST", `/reports/${id}/confirm`, { token: voter.token, body: { kind: "still_present" } });

    const list = await call<{ notifications: Notification[]; unreadCount: number }>(app, "GET", "/notifications", { token: author.token });
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBe(1);
    const notif = list.body.notifications[0];
    expect(notif.type).toBe("report_confirmed");
    expect(notif.reportId).toBe(id);
    expect(notif.readAt).toBeNull();

    // Un autre compte ne peut ni la voir ni la marquer comme lue.
    expect((await call(app, "POST", `/notifications/${notif.id}/read`, { token: voter.token })).status).toBe(404);
    expect((await call(app, "POST", `/notifications/${notif.id}/read`, { token: author.token })).status).toBe(204);
    const after = await call<{ notifications: Notification[]; unreadCount: number }>(app, "GET", "/notifications", { token: author.token });
    expect(after.body.unreadCount).toBe(0);
    expect(after.body.notifications[0].readAt).toBeTruthy();

    expect((await call(app, "POST", "/notifications/read-all", { token: author.token })).status).toBe(204);
    expect((await call(app, "GET", "/notifications")).status).toBe(401);
  });

  it("respecte les préférences : un type désactivé n'est plus envoyé", async () => {
    const author = await registerUser(app);
    const voter = await registerUser(app);
    const me = await call<{ user: { preferences: Record<string, unknown> } }>(app, "GET", "/auth/me", { token: author.token });
    const prefs = me.body.user.preferences as { notifications: Record<string, boolean> };
    const updated = await call(app, "PUT", "/users/me/preferences", {
      token: author.token,
      body: { ...prefs, notifications: { ...prefs.notifications, report_confirmed: false } },
    });
    expect(updated.status).toBe(200);

    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: author.token,
      body: { subtype: "cattle", lat: 42.36, lng: 9.11 },
    });
    await call(app, "POST", `/reports/${created.body.report.id}/confirm`, { token: voter.token, body: { kind: "still_present" } });
    const list = await call<{ unreadCount: number }>(app, "GET", "/notifications", { token: author.token });
    expect(list.body.unreadCount).toBe(0);
  });
});
