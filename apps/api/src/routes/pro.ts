import { Hono } from "hono";
import { and, eq, gte, lte, ne, sql, type SQL } from "drizzle-orm";
import { CATEGORY_IDS, presenceCell, type BBox, type ProDashboard, type ReportCategory, type ReportSubtype } from "@mountain-live/core";
import { z } from "zod";
import { db } from "../db/client";
import { areas, reports } from "../db/schema";
import { requireAuth, requireRole, type AppEnv } from "../middleware/auth";
import { readQuery } from "../middleware/validate";
import { areaBBox } from "../services/areas";
import { HttpError } from "../services/errors";
import { presencePingsBetween } from "../services/presence";
import { nearestWaterPoint } from "../services/reference";
import { bboxConditions } from "../services/reports";

/**
 * GET /pro/dashboard?areaId&from&to (section 18) — rôles official, partner, admin.
 * Période par défaut : 30 derniers jours. Filtre facultatif sur un lieu (bbox ou 10 km).
 */
export const proRoutes = new Hono<AppEnv>();

proRoutes.use("*", requireAuth, requireRole("official", "partner", "admin"));

const querySchema = z.object({
  areaId: z.string().max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Cellule d'agrégation 0,01° (≈ 1 km) : centre de cellule. */
function cellCenterOf(lat: number, lng: number): { key: string; lat: number; lng: number } {
  const key = presenceCell({ lat, lng });
  const [clat, clng] = key.split(":").map(Number);
  return { key, lat: clat, lng: clng };
}

proRoutes.get("/dashboard", (c) => {
  const q = readQuery(c, querySchema);
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  if (from >= to) throw new HttpError(400, "validation_error", "La date de début doit précéder la date de fin");

  let areaName: string | null = null;
  let box: BBox | null = null;
  if (q.areaId) {
    const area = db.select().from(areas).where(eq(areas.id, q.areaId)).get();
    if (!area) throw new HttpError(404, "not_found", "Lieu introuvable");
    areaName = area.name;
    box = areaBBox(area, 10_000);
  }

  const conds: SQL[] = [ne(reports.status, "deleted"), gte(reports.createdAt, from.toISOString()), lte(reports.createdAt, to.toISOString())];
  if (box) conds.push(...bboxConditions(box));
  const rows = db.select().from(reports).where(and(...conds)).all();

  // Totaux et délais de résolution.
  const resolved = rows.filter((r) => r.resolvedAt || r.status === "resolved" || r.status === "probably_resolved");
  const durations = rows
    .filter((r) => r.resolvedAt)
    .map((r) => (Date.parse(r.resolvedAt as string) - Date.parse(r.createdAt)) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0);
  const avgResolutionHours = durations.length
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
    : null;

  const byCategory = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<ReportCategory, number>;
  const subtypeCounts = new Map<ReportSubtype, number>();
  const cells = new Map<string, { lat: number; lng: number; count: number; categories: Set<ReportCategory> }>();
  const timelineMap = new Map<string, number>();
  const waterIssues = new Map<string, { waterPointId: string; name: string; dryCount: number }>();

  for (const r of rows) {
    byCategory[r.category] += 1;
    subtypeCounts.set(r.subtype, (subtypeCounts.get(r.subtype) ?? 0) + 1);
    const cell = cellCenterOf(r.displayLat, r.displayLng);
    const entry = cells.get(cell.key) ?? { lat: cell.lat, lng: cell.lng, count: 0, categories: new Set<ReportCategory>() };
    entry.count += 1;
    entry.categories.add(r.category);
    cells.set(cell.key, entry);
    const day = r.createdAt.slice(0, 10);
    timelineMap.set(day, (timelineMap.get(day) ?? 0) + 1);
    if (r.subtype === "spring_dry") {
      const wp = nearestWaterPoint({ lat: r.lat, lng: r.lng }, 300);
      if (wp) {
        const w = waterIssues.get(wp.id) ?? { waterPointId: wp.id, name: wp.name, dryCount: 0 };
        w.dryCount += 1;
        waterIssues.set(wp.id, w);
      }
    }
  }

  // Chronologie complète jour par jour (les jours sans signalement comptent 0).
  const timeline: { date: string; count: number }[] = [];
  for (let d = new Date(from.toISOString().slice(0, 10)); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    timeline.push({ date: key, count: timelineMap.get(key) ?? 0 });
  }

  const CONFLICT_CATEGORIES: ReportCategory[] = ["activity", "animals", "crowd", "path"];
  const body: ProDashboard = {
    areaName,
    period: { from: from.toISOString(), to: to.toISOString() },
    reportsTotal: rows.length,
    reportsResolved: resolved.length,
    avgResolutionHours,
    byCategory,
    topSubtypes: [...subtypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([subtype, count]) => ({ subtype, count })),
    hotspots: [...cells.values()]
      .filter((cell) => cell.count >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .map(({ lat, lng, count }) => ({ lat, lng, count })),
    recurringWaterIssues: [...waterIssues.values()].sort((a, b) => b.dryCount - a.dryCount),
    estimatedVisitors: box ? presencePingsBetween(box, from.toISOString(), to.toISOString()) : presencePingsBetween(WORLD, from.toISOString(), to.toISOString()),
    conflictZones: [...cells.values()]
      .map((cell) => ({ ...cell, categories: [...cell.categories].filter((cat) => CONFLICT_CATEGORIES.includes(cat)) }))
      .filter((cell) => cell.categories.length >= 2)
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .map(({ lat, lng, count, categories }) => ({ lat, lng, count, categories })),
    timeline,
  };
  return c.json(body);
});

const WORLD: BBox = { west: -180, south: -90, east: 180, north: 90 };
