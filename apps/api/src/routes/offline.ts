import { Hono } from "hono";
import { bboxStringSchema, type OfflineBundle } from "@mountain-live/core";
import { z } from "zod";
import { db } from "../db/client";
import { offlineZones } from "../db/schema";
import { optionalAuth, type AppEnv } from "../middleware/auth";
import { readQuery } from "../middleware/validate";
import { listAreasInBBox } from "../services/areas";
import { listPathsInBBox, toPathSegment } from "../services/paths";
import { listOfficialAlerts, listTrailsInBBox, listWaterPointsInBBox } from "../services/reference";
import { listVisibleReports, serializeReports } from "../services/reports";
import { toArea, toOfficialAlert, toTrail, toWaterPoint } from "../services/serializers";
import { newId } from "../services/util";

/**
 * GET /offline/bundle?bbox : tout ce qu'il faut pour une zone hors connexion (section 9) :
 * signalements visibles (2000 max), alertes officielles, sentiers, points d'eau, lieux,
 * réseau de chemins (navigation et map matching hors connexion).
 * Si l'utilisateur est authentifié, la zone est mémorisée (offline_zones) pour la synchronisation.
 */
export const offlineRoutes = new Hono<AppEnv>();

offlineRoutes.get("/bundle", optionalAuth, (c) => {
  const { bbox } = readQuery(c, z.object({ bbox: bboxStringSchema }));
  const now = new Date();
  const rows = listVisibleReports({ bbox, limit: 2000 }, now);
  const user = c.get("user");
  const body: OfflineBundle = {
    bbox,
    generatedAt: now.toISOString(),
    reports: serializeReports(rows, { now, viewerId: user?.id ?? null }),
    officialAlerts: listOfficialAlerts(bbox, now).map(toOfficialAlert),
    trails: listTrailsInBBox(bbox).map(toTrail),
    waterPoints: listWaterPointsInBBox(bbox).map(toWaterPoint),
    areas: listAreasInBBox(bbox).map(toArea),
    paths: listPathsInBBox(bbox, 20000).map(toPathSegment),
  };
  if (user) {
    db.insert(offlineZones)
      .values({ id: newId(), userId: user.id, name: null, bbox, reportsCount: rows.length, generatedAt: body.generatedAt })
      .run();
  }
  return c.json(body);
});
