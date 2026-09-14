import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  aroundQuerySchema,
  bboxFromCenter,
  bboxStringSchema,
  haversineM,
  type AreaSummary,
  type AroundResponse,
  type ReportCategory,
  type SearchAreasResponse,
} from "@mountain-live/core";
import { z } from "zod";
import { db } from "../db/client";
import { areas } from "../db/schema";
import { optionalAuth, type AppEnv } from "../middleware/auth";
import { readQuery } from "../middleware/validate";
import { areaBBox, searchAreasWithFallback } from "../services/areas";
import { HttpError } from "../services/errors";
import { presenceEstimateInBBox } from "../services/presence";
import { listOfficialAlerts, listTrailsInBBox, listWaterPointsInBBox, waterPointsAround } from "../services/reference";
import { listVisibleReports, serializeReports } from "../services/reports";
import { toArea, toOfficialAlert, toTrail, toWaterPoint } from "../services/serializers";

/**
 * Autour de moi / explorer : /around, /areas/search, /areas/:id, /trails, /water-points, /alerts/official
 */
export const exploreRoutes = new Hono<AppEnv>();

const bboxQuerySchema = z.object({ bbox: bboxStringSchema });

exploreRoutes.get("/around", optionalAuth, (c) => {
  const q = readQuery(c, aroundQuerySchema);
  const center = { lat: q.lat, lng: q.lng };
  const now = new Date();
  const box = bboxFromCenter(center, q.radius);
  const rows = listVisibleReports({ bbox: box, categories: q.categories as ReportCategory[] | undefined, limit: 1000 }, now);
  const items = serializeReports(rows, { now, origin: center, viewerId: c.get("user")?.id ?? null })
    .filter((r) => (r.distanceM ?? Infinity) <= q.radius)
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
  const body: AroundResponse = {
    center,
    radiusM: q.radius,
    items,
    officialAlerts: listOfficialAlerts(box, now).map(toOfficialAlert),
    waterPoints: waterPointsAround(center, q.radius).map((w) => ({ ...toWaterPoint(w), distanceM: w.distanceM })),
  };
  return c.json(body);
});

exploreRoutes.get("/areas/search", async (c) => {
  const q = readQuery(c, z.object({ q: z.string().max(80).default(""), lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() }));
  const rows = await searchAreasWithFallback(q.q, { lat: q.lat, lng: q.lng });
  const body: SearchAreasResponse = { areas: rows.map(toArea) };
  return c.json(body);
});

/**
 * Fiche d'un lieu (section 22) : signalements dans la bbox du lieu (ou 5 km), fréquentation,
 * points d'eau, sentiers, activités en cours et restrictions.
 */
exploreRoutes.get("/areas/:id", optionalAuth, (c) => {
  const area = db.select().from(areas).where(eq(areas.id, c.req.param("id"))).get();
  if (!area) throw new HttpError(404, "not_found", "Lieu introuvable");
  const now = new Date();
  const box = areaBBox(area, 5000);
  const center = { lat: area.lat, lng: area.lng };
  const rows = listVisibleReports({ bbox: box, limit: 500 }, now);
  const reports = serializeReports(rows, { now, origin: center, viewerId: c.get("user")?.id ?? null }).sort(
    (a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0),
  );
  const activeUsersEstimate = presenceEstimateInBBox(box, now);
  const crowdLevel: AreaSummary["crowdLevel"] = activeUsersEstimate >= 10 ? "high" : activeUsersEstimate >= 3 ? "medium" : "low";
  const body: AreaSummary = {
    area: toArea(area),
    reports,
    officialAlerts: listOfficialAlerts(box, now).map(toOfficialAlert),
    waterPoints: listWaterPointsInBBox(box)
      .map(toWaterPoint)
      .sort((a, b) => haversineM(center, a) - haversineM(center, b)),
    trails: listTrailsInBBox(box).map(toTrail),
    crowdLevel,
    activeUsersEstimate,
    activities: reports.filter((r) => r.category === "activity"),
    restrictions: reports.filter(
      (r) => r.subtype === "access_restriction" || r.subtype === "path_closed" || r.source === "official",
    ),
  };
  return c.json(body);
});

exploreRoutes.get("/trails", (c) => {
  const { bbox } = readQuery(c, bboxQuerySchema);
  return c.json({ trails: listTrailsInBBox(bbox).map(toTrail) });
});

exploreRoutes.get("/water-points", (c) => {
  const { bbox } = readQuery(c, bboxQuerySchema);
  return c.json({ waterPoints: listWaterPointsInBBox(bbox).map(toWaterPoint) });
});

exploreRoutes.get("/alerts/official", (c) => {
  const { bbox } = readQuery(c, bboxQuerySchema);
  return c.json({ officialAlerts: listOfficialAlerts(bbox).map(toOfficialAlert) });
});
