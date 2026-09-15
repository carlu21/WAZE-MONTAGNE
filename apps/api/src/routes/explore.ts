import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  aroundQuerySchema,
  bboxFromCenter,
  bboxStringSchema,
  haversineM,
  nearbyQuerySchema,
  type AreaSummary,
  type AroundResponse,
  type NearbyResponse,
  type ReportCategory,
  type SearchAreasResponse,
} from "@mountain-live/core";
import { z } from "zod";
import { db } from "../db/client";
import { areas, trails } from "../db/schema";
import { optionalAuth, type AppEnv } from "../middleware/auth";
import { readQuery } from "../middleware/validate";
import { areaBBox, searchAreasWithFallback } from "../services/areas";
import { listPathsInBBox, toPathSegment } from "../services/paths";
import { HttpError } from "../services/errors";
import { nearbyTrails, trailGeometry } from "../services/nearby";
import { presenceEstimateInBBox } from "../services/presence";
import { listOfficialAlerts, listTrailsInBBox, listWaterPointsInBBox, networkStats, waterPointsAround } from "../services/reference";
import { listVisibleReports, serializeReports } from "../services/reports";
import { toArea, toOfficialAlert, toTrail, toTrailSummary, toWaterPoint } from "../services/serializers";

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
  const { bbox, summary } = readQuery(c, z.object({ bbox: bboxStringSchema, summary: z.coerce.number().optional() }));
  const rows = listTrailsInBBox(bbox);
  if (summary) return c.json({ trails: rows.map(toTrailSummary) });
  return c.json({ trails: rows.map(toTrail) });
});

/** Réseau de chemins : démonstration ou données réelles (bandeau d'invitation à l'import). */
exploreRoutes.get("/paths/stats", (c) => c.json(networkStats()));

/**
 * « Randonnées autour de vous » (sections 34 et 35) : le contenu de l'écran
 * d'accueil, sous la barre « Où va-t-on ? ».
 *
 * Déclarée AVANT `/trails/:id` : dans l'ordre inverse, « nearby » serait lu
 * comme un identifiant d'itinéraire et l'écran d'accueil répondrait 404. Un
 * test verrouille cet ordre.
 *
 * `max-age=60` : la liste bouge avec les signalements et la position, une
 * minute suffit à absorber les allers-retours dans l'application sans figer une
 * battue signalée il y a dix minutes.
 */
exploreRoutes.get("/trails/nearby", (c) => {
  const q = readQuery(c, nearbyQuerySchema);
  const result = nearbyTrails({ lat: q.lat, lng: q.lng, activity: q.activity, sort: q.sort, limit: q.limit, radiusM: q.radiusM });
  const body: NearbyResponse = { ...result, generatedAt: new Date().toISOString() };
  c.header("Cache-Control", "public, max-age=60");
  return c.json(body);
});

/** Tracé complet d'un itinéraire : chargé à la sélection d'une carte de la liste. */
exploreRoutes.get("/trails/:id/geometry", (c) => {
  const body = trailGeometry(c.req.param("id"));
  if (!body) throw new HttpError(404, "not_found", "Itinéraire introuvable");
  c.header("Cache-Control", "public, max-age=300");
  return c.json(body);
});

exploreRoutes.get("/trails/:id", (c) => {
  const row = db.select().from(trails).where(eq(trails.id, c.req.param("id"))).get();
  if (!row) throw new HttpError(404, "not_found", "Itinéraire introuvable");
  return c.json({ trail: toTrail(row) });
});

/**
 * Réseau de chemins (navigation) : segments dont l'emprise croise la bbox
 * (au plus 5 000, soit largement une zone de 10 × 10 km en montagne).
 */
exploreRoutes.get("/paths", (c) => {
  const { bbox } = readQuery(c, bboxQuerySchema);
  const rows = listPathsInBBox(bbox, 5000);
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ paths: rows.map(toPathSegment), truncated: rows.length >= 5000 });
});

exploreRoutes.get("/water-points", (c) => {
  const { bbox } = readQuery(c, bboxQuerySchema);
  return c.json({ waterPoints: listWaterPointsInBBox(bbox).map(toWaterPoint) });
});

exploreRoutes.get("/alerts/official", (c) => {
  const { bbox } = readQuery(c, bboxQuerySchema);
  return c.json({ officialAlerts: listOfficialAlerts(bbox).map(toOfficialAlert) });
});
