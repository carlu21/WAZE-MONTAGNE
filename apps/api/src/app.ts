import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { HTTPException } from "hono/http-exception";
import { serveStatic } from "@hono/node-server/serve-static";
import { API_PREFIX, CATEGORIES, SUBTYPES } from "@mountain-live/core";
import { config } from "./config";
import { runMigrations } from "./db/migrate";
import { sqlite } from "./db/client";
import type { AppEnv } from "./middleware/auth";
import { activitiesRoutes } from "./routes/activities";
import { adminNetworkRoutes } from "./routes/admin-network";
import { adminSourcesRoutes } from "./routes/admin-sources";
import { adminTracesRoutes } from "./routes/admin-traces";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { communityRoutes } from "./routes/community";
import { exploreRoutes } from "./routes/explore";
import { flagsRoutes } from "./routes/flags";
import { notificationsRoutes } from "./routes/notifications";
import { offlineRoutes } from "./routes/offline";
import { networkRoutes } from "./routes/network";
import { presenceRoutes } from "./routes/presence";
import { privacyZonesRoutes } from "./routes/privacy-zones";
import { proRoutes } from "./routes/pro";
import { reportsRoutes } from "./routes/reports";
import { usersRoutes } from "./routes/users";
import { HttpError } from "./services/errors";

/**
 * Application Hono : migrations au démarrage, CORS, journalisation, fichiers envoyés
 * servis sous /uploads, routes métier sous /api/v1, erreurs JSON uniformes.
 */
/** Adresses IPv4 non locales de la machine (Wi-Fi, Ethernet), les réseaux privés d'abord. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list ?? []) {
        if (i.family !== "IPv4" || i.internal) continue;
        out.push(i.address);
      }
    }
  } catch {
    /* interfaces indisponibles */
  }
  const priv = (a: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return out.sort((a, b) => Number(priv(b)) - Number(priv(a)));
}

export function createApp() {
  runMigrations(sqlite);
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const app = new Hono<AppEnv>();
  if (config.env !== "test") app.use("*", logger());
  app.use(
    `${API_PREFIX}/*`,
    cors({
      origin: (origin) => (config.corsOrigins.includes(origin) || config.env !== "production" ? origin : ""),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("/uploads/*", cors());

  // Photos : serveStatic attend une racine relative au répertoire courant.
  const uploadRoot = path.relative(process.cwd(), config.uploadDir) || ".";
  app.use(
    "/uploads/*",
    serveStatic({
      root: uploadRoot,
      rewriteRequestPath: (p) => p.replace(/^\/uploads/, ""),
      onFound: (_p, c) => c.header("Cache-Control", "public, max-age=86400, immutable"),
    }),
  );

  const api = new Hono<AppEnv>();
  // `lan` : adresses IPv4 de la machine (ouvrir l'application sur un téléphone du même réseau).
  api.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString(), lan: lanAddresses() }));
  api.get("/taxonomy", (c) => c.json({ categories: CATEGORIES, subtypes: SUBTYPES }));

  api.route("/auth", authRoutes);
  // Monté avant /users : la route imbriquée doit primer sur /users/:id.
  api.route("/users/me/privacy-zones", privacyZonesRoutes);
  api.route("/users", usersRoutes);
  api.route("/activities", activitiesRoutes);
  api.route("/network", networkRoutes);
  api.route("/reports", reportsRoutes);
  api.route("/flags", flagsRoutes);
  api.route("/", exploreRoutes);
  api.route("/presence", presenceRoutes);
  api.route("/notifications", notificationsRoutes);
  api.route("/offline", offlineRoutes);
  api.route("/community", communityRoutes);
  api.route("/admin/network", adminNetworkRoutes);
  api.route("/admin/traces", adminTracesRoutes);
  api.route("/admin/collect", adminSourcesRoutes);
  api.route("/admin", adminRoutes);
  api.route("/pro", proRoutes);

  app.route(API_PREFIX, api);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route introuvable" } }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } }, err.status);
    }
    if (err instanceof HTTPException) {
      const code = err.status === 401 ? "unauthorized" : err.status === 403 ? "forbidden" : err.status === 404 ? "not_found" : "http_error";
      return c.json({ error: { code, message: err.message || "Erreur" } }, err.status);
    }
    const message = err instanceof Error ? err.message : String(err);
    // Corps JSON malformé remonté par Hono / undici.
    if (/JSON/i.test(message) && /parse|unexpected|token/i.test(message)) {
      return c.json({ error: { code: "validation_error", message: "Corps de requête JSON invalide" } }, 400);
    }
    console.error(`[api] ${c.req.method} ${c.req.path} → erreur interne :`, err);
    return c.json({ error: { code: "internal_error", message: "Une erreur interne est survenue" } }, 500);
  });
  return app;
}
