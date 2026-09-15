import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { candidateReviewSchema, makeSegment, type NetworkCandidateDto } from "@mountain-live/core";
import { db } from "../db/client";
import { networkCandidates, paths, segmentVersions } from "../db/schema";
import { requireAuth, requireRole, type AppEnv } from "../middleware/auth";
import { readJson } from "../middleware/validate";
import { HttpError } from "../services/errors";
import { rebuildCandidates } from "../services/network-learning";
import { recomputeAll } from "../services/network-stats";
import { toCandidateDto } from "./network";
import { newId, nowIso } from "../services/util";

/**
 * Back-office du moteur cartographique (sections 46 et 47) : examiner les
 * propositions issues du terrain, les accepter ou les rejeter, relancer les
 * traitements.
 *
 * Une correction de tracé acceptée n'écrase jamais l'ancienne géométrie :
 * celle-ci est archivée dans `segment_versions` avant d'être remplacée, avec
 * sa source, sa raison et son auteur.
 */
export const adminNetworkRoutes = new Hono<AppEnv>();

adminNetworkRoutes.use("*", requireAuth, requireRole("moderator", "admin"));

adminNetworkRoutes.patch("/candidates/:id", async (c) => {
  const row = db.select().from(networkCandidates).where(eq(networkCandidates.id, c.req.param("id"))).get();
  if (!row) throw new HttpError(404, "not_found", "Proposition introuvable");
  const input = await readJson(c, candidateReviewSchema);
  const user = c.get("user")!;
  const now = nowIso();

  // Correction de tracé acceptée et appliquée : versionnement puis remplacement.
  if (input.status === "accepted" && input.applyGeometry && row.kind === "geometry" && row.segmentId && row.geometry && row.geometry.length >= 2) {
    const segment = db.select().from(paths).where(eq(paths.id, row.segmentId)).get();
    if (!segment) throw new HttpError(404, "not_found", "Chemin introuvable");
    const updated = makeSegment(segment.id, row.geometry, { kind: segment.kind, name: segment.name, source: segment.source });
    db.transaction((tx) => {
      tx.insert(segmentVersions)
        .values({
          id: newId(),
          segmentId: segment.id,
          version: segment.version,
          coordinates: segment.coordinates,
          source: segment.source,
          reason: "Géométrie remplacée par la ligne centrale communautaire",
          confidence: row.confidence,
          author: user.pseudo,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
      let minLat = Infinity;
      let minLng = Infinity;
      let maxLat = -Infinity;
      let maxLng = -Infinity;
      for (const [lng, lat] of row.geometry ?? []) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
      tx.update(paths)
        .set({
          coordinates: row.geometry ?? segment.coordinates,
          lengthM: updated.lengthM,
          version: segment.version + 1,
          communityConfidence: row.confidence,
          minLat,
          minLng,
          maxLat,
          maxLng,
          updatedAt: now,
        })
        .where(eq(paths.id, segment.id))
        .run();
    });
  }

  db.update(networkCandidates)
    .set({ status: input.status, reviewedBy: user.id, reviewedAt: now, reviewNote: input.note ?? null, updatedAt: now })
    .where(eq(networkCandidates.id, row.id))
    .run();
  const fresh = db.select().from(networkCandidates).where(eq(networkCandidates.id, row.id)).get();
  if (!fresh) throw new HttpError(404, "not_found", "Proposition introuvable");
  const body: { candidate: NetworkCandidateDto } = { candidate: toCandidateDto(fresh) };
  return c.json(body);
});

/** Relance complète : statistiques puis détection des candidatures. */
adminNetworkRoutes.post("/rebuild", (c) => {
  const statistics = recomputeAll();
  const candidates = rebuildCandidates();
  return c.json({ processed: 0, statistics, candidates: candidates.created + candidates.updated, byKind: candidates.byKind });
});
