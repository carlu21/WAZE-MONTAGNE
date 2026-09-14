import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { API_PREFIX, CATEGORIES, SUBTYPES } from "@mountain-live/core";
import { config } from "./config";

/**
 * Squelette de l'application Hono. Les routes métier sont montées ici
 * par la tâche "api" (voir src/routes/*).
 */
export function createApp() {
  const app = new Hono();
  app.use("*", logger());
  app.use(
    `${API_PREFIX}/*`,
    cors({
      origin: (origin) => (config.corsOrigins.includes(origin) || config.env !== "production" ? origin : ""),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  const api = new Hono();
  api.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));
  api.get("/taxonomy", (c) => c.json({ categories: CATEGORIES, subtypes: SUBTYPES }));

  app.route(API_PREFIX, api);
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route introuvable" } }, 404));
  return app;
}
