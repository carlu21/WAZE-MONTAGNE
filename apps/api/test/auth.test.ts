import { describe, expect, it } from "vitest";
import { call, registerUser, setup } from "./helpers";

const { app } = await setup();

describe("Authentification", () => {
  it("inscrit un utilisateur, renvoie un jeton et des préférences adaptées à sa pratique", async () => {
    const res = await call<{ token: string; user: Record<string, unknown> }>(app, "POST", "/auth/register", {
      body: {
        email: "Nouvelle@Exemple.FR",
        password: "motdepasse123",
        pseudo: "Nouvelle Rando",
        practices: ["rider"],
        consent: true,
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.email).toBe("nouvelle@exemple.fr");
    expect(res.body.user.role).toBe("user");
    expect(res.body.user.reliabilityLevel).toBe(1);
    expect((res.body.user.preferences as { filters: string[] }).filters).toEqual(["animals", "activity", "path", "water", "danger"]);
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("refuse une inscription invalide avec le détail des champs", async () => {
    const res = await call<{ error: { code: string; details: { path: string }[] } }>(app, "POST", "/auth/register", {
      body: { email: "pas-un-email", password: "court", pseudo: "x", consent: false },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    const paths = res.body.error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["email", "password", "pseudo", "consent"]));
  });

  it("refuse un e-mail ou un pseudo déjà utilisés", async () => {
    const user = await registerUser(app);
    const dup = await call<{ error: { code: string } }>(app, "POST", "/auth/register", {
      body: { email: user.email, password: "motdepasse123", pseudo: "Autre", consent: true },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("email_taken");
    const dupPseudo = await call<{ error: { code: string } }>(app, "POST", "/auth/register", {
      body: { email: `autre-${Date.now()}@exemple.fr`, password: "motdepasse123", pseudo: user.pseudo.toUpperCase(), consent: true },
    });
    expect(dupPseudo.status).toBe(409);
    expect(dupPseudo.body.error.code).toBe("pseudo_taken");
  });

  it("connecte un utilisateur et expose /auth/me", async () => {
    const user = await registerUser(app);
    const login = await call<{ token: string; user: { id: string } }>(app, "POST", "/auth/login", {
      body: { email: user.email, password: "motdepasse123" },
    });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(user.id);

    const me = await call<{ user: { id: string; email: string } }>(app, "GET", "/auth/me", { token: login.body.token });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);
  });

  it("refuse un mauvais mot de passe et une requête sans jeton", async () => {
    const user = await registerUser(app);
    const bad = await call<{ error: { code: string } }>(app, "POST", "/auth/login", {
      body: { email: user.email, password: "mauvais-mdp" },
    });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("invalid_credentials");

    const anon = await call<{ error: { code: string } }>(app, "GET", "/auth/me");
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("unauthorized");

    const forged = await call<{ error: { code: string } }>(app, "GET", "/auth/me", { token: "abc.def.ghi" });
    expect(forged.status).toBe(401);
  });

  it("met à jour le profil et les préférences", async () => {
    const user = await registerUser(app);
    const patch = await call<{ user: { pseudo: string; region: string } }>(app, "PATCH", "/users/me", {
      token: user.token,
      body: { pseudo: "Pseudo Modifié", region: "Corse" },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.user.pseudo).toBe("Pseudo Modifié");

    const prefs = await call<{ user: { preferences: { basemap: string; alerts: { radiusM: number } } } }>(
      app,
      "PUT",
      "/users/me/preferences",
      {
        token: user.token,
        body: {
          filters: ["danger", "water"],
          showOfficialOnly: false,
          basemap: "satellite",
          theme: "dark",
          alerts: { enabled: true, radiusM: 800, categories: ["danger"] },
          notifications: { new_battue_nearby: false },
          aroundRadiusM: 2000,
        },
      },
    );
    expect(prefs.status).toBe(200);
    expect(prefs.body.user.preferences.basemap).toBe("satellite");
    expect(prefs.body.user.preferences.alerts.radiusM).toBe(800);
  });
});
