import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { loginSchema, registerSchema, type AuthResponse } from "@mountain-live/core";
import { config } from "../config";
import { db } from "../db/client";
import { users, type UserRow } from "../db/schema";
import { issueToken, requireAuth, type AppEnv } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { readJson } from "../middleware/validate";
import { HttpError } from "../services/errors";
import { hashPassword, verifyPassword } from "../services/password";
import { toUserMe } from "../services/serializers";
import { defaultPreferences, getPreferences, isUserSuspended, savePreferences } from "../services/users";
import { DEFAULT_FILTERS_BY_PRACTICE } from "@mountain-live/core";
import { newId, nowIso } from "../services/util";
import { formatDateFr } from "../services/util";

/**
 * POST /auth/register, POST /auth/login, GET /auth/me
 * Limite de débit : 20 requêtes / 10 min / IP sur /auth/*.
 */
export const authRoutes = new Hono<AppEnv>();

authRoutes.use("*", rateLimit({ name: "auth", ...config.rateLimit.auth }));

authRoutes.post("/register", async (c) => {
  const input = await readJson(c, registerSchema);
  const email = input.email.trim().toLowerCase();
  const pseudo = input.pseudo.trim();

  if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    throw new HttpError(409, "email_taken", "Un compte existe déjà avec cette adresse e-mail");
  }
  if (
    db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.pseudo} = ${pseudo} COLLATE NOCASE AND ${users.deletedAt} IS NULL`)
      .get()
  ) {
    throw new HttpError(409, "pseudo_taken", "Ce pseudo est déjà utilisé");
  }

  const now = nowIso();
  const row: UserRow = {
    id: newId(),
    email,
    passwordHash: hashPassword(input.password),
    pseudo,
    avatarUrl: null,
    practices: input.practices,
    region: input.region?.trim() || null,
    role: "user",
    reputationScore: 0,
    reliabilityLevel: 1,
    reportsCount: 0,
    confirmationsCount: 0,
    badges: [],
    consentGivenAt: now,
    suspendedUntil: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(users).values(row).run();

  // Filtres par défaut déduits de la première pratique déclarée (section 11).
  const prefs = defaultPreferences();
  const first = input.practices[0];
  if (first) prefs.filters = DEFAULT_FILTERS_BY_PRACTICE[first];
  savePreferences(row.id, prefs);

  const token = await issueToken(row);
  const body: AuthResponse = { token, user: toUserMe(row, prefs) };
  return c.json(body, 201);
});

authRoutes.post("/login", async (c) => {
  const input = await readJson(c, loginSchema);
  const user = db.select().from(users).where(eq(users.email, input.email.trim().toLowerCase())).get();
  // Même message dans tous les cas pour ne pas révéler l'existence d'un compte.
  if (!user || user.deletedAt || !verifyPassword(input.password, user.passwordHash)) {
    throw new HttpError(401, "invalid_credentials", "Adresse e-mail ou mot de passe incorrect");
  }
  if (isUserSuspended(user)) {
    throw new HttpError(403, "suspended", `Compte suspendu jusqu'au ${formatDateFr(user.suspendedUntil as string)}`);
  }
  const token = await issueToken(user);
  const body: AuthResponse = { token, user: toUserMe(user, getPreferences(user.id)) };
  return c.json(body);
});

authRoutes.get("/me", requireAuth, (c) => {
  const user = c.get("user") as UserRow;
  return c.json({ user: toUserMe(user, getPreferences(user.id)) });
});
