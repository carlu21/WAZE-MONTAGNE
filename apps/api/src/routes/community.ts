import { Hono } from "hono";
import { and, desc, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { optionalAuth, type AppEnv } from "../middleware/auth";
import { listVisibleReports, serializeReports } from "../services/reports";
import { toUserPublic } from "../services/serializers";

/**
 * GET /community/activity : 30 derniers signalements, 10 meilleurs contributeurs
 * (signalements + confirmations), comptes partenaires et officiels.
 */
export const communityRoutes = new Hono<AppEnv>();

communityRoutes.get("/activity", optionalAuth, (c) => {
  const now = new Date();
  const rows = listVisibleReports({ limit: 30 }, now).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const topContributors = db
    .select()
    .from(users)
    .where(and(isNull(users.deletedAt), sql`${users.reportsCount} + ${users.confirmationsCount} > 0`))
    .orderBy(desc(sql`${users.reportsCount} + ${users.confirmationsCount}`), desc(users.reliabilityLevel))
    .limit(10)
    .all();
  const partners = db
    .select()
    .from(users)
    .where(and(isNull(users.deletedAt), inArray(users.role, ["partner", "official"])))
    .orderBy(desc(users.reportsCount))
    .limit(50)
    .all();
  return c.json({
    reports: serializeReports(rows, { now, viewerId: c.get("user")?.id ?? null }),
    topContributors: topContributors.map(toUserPublic),
    partners: partners.map(toUserPublic),
  });
});
