import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import type { ActivitiesResponse, CreateActivityResponse } from "@mountain-live/core";
import { createActivitySchema, updateActivitySchema } from "@mountain-live/core";
import { z } from "zod";
import { db } from "../db/client";
import { activities, activityPoints } from "../db/schema";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { readJson, readQuery } from "../middleware/validate";
import {
  activityById,
  createActivity,
  deleteActivity,
  listActivities,
  processActivity,
  toActivityDto,
  traversalCount,
  withdrawContribution,
} from "../services/activities";
import { HttpError } from "../services/errors";
import { recomputeSegments } from "../services/network-stats";
import { nowIso } from "../services/util";

/**
 * Activités de l'utilisateur (moteur cartographique, sections 3, 5, 35).
 *
 * Tout est réservé à leur auteur : aucune route ne permet de consulter
 * l'activité de quelqu'un d'autre. Le traitement collectif n'a lieu que si
 * l'activité est contribuée, et retirer sa contribution efface immédiatement
 * les passages correspondants.
 */
export const activitiesRoutes = new Hono<AppEnv>();

activitiesRoutes.use("*", requireAuth);

activitiesRoutes.post("/", async (c) => {
  const input = await readJson(c, createActivitySchema);
  const user = c.get("user")!;
  const { row, points } = createActivity(input, user.id);
  const result = processActivity(row, points);
  if (result.touchedSegmentIds.length > 0) recomputeSegments(result.touchedSegmentIds);
  const fresh = activityById(row.id) ?? row;
  const body: CreateActivityResponse = {
    activity: toActivityDto(fresh, result.segments),
    traversals: result.traversals,
    segments: result.segments,
    offNetworkRuns: result.offNetworkRuns,
    contributed: result.contributed,
    contributionNote: result.note,
  };
  return c.json(body, 201);
});

activitiesRoutes.get("/", (c) => {
  const q = readQuery(c, z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }));
  const user = c.get("user")!;
  const { rows, total } = listActivities(user.id, q.limit, q.offset);
  const body: ActivitiesResponse = { activities: rows.map((r) => toActivityDto(r, traversalCount(r.id))), total };
  return c.json(body);
});

/** Activité de l'utilisateur courant, ou 404 : personne ne lit l'activité d'un autre. */
function ownedActivity(c: Context<AppEnv>, id: string) {
  const row = activityById(id);
  const user = c.get("user");
  if (!row || row.userId !== user?.id) throw new HttpError(404, "not_found", "Activité introuvable");
  return row;
}

activitiesRoutes.get("/:id", (c) => {
  const row = ownedActivity(c, c.req.param("id"));
  const points = db
    .select()
    .from(activityPoints)
    .where(eq(activityPoints.activityId, row.id))
    .orderBy(activityPoints.seq)
    .all()
    .map((p) => ({ at: p.at, lat: p.lat, lng: p.lng, alt: p.alt, accuracy: p.accuracy, speed: p.speed, heading: p.heading }));
  return c.json({ activity: toActivityDto(row, traversalCount(row.id)), points });
});

activitiesRoutes.patch("/:id", async (c) => {
  const row = ownedActivity(c, c.req.param("id"));
  const input = await readJson(c, updateActivitySchema);
  if (input.name !== undefined) {
    db.update(activities).set({ name: input.name }).where(eq(activities.id, row.id)).run();
  }
  let touched: string[] = [];
  if (input.contribute === false && row.contribution === "contributed") {
    // Retrait de la contribution : les passages quittent immédiatement les statistiques.
    touched = withdrawContribution(row);
  } else if (input.contribute === true && row.contribution !== "contributed") {
    db.update(activities).set({ contribution: "contributed", contributedAt: nowIso() }).where(eq(activities.id, row.id)).run();
    const refreshed = activityById(row.id);
    if (refreshed) touched = processActivity(refreshed).touchedSegmentIds;
  }
  if (touched.length > 0) recomputeSegments(touched);
  const fresh = activityById(row.id);
  if (!fresh) throw new HttpError(404, "not_found", "Activité introuvable");
  return c.json({ activity: toActivityDto(fresh, traversalCount(fresh.id)) });
});

activitiesRoutes.delete("/:id", (c) => {
  const row = ownedActivity(c, c.req.param("id"));
  const touched = deleteActivity(row);
  if (touched.length > 0) recomputeSegments(touched);
  return c.body(null, 204);
});
