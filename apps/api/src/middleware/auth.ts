import type { Context, MiddlewareHandler } from "hono";
import { sign, verify } from "hono/jwt";
import { eq } from "drizzle-orm";
import type { UserRole } from "@mountain-live/core";
import { config } from "../config";
import { db } from "../db/client";
import { users, type UserRow } from "../db/schema";
import { HttpError } from "../services/errors";
import { formatDateFr } from "../services/util";

/** Variables de contexte Hono communes à toutes les routes. */
export type AppEnv = {
  Variables: {
    /** Utilisateur authentifié (chargé en base à chaque requête) ou null. */
    user: UserRow | null;
  };
};

export type AuthedContext = Context<AppEnv>;

interface TokenPayload {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

/** Jeton HS256 valable 30 jours. */
export async function issueToken(user: Pick<UserRow, "id" | "role">): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return sign({ sub: user.id, role: user.role, iat, exp: iat + config.jwtTtlSec }, config.jwtSecret, "HS256");
}

function extractBearer(c: Context): string | null {
  const header = c.req.header("Authorization") ?? c.req.header("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function isSuspended(user: UserRow, now = Date.now()): boolean {
  return !!user.suspendedUntil && Date.parse(user.suspendedUntil) > now;
}

/** Vérifie le jeton et charge l'utilisateur ; null si absent, erreur si invalide. */
async function resolveUser(c: Context): Promise<UserRow | null> {
  const token = extractBearer(c);
  if (!token) return null;
  let payload: TokenPayload;
  try {
    payload = (await verify(token, config.jwtSecret, "HS256")) as TokenPayload;
  } catch {
    throw new HttpError(401, "unauthorized", "Session invalide ou expirée");
  }
  if (!payload.sub) throw new HttpError(401, "unauthorized", "Session invalide");
  const user = db.select().from(users).where(eq(users.id, payload.sub)).get();
  if (!user || user.deletedAt) throw new HttpError(401, "unauthorized", "Compte introuvable");
  return user;
}

/** Authentification facultative : `c.get("user")` vaut null pour un visiteur anonyme. */
export const optionalAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", await resolveUser(c));
  await next();
};

/** Authentification obligatoire (401), compte suspendu refusé (403 « suspended »). */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await resolveUser(c);
  if (!user) throw new HttpError(401, "unauthorized", "Authentification requise");
  if (isSuspended(user)) {
    throw new HttpError(
      403,
      "suspended",
      `Compte suspendu jusqu'au ${formatDateFr(user.suspendedUntil as string)}`,
    );
  }
  c.set("user", user);
  await next();
};

/** Restreint l'accès à certains rôles (403 « forbidden »). À chaîner après requireAuth. */
export function requireRole(...roles: UserRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) throw new HttpError(401, "unauthorized", "Authentification requise");
    if (!roles.includes(user.role)) {
      throw new HttpError(403, "forbidden", "Vous n'avez pas les droits nécessaires pour cette action");
    }
    await next();
  };
}

export const isModerator = (user: UserRow | null): boolean =>
  !!user && (user.role === "moderator" || user.role === "admin");
