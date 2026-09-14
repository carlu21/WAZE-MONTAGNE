import { describe, expect, it } from "vitest";
import type { Report } from "@mountain-live/core";
import { call, registerUser, setup } from "./helpers";

const { app, sqlite } = await setup();

describe("Suppression de compte (RGPD)", () => {
  it("anonymise le compte, conserve les signalements détachés et supprime les données annexes", async () => {
    const user = await registerUser(app);
    const other = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: user.token,
      body: { subtype: "spring_dry", lat: 42.2254, lng: 9.0441, description: "Source tarie" },
    });
    const reportId = created.body.report.id;
    await call(app, "POST", `/reports/${reportId}/comments`, { token: user.token, body: { body: "Je repasse demain." } });
    await call(app, "POST", "/presence", { token: user.token, body: { lat: 42.2254, lng: 9.0441 } });
    // Une notification existe grâce à une confirmation d'un autre utilisateur.
    await call(app, "POST", `/reports/${reportId}/confirm`, { token: other.token, body: { kind: "still_present" } });
    expect((await call<{ unreadCount: number }>(app, "GET", "/notifications", { token: user.token })).body.unreadCount).toBe(1);

    const del = await call(app, "DELETE", "/users/me", { token: user.token });
    expect(del.status).toBe(204);

    // Le jeton ne fonctionne plus, la connexion est impossible, le profil public disparaît.
    expect((await call(app, "GET", "/auth/me", { token: user.token })).status).toBe(401);
    const login = await call(app, "POST", "/auth/login", { body: { email: user.email, password: "motdepasse123" } });
    expect(login.status).toBe(401);
    expect((await call(app, "GET", `/users/${user.id}`)).status).toBe(404);

    const row = sqlite.prepare("SELECT email, pseudo, password_hash, practices, deleted_at FROM users WHERE id = ?").get(user.id) as {
      email: string;
      pseudo: string;
      password_hash: string;
      practices: string;
      deleted_at: string | null;
    };
    expect(row.email).not.toBe(user.email);
    expect(row.email).toContain("deleted+");
    expect(row.pseudo).toBe("Utilisateur supprimé");
    expect(row.password_hash).toBe("");
    expect(row.deleted_at).toBeTruthy();

    // Le signalement reste visible mais anonymisé.
    const detail = await call<{ report: Report; comments: { authorPseudo: string; userId: string }[]; author: unknown }>(app, "GET", `/reports/${reportId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.report.userId).toBeNull();
    expect(detail.body.report.authorPseudo).toBeNull();
    expect(detail.body.report.description).toBe("Source tarie");
    expect(detail.body.author).toBeNull();
    expect(detail.body.comments[0].authorPseudo).toBe("Utilisateur supprimé");
    expect(JSON.stringify(detail.body)).not.toContain(user.pseudo);

    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?").get(user.id)).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM user_preferences WHERE user_id = ?").get(user.id)).toEqual({ n: 0 });

    // Un nouveau compte peut réutiliser le pseudo libéré ; deux comptes supprimés peuvent coexister.
    const second = await registerUser(app);
    expect((await call(app, "DELETE", "/users/me", { token: second.token })).status).toBe(204);
    const reuse = await call(app, "POST", "/auth/register", {
      body: { email: `reuse-${Date.now()}@exemple.fr`, password: "motdepasse123", pseudo: user.pseudo, consent: true },
    });
    expect(reuse.status).toBe(201);
  });
});
