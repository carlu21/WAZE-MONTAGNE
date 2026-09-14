import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import type { UserRole } from "@mountain-live/core";
import type { AppEnv } from "../src/middleware/auth";

/**
 * Outils de test : base SQLite en mémoire, dossier d'upload temporaire, limites de débit
 * désactivées. Les variables d'environnement sont posées AVANT tout import de l'API
 * (la configuration est lue à l'import), d'où les imports dynamiques.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.JWT_SECRET = "secret-de-test";
process.env.RATE_LIMIT_DISABLED = "1";
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mountain-live-uploads-"));

export type TestApp = Hono<AppEnv>;

export interface CallResult<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

export async function setup() {
  const [{ createApp }, dbModule, expire, seed] = await Promise.all([
    import("../src/app"),
    import("../src/db/client"),
    import("../src/jobs/expire"),
    import("../src/db/seed"),
  ]);
  const app = createApp();
  return { app, db: dbModule.db, sqlite: dbModule.sqlite, runExpirationPass: expire.runExpirationPass, seedReference: seed.seedReference };
}

let counter = 0;

export async function call<T = Record<string, unknown>>(
  app: TestApp,
  method: string,
  route: string,
  opts: { body?: unknown; token?: string; form?: FormData; headers?: Record<string, string> } = {},
): Promise<CallResult<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined && !opts.form) headers["Content-Type"] = "application/json";
  const res = await app.request(`/api/v1${route}`, {
    method,
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T, headers: res.headers };
}

export interface TestUser {
  id: string;
  email: string;
  pseudo: string;
  token: string;
}

/** Crée un compte de test (e-mail et pseudo uniques) et renvoie son jeton. */
export async function registerUser(
  app: TestApp,
  overrides: { practices?: string[]; role?: UserRole; pseudo?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = `test${counter}-${Date.now()}@mountain-live.test`;
  const pseudo = overrides.pseudo ?? `Testeur ${counter}-${Date.now() % 100000}`;
  const res = await call<{ token: string; user: { id: string } }>(app, "POST", "/auth/register", {
    body: { email, password: "motdepasse123", pseudo, practices: overrides.practices ?? ["hiker"], consent: true },
  });
  if (res.status !== 201) throw new Error(`Inscription impossible : ${res.status} ${JSON.stringify(res.body)}`);
  const user = { id: res.body.user.id, email, pseudo, token: res.body.token };
  if (overrides.role && overrides.role !== "user") await setRole(user.id, overrides.role);
  return user;
}

/** Change le rôle d'un compte directement en base (les rôles ne sont pas exposés par l'API publique). */
export async function setRole(userId: string, role: UserRole): Promise<void> {
  const { sqlite } = await import("../src/db/client");
  sqlite.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
}

/** Point de référence : bergeries de Grotelle (Restonica). */
export const GROTELLE = { lat: 42.2261, lng: 9.0453 };
export const CORSICA_BBOX = "8.5,41.3,9.6,43.1";
