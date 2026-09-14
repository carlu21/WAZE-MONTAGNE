import { describe, expect, it } from "vitest";
import { haversineM, SUBTYPE_BY_ID, type Report } from "@mountain-live/core";
import { call, CORSICA_BBOX, GROTELLE, registerUser, setup } from "./helpers";

const { app, sqlite } = await setup();

describe("Signalements", () => {
  it("crée un signalement, déduit la catégorie et borne la durée de vie", async () => {
    const user = await registerUser(app);
    const res = await call<{ report: Report }>(app, "POST", "/reports", {
      token: user.token,
      body: { subtype: "fallen_tree", lat: GROTELLE.lat, lng: GROTELLE.lng, dangerLevel: "moderate", ttlMinutes: 365 * 24 * 60, description: "Pin en travers" },
    });
    expect(res.status).toBe(201);
    const r = res.body.report;
    expect(r.category).toBe("danger");
    expect(r.source).toBe("community");
    expect(r.status).toBe("active");
    expect(r.authorPseudo).toBe(user.pseudo);
    expect(r.blurred).toBe(false);
    expect(r.fade).toBe(1);
    const ttlMin = (Date.parse(r.expiresAt) - Date.parse(r.createdAt)) / 60_000;
    expect(Math.round(ttlMin)).toBe(SUBTYPE_BY_ID.fallen_tree.maxTtlMin);
  });

  it("est idempotent sur clientId (synchronisation hors connexion)", async () => {
    const user = await registerUser(app);
    const body = { subtype: "herd", lat: 42.42, lng: 8.95, clientId: "local-42" };
    const first = await call<{ report: Report }>(app, "POST", "/reports", { token: user.token, body });
    const second = await call<{ report: Report }>(app, "POST", "/reports", { token: user.token, body });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.report.id).toBe(first.body.report.id);
  });

  it("floute automatiquement les espèces sensibles sans jamais exposer la position exacte", async () => {
    const user = await registerUser(app);
    const exact = { lat: 42.4012, lng: 8.9152 };
    const res = await call<{ report: Report }>(app, "POST", "/reports", {
      token: user.token,
      body: { subtype: "wildlife", ...exact, description: "Mouflons" },
    });
    expect(res.status).toBe(201);
    const r = res.body.report;
    expect(r.blurred).toBe(true);
    expect(r.lat === exact.lat && r.lng === exact.lng).toBe(false);
    const d = haversineM(exact, { lat: r.lat, lng: r.lng });
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(600);

    // La base conserve la position exacte, la fiche détaillée et la liste servent la position floutée.
    const row = sqlite.prepare("SELECT lat, lng, display_lat, display_lng FROM reports WHERE id = ?").get(r.id) as { lat: number; lng: number; display_lat: number; display_lng: number };
    expect(row.lat).toBe(exact.lat);
    expect(row.display_lat).toBe(r.lat);
    const detail = await call<{ report: Report }>(app, "GET", `/reports/${r.id}`);
    expect(detail.body.report.lat).toBe(r.lat);
    expect(detail.body.report.lng).toBe(r.lng);
    const list = await call<{ reports: Report[] }>(app, "GET", `/reports?bbox=${CORSICA_BBOX}`);
    const listed = list.body.reports.find((x) => x.id === r.id);
    expect(listed?.lat).toBe(r.lat);
    expect(JSON.stringify(listed)).not.toContain(String(exact.lat));
  });

  it("liste par bbox, catégorie et source, avec distance et tri par priorité", async () => {
    const user = await registerUser(app);
    await call(app, "POST", "/reports", { token: user.token, body: { subtype: "rockfall", lat: 41.80, lng: 9.21, dangerLevel: "high" } });
    await call(app, "POST", "/reports", { token: user.token, body: { subtype: "many_hikers", lat: 41.801, lng: 9.211 } });
    await call(app, "POST", "/reports", { token: user.token, body: { subtype: "spring", lat: 45.0, lng: 6.0 } }); // hors bbox

    const bavella = await call<{ reports: Report[]; officialAlerts: unknown[]; generatedAt: string }>(
      app,
      "GET",
      "/reports?bbox=9.1,41.7,9.3,41.9&lat=41.8&lng=9.2",
    );
    expect(bavella.status).toBe(200);
    expect(bavella.body.reports.map((r) => r.subtype)).toEqual(["rockfall", "many_hikers"]);
    expect(bavella.body.reports[0].distanceM).toBeTypeOf("number");
    expect(bavella.body.reports.some((r) => r.subtype === "spring")).toBe(false);
    expect(Array.isArray(bavella.body.officialAlerts)).toBe(true);

    const onlyCrowd = await call<{ reports: Report[] }>(app, "GET", "/reports?bbox=9.1,41.7,9.3,41.9&categories=crowd");
    expect(onlyCrowd.body.reports.map((r) => r.category)).toEqual(["crowd"]);

    const official = await call<{ reports: Report[] }>(app, "GET", "/reports?bbox=9.1,41.7,9.3,41.9&source=official");
    expect(official.body.reports).toHaveLength(0);

    const badBbox = await call<{ error: { code: string } }>(app, "GET", "/reports?bbox=abc");
    expect(badBbox.status).toBe(400);
    expect(badBbox.body.error.code).toBe("validation_error");
  });

  it("renvoie le détail avec commentaires, votes et auteur public (sans e-mail)", async () => {
    const author = await registerUser(app);
    const other = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: author.token,
      body: { subtype: "guard_dogs", lat: 42.41, lng: 8.95, dangerLevel: "moderate" },
    });
    const id = created.body.report.id;
    const comment = await call<{ comment: { body: string; authorPseudo: string } }>(app, "POST", `/reports/${id}/comments`, {
      token: other.token,
      body: { body: "Vus ce matin, restez calmes." },
    });
    expect(comment.status).toBe(201);
    expect(comment.body.comment.authorPseudo).toBe(other.pseudo);

    const detail = await call<{ report: Report; comments: unknown[]; confirmations: unknown[]; author: Record<string, unknown> | null }>(
      app,
      "GET",
      `/reports/${id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.author?.pseudo).toBe(author.pseudo);
    expect(JSON.stringify(detail.body)).not.toContain(author.email);

    const missing = await call(app, "GET", "/reports/inexistant");
    expect(missing.status).toBe(404);
  });

  it("n'autorise la modification qu'à l'auteur (ou un modérateur) et date la résolution", async () => {
    const author = await registerUser(app);
    const other = await registerUser(app);
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: author.token,
      body: { subtype: "obstacle", lat: 42.13, lng: 9.12 },
    });
    const id = created.body.report.id;
    const forbidden = await call(app, "PATCH", `/reports/${id}`, { token: other.token, body: { description: "x" } });
    expect(forbidden.status).toBe(403);

    const resolved = await call<{ report: Report }>(app, "PATCH", `/reports/${id}`, { token: author.token, body: { status: "resolved" } });
    expect(resolved.status).toBe(200);
    expect(resolved.body.report.status).toBe("resolved");
    const row = sqlite.prepare("SELECT resolved_at FROM reports WHERE id = ?").get(id) as { resolved_at: string | null };
    expect(row.resolved_at).toBeTruthy();

    const list = await call<{ reports: Report[] }>(app, "GET", `/reports?bbox=${CORSICA_BBOX}`);
    expect(list.body.reports.some((r) => r.id === id)).toBe(false);
  });

  it("refuse la création sans authentification et valide le sous-type", async () => {
    const anon = await call(app, "POST", "/reports", { body: { subtype: "fallen_tree", lat: 42, lng: 9 } });
    expect(anon.status).toBe(401);
    const user = await registerUser(app);
    const bad = await call<{ error: { code: string } }>(app, "POST", "/reports", { token: user.token, body: { subtype: "licorne", lat: 42, lng: 9 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("validation_error");
  });

  it("refuse une heure de fin déjà passée ou antérieure au début", async () => {
    const user = await registerUser(app);
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const gone = await call<{ error: { code: string; details: { path: string }[] } }>(app, "POST", "/reports", {
      token: user.token,
      body: { subtype: "battue", lat: 42.3, lng: 9.15, endsAt: past },
    });
    expect(gone.status).toBe(400);
    expect(gone.body.error.code).toBe("validation_error");
    expect(gone.body.error.details[0].path).toBe("endsAt");

    const start = new Date(Date.now() + 7_200_000).toISOString();
    const end = new Date(Date.now() + 3_600_000).toISOString();
    const inverted = await call<{ error: { code: string } }>(app, "POST", "/reports", {
      token: user.token,
      body: { subtype: "battue", lat: 42.3, lng: 9.15, startsAt: start, endsAt: end },
    });
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe("validation_error");
  });

  it("n'inclut les signalements inactifs (includeInactive) que pour les modérateurs", async () => {
    const author = await registerUser(app);
    const moderator = await registerUser(app, { role: "moderator" });
    const created = await call<{ report: Report }>(app, "POST", "/reports", {
      token: author.token,
      body: { subtype: "snow", lat: 42.9, lng: 9.4, dangerLevel: "low" },
    });
    const id = created.body.report.id;
    await call(app, "PATCH", `/reports/${id}`, { token: author.token, body: { status: "resolved" } });

    const query = "/reports?bbox=9.3,42.8,9.5,43.0&includeInactive=1";
    const anonymous = await call<{ reports: Report[] }>(app, "GET", query);
    expect(anonymous.body.reports.some((r) => r.id === id)).toBe(false);
    const asAuthor = await call<{ reports: Report[] }>(app, "GET", query, { token: author.token });
    expect(asAuthor.body.reports.some((r) => r.id === id)).toBe(false);
    const asModerator = await call<{ reports: Report[] }>(app, "GET", query, { token: moderator.token });
    expect(asModerator.body.reports.find((r) => r.id === id)?.status).toBe("resolved");
    // La chaîne « false » ne doit pas activer l'option.
    const off = await call<{ reports: Report[] }>(app, "GET", "/reports?bbox=9.3,42.8,9.5,43.0&includeInactive=false", { token: moderator.token });
    expect(off.body.reports.some((r) => r.id === id)).toBe(false);
  });
});
