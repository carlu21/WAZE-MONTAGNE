import { Hono } from "hono";
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  adminFlagUpdateSchema,
  adminSuspendSchema,
  adminUpdateReportSchema,
  CATEGORY_IDS,
  officialAlertSchema,
  SUBTYPE_BY_ID,
  type AdminFlagsResponse,
  type AdminReportsResponse,
  type AdminStats,
  type AdminUsersResponse,
  type ReportCategory,
  type ReportStatus,
  type ReportSubtype,
} from "@mountain-live/core";
import { z } from "zod";
import { config } from "../config";
import { db } from "../db/client";
import { moderationReports, officialAlerts, photos, reportComments, reports, users, type FlagRow, type UserRow } from "../db/schema";
import { requireAuth, requireRole, type AppEnv } from "../middleware/auth";
import { readJson, readQuery } from "../middleware/validate";
import { blurLocation, computeExpiresAt, isSensitiveSubtype } from "../services/domain";
import { HttpError } from "../services/errors";
import { notifyNearbyUsers, notifyUser } from "../services/notifications";
import { softDeletePhoto } from "../services/photos";
import { createOfficialAlert } from "../services/reference";
import { addReputationEvent, hasReputationEvent, recomputeUserStanding } from "../services/reputation";
import { adminListReports, getReportRow, recomputeReport, serializeReport, serializeReports, softDeleteReport, visibleConditions } from "../services/reports";
import { toFlag, toOfficialAlert, toUserPublic } from "../services/serializers";
import { nowIso, parseBool } from "../services/util";

/**
 * Back-office de modération (section 17) : rôles moderator et admin.
 */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireAuth, requireRole("moderator", "admin"));

const PAGE_SIZE = 20;

adminRoutes.get("/stats", (c) => {
  const now = new Date();
  const since24h = new Date(now.getTime() - 86_400_000).toISOString();
  const notDeleted = ne(reports.status, "deleted");
  const count = (where: SQL | undefined) => db.select({ n: sql<number>`COUNT(*)` }).from(reports).where(where).get()?.n ?? 0;

  const byCategoryRows = db
    .select({ category: reports.category, n: sql<number>`COUNT(*)` })
    .from(reports)
    .where(notDeleted)
    .groupBy(reports.category)
    .all();
  const reportsByCategory = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<ReportCategory, number>;
  for (const r of byCategoryRows) reportsByCategory[r.category] = r.n;

  const avg = db
    .select({
      hours: sql<number | null>`AVG((julianday(${reports.resolvedAt}) - julianday(${reports.createdAt})) * 24)`,
    })
    .from(reports)
    .where(isNotNull(reports.resolvedAt))
    .get();

  const body: AdminStats = {
    reportsTotal: count(notDeleted),
    reportsActive: count(and(...visibleConditions(now))),
    reportsLast24h: count(and(notDeleted, gte(reports.createdAt, since24h))),
    reportsByCategory,
    usersTotal: db.select({ n: sql<number>`COUNT(*)` }).from(users).where(isNull(users.deletedAt)).get()?.n ?? 0,
    flagsOpen:
      db
        .select({ n: sql<number>`COUNT(*)` })
        .from(moderationReports)
        .where(inArray(moderationReports.status, ["open", "reviewing"]))
        .get()?.n ?? 0,
    avgResolutionHours: avg?.hours != null ? Math.round(avg.hours * 10) / 10 : null,
  };
  return c.json(body);
});

const adminReportsQuery = z.object({
  status: z.enum(["active", "confirmed", "probably_resolved", "resolved", "expired", "disputed", "deleted"]).optional(),
  category: z.enum(CATEGORY_IDS as [ReportCategory, ...ReportCategory[]]).optional(),
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  includeInactive: z.string().optional(),
});

adminRoutes.get("/reports", (c) => {
  const q = readQuery(c, adminReportsQuery);
  const { rows, total } = adminListReports({
    status: q.status as ReportStatus | undefined,
    category: q.category,
    q: q.q,
    page: q.page,
    includeInactive: parseBool(q.includeInactive),
    pageSize: PAGE_SIZE,
  });
  const body: AdminReportsResponse = { reports: serializeReports(rows, { viewerId: (c.get("user") as UserRow).id }), total };
  return c.json(body);
});

adminRoutes.patch("/reports/:id", async (c) => {
  const row = getReportRow(c.req.param("id"));
  if (!row) throw new HttpError(404, "not_found", "Signalement introuvable");
  const input = await readJson(c, adminUpdateReportSchema);
  const now = new Date();
  const patch: Partial<typeof row> = { updatedAt: now.toISOString() };
  const subtype = input.subtype as ReportSubtype | undefined;
  if (subtype && subtype !== row.subtype) {
    const def = SUBTYPE_BY_ID[subtype];
    patch.subtype = subtype;
    patch.category = def.category;
    patch.priority = def.priority;
    const sensitive = isSensitiveSubtype(subtype);
    const display = sensitive ? blurLocation(row.lat, row.lng, row.id, config.blurRadiusM) : { lat: row.lat, lng: row.lng };
    patch.displayLat = display.lat;
    patch.displayLng = display.lng;
    patch.blurred = sensitive;
    patch.expiresAt = computeExpiresAt(subtype, now, null, row.endsAt).toISOString();
  }
  if (input.dangerLevel !== undefined) patch.dangerLevel = input.dangerLevel ?? null;
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.source) patch.source = input.source;
  if (input.status) {
    patch.status = input.status;
    if (input.status === "resolved") patch.resolvedAt = now.toISOString();
    if (input.status === "deleted") patch.deletedAt = now.toISOString();
    if (input.status === "active" || input.status === "confirmed") {
      patch.resolvedAt = null;
      patch.deletedAt = null;
      if (Date.parse(patch.expiresAt ?? row.expiresAt) <= now.getTime()) {
        patch.expiresAt = computeExpiresAt(patch.subtype ?? row.subtype, now, null, row.endsAt).toISOString();
      }
    }
  }
  db.update(reports).set(patch).where(eq(reports.id, row.id)).run();
  let updated = { ...row, ...patch };
  // Un statut imposé par la modération n'est pas re-dérivé des votes ; sinon on recalcule.
  if (!input.status) updated = recomputeReport(updated, now);
  if (updated.userId) recomputeUserStanding(updated.userId);
  return c.json({ report: serializeReport(updated, { viewerId: (c.get("user") as UserRow).id }) });
});

adminRoutes.delete("/reports/:id", (c) => {
  const row = getReportRow(c.req.param("id"));
  if (!row) throw new HttpError(404, "not_found", "Signalement introuvable");
  if (row.status !== "deleted") softDeleteReport(row);
  return c.body(null, 204);
});

adminRoutes.get("/flags", (c) => {
  const q = readQuery(
    c,
    z.object({
      status: z.enum(["open", "reviewing", "resolved", "rejected"]).optional(),
      page: z.coerce.number().int().min(1).default(1),
    }),
  );
  const where = q.status ? eq(moderationReports.status, q.status) : inArray(moderationReports.status, ["open", "reviewing"]);
  const total = db.select({ n: sql<number>`COUNT(*)` }).from(moderationReports).where(where).get()?.n ?? 0;
  const rows = db
    .select()
    .from(moderationReports)
    .where(where)
    .orderBy(desc(moderationReports.createdAt))
    .limit(PAGE_SIZE)
    .offset((q.page - 1) * PAGE_SIZE)
    .all();
  const reportIds = [...new Set(rows.map((r) => r.reportId).filter((x): x is string => !!x))];
  const reportRows = reportIds.length ? db.select().from(reports).where(inArray(reports.id, reportIds)).all() : [];
  const serialized = new Map(serializeReports(reportRows).map((r) => [r.id, r]));
  const body: AdminFlagsResponse = {
    flags: rows.map((f) => ({ ...toFlag(f), report: f.reportId ? (serialized.get(f.reportId) ?? null) : null })),
    total,
  };
  return c.json(body);
});

/** Traitement d'un flag : statut + action facultative (suppression du contenu, suspension de l'auteur). */
adminRoutes.patch("/flags/:id", async (c) => {
  const moderator = c.get("user") as UserRow;
  const flag = db.select().from(moderationReports).where(eq(moderationReports.id, c.req.param("id"))).get();
  if (!flag) throw new HttpError(404, "not_found", "Signalement de contenu introuvable");
  const input = await readJson(c, adminFlagUpdateSchema);
  const now = nowIso();

  let authorId: string | null = null;
  if (flag.commentId) {
    const comment = db.select().from(reportComments).where(eq(reportComments.id, flag.commentId)).get();
    authorId = comment?.userId ?? null;
    if (input.action === "delete_content" && comment && !comment.deletedAt) {
      db.update(reportComments).set({ deletedAt: now }).where(eq(reportComments.id, comment.id)).run();
    }
  } else if (flag.photoId) {
    const photo = db.select().from(photos).where(eq(photos.id, flag.photoId)).get();
    authorId = photo?.userId ?? null;
    if (input.action === "delete_content" && photo) softDeletePhoto(photo.id);
  } else if (flag.reportId) {
    const report = getReportRow(flag.reportId);
    authorId = report?.userId ?? null;
    if (input.action === "delete_content" && report && report.status !== "deleted") softDeleteReport(report);
  }

  if (input.action === "suspend_author" && authorId) {
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
    db.update(users).set({ suspendedUntil: until, updatedAt: now }).where(eq(users.id, authorId)).run();
    notifyUser({
      userId: authorId,
      type: "system",
      title: "Compte suspendu",
      body: "Votre compte est suspendu pour 7 jours à la suite d'un signalement de contenu retenu par la modération.",
    });
  }

  const closing = input.status === "resolved" || input.status === "rejected";
  const updated: FlagRow = {
    ...flag,
    status: input.status,
    resolutionNote: input.resolutionNote !== undefined ? input.resolutionNote : flag.resolutionNote,
    resolvedBy: closing ? moderator.id : null,
    resolvedAt: closing ? now : null,
  };
  db.update(moderationReports)
    .set({ status: updated.status, resolutionNote: updated.resolutionNote, resolvedBy: updated.resolvedBy, resolvedAt: updated.resolvedAt })
    .where(eq(moderationReports.id, flag.id))
    .run();

  // Flag retenu : pénalité de réputation pour l'auteur (une seule fois par flag).
  if (input.status === "resolved" && authorId && !hasReputationEvent(authorId, "flag_upheld", flag.id)) {
    addReputationEvent({ userId: authorId, type: "flag_upheld", reportId: flag.reportId, actorId: moderator.id, refId: flag.id });
  }
  if (authorId) recomputeUserStanding(authorId);
  // Le statut « contesté » dépend du nombre de flags ouverts : on le recalcule.
  if (flag.reportId) {
    const report = getReportRow(flag.reportId);
    if (report && report.status !== "deleted" && report.status !== "resolved") recomputeReport(report);
  }
  return c.json({ flag: toFlag(updated) });
});

adminRoutes.get("/users", (c) => {
  const q = readQuery(c, z.object({ q: z.string().max(120).optional(), page: z.coerce.number().int().min(1).default(1) }));
  const conds: SQL[] = [];
  if (q.q?.trim()) {
    const like = `%${q.q.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conds.push(or(sql`${users.pseudo} LIKE ${like} ESCAPE '\\'`, sql`${users.email} LIKE ${like} ESCAPE '\\'`, eq(users.id, q.q.trim())) as SQL);
  }
  const where = conds.length ? and(...conds) : undefined;
  const total = db.select({ n: sql<number>`COUNT(*)` }).from(users).where(where).get()?.n ?? 0;
  const rows = db
    .select()
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(PAGE_SIZE)
    .offset((q.page - 1) * PAGE_SIZE)
    .all();
  const body: AdminUsersResponse = {
    users: rows.map((u) => ({ ...toUserPublic(u), email: u.email, suspendedUntil: u.suspendedUntil ?? null })),
    total,
  };
  return c.json(body);
});

adminRoutes.post("/users/:id/suspend", async (c) => {
  const target = db.select().from(users).where(eq(users.id, c.req.param("id"))).get();
  if (!target || target.deletedAt) throw new HttpError(404, "not_found", "Utilisateur introuvable");
  const moderator = c.get("user") as UserRow;
  if (target.id === moderator.id) throw new HttpError(400, "self_suspend", "Vous ne pouvez pas suspendre votre propre compte");
  if (target.role === "admin" && moderator.role !== "admin") {
    throw new HttpError(403, "forbidden", "Seul un administrateur peut suspendre un administrateur");
  }
  const input = await readJson(c, adminSuspendSchema);
  const now = nowIso();
  const suspendedUntil = input.hours === 0 ? null : new Date(Date.now() + input.hours * 3_600_000).toISOString();
  db.update(users).set({ suspendedUntil, updatedAt: now }).where(eq(users.id, target.id)).run();
  notifyUser({
    userId: target.id,
    type: "system",
    title: suspendedUntil ? "Compte suspendu" : "Suspension levée",
    body: suspendedUntil
      ? `Votre compte est suspendu pour ${input.hours} h${input.reason ? ` : ${input.reason}` : "."}`
      : "La suspension de votre compte est levée. Merci de respecter les règles de la communauté.",
  });
  return c.json({ user: { ...toUserPublic({ ...target, suspendedUntil }), email: target.email, suspendedUntil } });
});

adminRoutes.post("/alerts", async (c) => {
  const input = await readJson(c, officialAlertSchema);
  if (input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    throw new HttpError(400, "validation_error", "La date de fin doit être postérieure à la date de début");
  }
  const row = createOfficialAlert({ ...input, category: input.category as ReportCategory }, (c.get("user") as UserRow).id);
  notifyNearbyUsers({
    at: { lat: row.centroidLat, lng: row.centroidLng },
    category: row.category,
    type: "official_alert",
    title: `Alerte officielle : ${row.title}`,
    body: () => `${row.organisation} — ${row.body.slice(0, 160)}${row.body.length > 160 ? "…" : ""}`,
    reportId: null,
    excludeUserId: null,
    radiusM: 5000,
  });
  return c.json({ officialAlert: toOfficialAlert(row) }, 201);
});

adminRoutes.delete("/alerts/:id", (c) => {
  const row = db.select().from(officialAlerts).where(eq(officialAlerts.id, c.req.param("id"))).get();
  if (!row || row.deletedAt) throw new HttpError(404, "not_found", "Alerte introuvable");
  db.update(officialAlerts).set({ deletedAt: nowIso() }).where(eq(officialAlerts.id, row.id)).run();
  return c.body(null, 204);
});
