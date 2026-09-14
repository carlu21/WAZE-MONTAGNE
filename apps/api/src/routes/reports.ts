import { Hono } from "hono";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  commentSchema,
  confirmSchema,
  createReportSchema,
  listReportsQuerySchema,
  updateReportSchema,
  type ConfirmResponse,
  type CreateReportResponse,
  type ListReportsResponse,
  type ReportCategory,
  type ReportDetailResponse,
  type ReportSubtype,
  type UploadPhotoResponse,
} from "@mountain-live/core";
import { z } from "zod";
import { config } from "../config";
import { db } from "../db/client";
import { reportComments, users, type UserRow } from "../db/schema";
import { isModerator, optionalAuth, requireAuth, type AppEnv } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { readJson, readQuery } from "../middleware/validate";
import { HttpError } from "../services/errors";
import { storePhoto } from "../services/photos";
import { listOfficialAlerts } from "../services/reference";
import {
  castVote,
  createReport,
  getReportRow,
  listConfirmations,
  listVisibleReports,
  serializeReport,
  serializeReports,
  updateReport,
} from "../services/reports";
import { toComment, toConfirmation, toOfficialAlert, toPhoto, toUserPublic } from "../services/serializers";
import { newId, nowIso, parseBool } from "../services/util";

/**
 * /reports : liste, détail, création, mise à jour, votes, commentaires, photos.
 */
export const reportsRoutes = new Hono<AppEnv>();

const positionQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

function originOf(q: { lat?: number; lng?: number }): { lat: number; lng: number } | null {
  return q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : null;
}

/** Charge un signalement visible par le demandeur (les supprimés ne sont visibles que des modérateurs). */
function loadReportOr404(id: string, viewer: UserRow | null) {
  const row = getReportRow(id);
  if (!row || (row.status === "deleted" && !isModerator(viewer))) {
    throw new HttpError(404, "not_found", "Signalement introuvable");
  }
  return row;
}

reportsRoutes.get("/", optionalAuth, (c) => {
  const q = readQuery(c, listReportsQuerySchema);
  const viewer = c.get("user");
  const now = new Date();
  // `includeInactive` (expirés, résolus…) est réservé aux modérateurs. Lu en brut car
  // `z.coerce.boolean()` considère la chaîne « false » comme vraie.
  const includeInactive = isModerator(viewer) && parseBool(c.req.query("includeInactive"));
  const rows = listVisibleReports(
    { bbox: q.bbox, categories: q.categories as ReportCategory[] | undefined, source: q.source, since: q.since, limit: q.limit, includeInactive },
    now,
  );
  const body: ListReportsResponse = {
    reports: serializeReports(rows, { now, origin: originOf(q), viewerId: viewer?.id ?? null }),
    officialAlerts: listOfficialAlerts(q.bbox ?? null, now).map(toOfficialAlert),
    generatedAt: now.toISOString(),
  };
  return c.json(body);
});

reportsRoutes.post("/", requireAuth, rateLimit({ name: "create-report", ...config.rateLimit.createReport }), async (c) => {
  const user = c.get("user") as UserRow;
  const input = await readJson(c, createReportSchema);
  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    throw new HttpError(400, "validation_error", "L'heure de fin doit être postérieure à l'heure de début", [
      { path: "endsAt", message: "Doit être postérieure à startsAt" },
    ]);
  }
  // Une fin déjà passée produirait un signalement invisible dès sa création.
  if (input.endsAt && Date.parse(input.endsAt) <= Date.now()) {
    throw new HttpError(400, "validation_error", "L'heure de fin doit être dans le futur", [
      { path: "endsAt", message: "Doit être postérieure à maintenant" },
    ]);
  }
  const { row, created } = createReport(user, { ...input, subtype: input.subtype as ReportSubtype });
  const body: CreateReportResponse = { report: serializeReport(row, { viewerId: user.id }) };
  return c.json(body, created ? 201 : 200);
});

reportsRoutes.get("/:id", optionalAuth, (c) => {
  const viewer = c.get("user");
  const row = loadReportOr404(c.req.param("id"), viewer);
  const q = readQuery(c, positionQuerySchema);
  const report = serializeReport(row, { origin: originOf(q), viewerId: viewer?.id ?? null });

  const commentRows = db
    .select()
    .from(reportComments)
    .where(and(eq(reportComments.reportId, row.id), isNull(reportComments.deletedAt)))
    .orderBy(asc(reportComments.createdAt))
    .all();
  const authorIds = [...new Set(commentRows.map((r) => r.userId).filter((x): x is string => !!x))];
  const pseudoById = new Map<string, string | null>();
  if (authorIds.length) {
    for (const u of db
      .select({ id: users.id, pseudo: users.pseudo, deletedAt: users.deletedAt })
      .from(users)
      .where(inArray(users.id, authorIds))
      .all()) {
      pseudoById.set(u.id, u.deletedAt ? null : u.pseudo);
    }
  }

  const authorRow = row.userId ? db.select().from(users).where(eq(users.id, row.userId)).get() : undefined;
  const author = authorRow && !authorRow.deletedAt && authorRow.role !== "official" ? toUserPublic(authorRow) : null;

  const body: ReportDetailResponse = {
    report,
    comments: commentRows.map((r) => toComment(r, r.userId ? (pseudoById.get(r.userId) ?? null) : null)),
    confirmations: listConfirmations(row.id).map(toConfirmation),
    author,
  };
  return c.json(body);
});

reportsRoutes.patch("/:id", requireAuth, async (c) => {
  const user = c.get("user") as UserRow;
  const row = loadReportOr404(c.req.param("id"), user);
  if (row.userId !== user.id && !isModerator(user)) {
    throw new HttpError(403, "forbidden", "Seul l'auteur ou un modérateur peut modifier ce signalement");
  }
  const input = await readJson(c, updateReportSchema);
  const updated = updateReport(row, { ...input, subtype: input.subtype as ReportSubtype | undefined }, user);
  return c.json({ report: serializeReport(updated, { viewerId: user.id }) });
});

reportsRoutes.post("/:id/confirm", requireAuth, async (c) => {
  const user = c.get("user") as UserRow;
  const row = loadReportOr404(c.req.param("id"), user);
  const input = await readJson(c, confirmSchema);
  const result = castVote(row, user, input);
  const body: ConfirmResponse = {
    report: serializeReport(result.report, { viewerId: user.id }),
    confirmation: toConfirmation(result.confirmation),
  };
  return c.json(body);
});

reportsRoutes.get("/:id/comments", optionalAuth, (c) => {
  const row = loadReportOr404(c.req.param("id"), c.get("user"));
  const rows = db
    .select({ comment: reportComments, pseudo: users.pseudo, deletedAt: users.deletedAt })
    .from(reportComments)
    .leftJoin(users, eq(users.id, reportComments.userId))
    .where(and(eq(reportComments.reportId, row.id), isNull(reportComments.deletedAt)))
    .orderBy(asc(reportComments.createdAt))
    .all();
  return c.json({ comments: rows.map((r) => toComment(r.comment, r.deletedAt ? null : r.pseudo)) });
});

reportsRoutes.post("/:id/comments", requireAuth, async (c) => {
  const user = c.get("user") as UserRow;
  const row = loadReportOr404(c.req.param("id"), user);
  const input = await readJson(c, commentSchema);
  const comment = {
    id: newId(),
    reportId: row.id,
    userId: user.id,
    body: input.body.trim(),
    createdAt: nowIso(),
    deletedAt: null,
  };
  db.insert(reportComments).values(comment).run();
  return c.json({ comment: toComment(comment, user.pseudo) }, 201);
});

/** Multipart : champ « photo » (JPEG, PNG ou WebP, 5 Mo max). */
reportsRoutes.post("/:id/photos", requireAuth, async (c) => {
  const user = c.get("user") as UserRow;
  const row = loadReportOr404(c.req.param("id"), user);
  if (row.status === "deleted") throw new HttpError(404, "not_found", "Signalement introuvable");
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    throw new HttpError(400, "validation_error", "Formulaire multipart invalide");
  }
  const file = body.photo;
  if (!(file instanceof File)) {
    throw new HttpError(400, "validation_error", "Champ « photo » manquant", [{ path: "photo", message: "Fichier requis" }]);
  }
  if (file.size > config.maxPhotoBytes) throw new HttpError(413, "photo_too_large", "Photo trop volumineuse (5 Mo maximum)");
  const buffer = Buffer.from(await file.arrayBuffer());
  const photo = storePhoto({ reportId: row.id, userId: user.id, buffer, declaredMime: file.type || "" });
  const response: UploadPhotoResponse = {
    photo: toPhoto(photo),
    report: serializeReport({ ...row, updatedAt: nowIso() }, { viewerId: user.id }),
  };
  return c.json(response, 201);
});
