import { Hono } from "hono";
import { bboxStringSchema, presenceSchema, type PresenceResponse } from "@mountain-live/core";
import { z } from "zod";
import { config } from "../config";
import { optionalAuth, type AppEnv } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { readJson, readQuery } from "../middleware/validate";
import { aggregatePresence, recordPresence } from "../services/presence";

/**
 * Présence agrégée (section 8) :
 *  POST /presence { lat, lng } → 204 : seule la cellule ~1 km et la tranche de 5 min sont comptées.
 *  GET  /presence?bbox → cellules (centre + estimation) et estimation globale.
 */
export const presenceRoutes = new Hono<AppEnv>();

presenceRoutes.post("/", optionalAuth, rateLimit({ name: "presence", ...config.rateLimit.presence }), async (c) => {
  const input = await readJson(c, presenceSchema);
  recordPresence(input, c.get("user")?.id ?? null);
  return c.body(null, 204);
});

presenceRoutes.get("/", (c) => {
  const { bbox } = readQuery(c, z.object({ bbox: bboxStringSchema }));
  const body: PresenceResponse = aggregatePresence(bbox);
  return c.json(body);
});
