import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { privacyZoneSchema } from "@mountain-live/core";
import { db } from "../db/client";
import { privacyZones } from "../db/schema";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { readJson } from "../middleware/validate";
import { HttpError } from "../services/errors";
import { newId, nowIso } from "../services/util";

/**
 * Zones privées de l'utilisateur (section 36 du moteur cartographique).
 * Une trace passant dans l'une de ces zones y est tronquée avant toute
 * exploitation collective — en plus du retrait systématique des abords du
 * départ et de l'arrivée.
 */
export const privacyZonesRoutes = new Hono<AppEnv>();

privacyZonesRoutes.use("*", requireAuth);

const MAX_ZONES = 20;

privacyZonesRoutes.get("/", (c) => {
  const user = c.get("user")!;
  const zones = db
    .select()
    .from(privacyZones)
    .where(eq(privacyZones.userId, user.id))
    .all()
    .map((z) => ({ id: z.id, label: z.label, lat: z.lat, lng: z.lng, radiusM: z.radiusM }));
  return c.json({ zones });
});

privacyZonesRoutes.post("/", async (c) => {
  const user = c.get("user")!;
  const input = await readJson(c, privacyZoneSchema);
  const count = db.select().from(privacyZones).where(eq(privacyZones.userId, user.id)).all().length;
  if (count >= MAX_ZONES) throw new HttpError(400, "too_many", `Vous ne pouvez pas déclarer plus de ${MAX_ZONES} zones privées.`);
  const zone = { id: newId(), userId: user.id, label: input.label ?? null, lat: input.lat, lng: input.lng, radiusM: input.radiusM, createdAt: nowIso() };
  db.insert(privacyZones).values(zone).run();
  return c.json({ zone: { id: zone.id, label: zone.label, lat: zone.lat, lng: zone.lng, radiusM: zone.radiusM } }, 201);
});

privacyZonesRoutes.delete("/:id", (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");
  const zone = db.select().from(privacyZones).where(and(eq(privacyZones.id, id), eq(privacyZones.userId, user.id))).get();
  if (!zone) throw new HttpError(404, "not_found", "Zone introuvable");
  db.delete(privacyZones).where(eq(privacyZones.id, id)).run();
  return c.body(null, 204);
});
