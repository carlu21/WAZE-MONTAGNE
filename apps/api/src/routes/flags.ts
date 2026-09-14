import { Hono } from "hono";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { flagSchema } from "@mountain-live/core";
import { db } from "../db/client";
import { moderationReports, photos, reportComments, type FlagRow, type UserRow } from "../db/schema";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { readJson } from "../middleware/validate";
import { HttpError } from "../services/errors";
import { getReportRow, recomputeReport } from "../services/reports";
import { toFlag } from "../services/serializers";
import { newId, nowIso } from "../services/util";

/**
 * POST /flags : signaler un contenu (section 17). Au moins une cible (signalement,
 * commentaire, photo). Un seul flag ouvert par utilisateur et par cible.
 * Trois flags ouverts d'auteurs distincts sur un signalement → statut « contesté ».
 */
export const flagsRoutes = new Hono<AppEnv>();

flagsRoutes.post("/", requireAuth, async (c) => {
  const user = c.get("user") as UserRow;
  const input = await readJson(c, flagSchema);
  if (!input.reportId && !input.commentId && !input.photoId) {
    throw new HttpError(400, "validation_error", "Indiquez le contenu à signaler (signalement, commentaire ou photo)");
  }

  // Résolution de la cible et du signalement parent.
  let reportId = input.reportId ?? null;
  if (input.commentId) {
    const comment = db
      .select()
      .from(reportComments)
      .where(and(eq(reportComments.id, input.commentId), isNull(reportComments.deletedAt)))
      .get();
    if (!comment) throw new HttpError(404, "not_found", "Commentaire introuvable");
    reportId = reportId ?? comment.reportId;
  }
  if (input.photoId) {
    const photo = db
      .select()
      .from(photos)
      .where(and(eq(photos.id, input.photoId), isNull(photos.deletedAt)))
      .get();
    if (!photo) throw new HttpError(404, "not_found", "Photo introuvable");
    reportId = reportId ?? photo.reportId;
  }
  const report = reportId ? getReportRow(reportId) : undefined;
  if (!report || report.status === "deleted") throw new HttpError(404, "not_found", "Signalement introuvable");

  const conds = [
    eq(moderationReports.reporterId, user.id),
    inArray(moderationReports.status, ["open", "reviewing"]),
    input.commentId ? eq(moderationReports.commentId, input.commentId) : isNull(moderationReports.commentId),
    input.photoId ? eq(moderationReports.photoId, input.photoId) : isNull(moderationReports.photoId),
    eq(moderationReports.reportId, report.id),
  ];
  const existing = db
    .select()
    .from(moderationReports)
    .where(and(...conds))
    .get();
  if (existing) return c.json({ flag: toFlag(existing) }, 200);

  const row: FlagRow = {
    id: newId(),
    reporterId: user.id,
    reportId: report.id,
    commentId: input.commentId ?? null,
    photoId: input.photoId ?? null,
    reason: input.reason,
    details: input.details?.trim() || null,
    status: "open",
    resolvedBy: null,
    resolutionNote: null,
    createdAt: nowIso(),
    resolvedAt: null,
  };
  db.insert(moderationReports).values(row).run();

  // Le recalcul applique la règle « 3 flags ouverts → contesté ».
  recomputeReport(report);
  return c.json({ flag: toFlag(row) }, 201);
});
