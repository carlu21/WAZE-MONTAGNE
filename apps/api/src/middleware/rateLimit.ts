import type { Context, MiddlewareHandler } from "hono";
import { config } from "../config";
import { HttpError } from "../services/errors";

/**
 * Limite de débit en mémoire, par adresse IP et par « seau » (auth, création de signalement…).
 * Suffisant pour un déploiement mono-processus ; à remplacer par un store partagé en cas
 * de montée en charge horizontale. Aucune donnée de position n'est conservée ici.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = c.req.header("x-real-ip");
  if (real) return real;
  // Serveur Node : l'adresse distante est accessible via l'objet `incoming`.
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "local";
}

export interface RateLimitOptions {
  name: string;
  max: number;
  windowMs: number;
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    if (!config.rateLimit.enabled) return next();
    const key = `${opts.name}:${clientIp(c)}`;
    const now = Date.now();
    let bucket = store.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, bucket);
    }
    bucket.count += 1;
    c.header("X-RateLimit-Limit", String(opts.max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, opts.max - bucket.count)));
    if (bucket.count > opts.max) {
      c.header("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      throw new HttpError(429, "rate_limited", "Trop de requêtes, réessayez dans quelques minutes");
    }
    await next();
  };
}

/** Nettoyage périodique des seaux expirés (évite une croissance infinie de la map). */
export function sweepRateLimits(now = Date.now()): void {
  for (const [key, bucket] of store) if (bucket.resetAt <= now) store.delete(key);
}

/** Réinitialisation complète (tests). */
export function resetRateLimits(): void {
  store.clear();
}
