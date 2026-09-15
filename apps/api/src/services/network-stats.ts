/**
 * Statistiques de fréquentation du réseau (sections 9 à 16, 26, 30 à 32, 42,
 * 43 du moteur cartographique).
 *
 * Les passages bruts vivent dans `segment_traversals` ; ce service en tire les
 * agrégats publiables de `segment_statistics` (par segment, par activité, par
 * sens), plus la synthèse dénormalisée portée par le segment lui-même.
 *
 * Deux principes :
 * - le recalcul est **incrémental** : seuls les segments touchés par une
 *   activité sont repris, une reconstruction complète restant possible ;
 * - rien n'est publié sous le seuil d'utilisateurs distincts : `redactStatistics`
 *   neutralise ce qui pourrait désigner quelqu'un.
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  aggregateAll,
  describeFrequentation,
  isPublishable,
  redactStatistics,
  type ActivityMode,
  type BBox,
  type FrequentationLevel,
  type HeatmapPeriod,
  type HeatmapSegment,
  type SegmentStatistics,
  type TraversalDirection,
  type TraversalObservation,
} from "@mountain-live/core";
import { db } from "../db/client";
import { paths, segmentStatistics, segmentTraversals, type SegmentStatisticsRow } from "../db/schema";
import { toPathSegment } from "./paths";
import { nowIso } from "./util";

const CHUNK = 400;

function observationsFor(segmentIds: readonly string[]): TraversalObservation[] {
  const out: TraversalObservation[] = [];
  for (let i = 0; i < segmentIds.length; i += CHUNK) {
    const ids = segmentIds.slice(i, i + CHUNK);
    const rows = db.select().from(segmentTraversals).where(inArray(segmentTraversals.segmentId, ids)).all();
    for (const r of rows) {
      out.push({
        segmentId: r.segmentId,
        activity: r.activityType as ActivityMode,
        direction: r.direction as TraversalDirection,
        at: r.exitedAt,
        durationMs: r.durationMs,
        distanceM: r.distanceM,
        coverage: r.coverage,
        userKey: r.userKey,
        confidence: r.confidence,
      });
    }
  }
  return out;
}

function toRow(stats: SegmentStatistics, updatedAt: string): SegmentStatisticsRow {
  return {
    segmentId: stats.segmentId,
    activityType: stats.activity,
    direction: stats.direction,
    passages7: stats.passages.last7,
    passages30: stats.passages.last30,
    passages365: stats.passages.last365,
    passagesTotal: stats.passages.total,
    uniqueUsers: stats.uniqueUsers,
    uniqueSessions: stats.uniqueSessions,
    averageMs: stats.duration ? Math.round(stats.duration.averageMs) : null,
    medianMs: stats.duration ? Math.round(stats.duration.medianMs) : null,
    p25Ms: stats.duration ? Math.round(stats.duration.p25Ms) : null,
    p75Ms: stats.duration ? Math.round(stats.duration.p75Ms) : null,
    spread: stats.duration ? stats.duration.spread : null,
    averageSpeedMs: stats.averageSpeedMs,
    firstPassageAt: stats.firstPassageAt,
    lastPassageAt: stats.lastPassageAt,
    popularityScore: stats.popularityScore,
    frequentation: stats.frequentation,
    confidence: stats.confidence,
    insufficientData: stats.insufficientData,
    activityMix: stats.activityMix as Record<string, number>,
    monthly: stats.monthly,
    hourly: stats.hourly,
    trend: stats.trend,
    possiblyInactive: stats.possiblyInactive,
    updatedAt,
  };
}

export function rowToStatistics(row: SegmentStatisticsRow): SegmentStatistics {
  return {
    segmentId: row.segmentId,
    activity: row.activityType as ActivityMode | "all",
    direction: row.direction as TraversalDirection | "both",
    passages: { last7: row.passages7, last30: row.passages30, last365: row.passages365, total: row.passagesTotal },
    uniqueUsers: row.uniqueUsers,
    uniqueSessions: row.uniqueSessions,
    duration:
      row.medianMs === null
        ? null
        : {
            count: row.passagesTotal,
            averageMs: row.averageMs ?? row.medianMs,
            medianMs: row.medianMs,
            p25Ms: row.p25Ms ?? row.medianMs,
            p75Ms: row.p75Ms ?? row.medianMs,
            spread: row.spread ?? 0,
          },
    averageSpeedMs: row.averageSpeedMs,
    firstPassageAt: row.firstPassageAt,
    lastPassageAt: row.lastPassageAt,
    popularityScore: row.popularityScore,
    frequentation: row.frequentation as FrequentationLevel,
    confidence: row.confidence,
    insufficientData: row.insufficientData,
    activityMix: (row.activityMix ?? {}) as Partial<Record<ActivityMode, number>>,
    monthly: row.monthly ?? {},
    hourly: row.hourly ?? {},
    trend: row.trend,
    possiblyInactive: row.possiblyInactive,
  };
}

/** Recalcule les statistiques des segments indiqués. Renvoie le nombre de lignes écrites. */
export function recomputeSegments(segmentIds: readonly string[], now = Date.now()): number {
  const ids = [...new Set(segmentIds)].filter(Boolean);
  if (ids.length === 0) return 0;
  const observations = observationsFor(ids);
  const stats = aggregateAll(observations, { now });
  const byId = new Map<string, SegmentStatistics[]>();
  for (const s of stats) {
    const list = byId.get(s.segmentId);
    if (list) list.push(s);
    else byId.set(s.segmentId, [s]);
  }
  const updatedAt = nowIso();
  let written = 0;
  db.transaction((tx) => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      tx.delete(segmentStatistics).where(inArray(segmentStatistics.segmentId, ids.slice(i, i + CHUNK))).run();
    }
    for (const id of ids) {
      const list = byId.get(id) ?? [];
      for (const s of list) {
        tx.insert(segmentStatistics).values(toRow(s, updatedAt)).run();
        written += 1;
      }
      // Synthèse portée par le segment : sert au rendu rapide de la carte.
      const overall = list.find((s) => s.activity === "all" && s.direction === "both");
      tx.update(paths)
        .set({
          passageCount: overall?.passages.total ?? 0,
          lastPassageAt: overall?.lastPassageAt ? new Date(overall.lastPassageAt).toISOString() : null,
          popularityScore: overall?.popularityScore ?? 0,
          communityConfidence: overall?.confidence ?? null,
        })
        .where(eq(paths.id, id))
        .run();
    }
  });
  return written;
}

/** Reconstruit toutes les statistiques (tâche d'administration). */
export function recomputeAll(now = Date.now()): number {
  // Les segments encore parcourus, MAIS AUSSI ceux qui portent un compteur
  // hérité d'un passage retiré depuis : sans eux, une contribution retirée
  // laisserait un chiffre orphelin sur la carte.
  const ids = new Set(db.selectDistinct({ id: segmentTraversals.segmentId }).from(segmentTraversals).all().map((r) => r.id));
  for (const r of db.select({ id: paths.id }).from(paths).where(sql`${paths.passageCount} > 0`).all()) ids.add(r.id);
  return recomputeSegments([...ids], now);
}

export function statisticsOf(segmentId: string): SegmentStatistics[] {
  return db.select().from(segmentStatistics).where(eq(segmentStatistics.segmentId, segmentId)).all().map(rowToStatistics);
}

/** Statistiques publiables : sous le seuil d'anonymat, les détails sont neutralisés. */
export function publishableStatistics(segmentId: string): SegmentStatistics[] {
  return statisticsOf(segmentId).map((s) => (isPublishable(s) ? s : redactStatistics(s)));
}

export function overallStatistics(segmentId: string): SegmentStatistics | null {
  const row = db
    .select()
    .from(segmentStatistics)
    .where(and(eq(segmentStatistics.segmentId, segmentId), eq(segmentStatistics.activityType, "all"), eq(segmentStatistics.direction, "both")))
    .get();
  return row ? rowToStatistics(row) : null;
}

const PERIOD_DAYS: Record<HeatmapPeriod, number | null> = { today: 1, week: 7, month: 30, year: 365, all: null };

/** Passages retenus pour une période : les fenêtres pré-calculées évitent de relire les passages. */
function passagesForPeriod(row: SegmentStatisticsRow, period: HeatmapPeriod, now: number): number {
  if (period === "week") return row.passages7;
  if (period === "month") return row.passages30;
  if (period === "year") return row.passages365;
  if (period === "all") return row.passagesTotal;
  // « Aujourd'hui » n'est pas pré-calculé : on l'approche par le dernier passage.
  return row.lastPassageAt !== null && now - row.lastPassageAt < 86_400_000 ? Math.max(1, Math.round(row.passages7 / 7)) : 0;
}

/** Carte de fréquentation d'une emprise (section 12). */
export function heatmap(box: BBox, period: HeatmapPeriod, activity: ActivityMode | "all", now = Date.now(), limit = 4000): HeatmapSegment[] {
  const rows = db
    .select({ stats: segmentStatistics, path: paths })
    .from(segmentStatistics)
    .innerJoin(paths, eq(paths.id, segmentStatistics.segmentId))
    .where(
      and(
        eq(segmentStatistics.activityType, activity),
        eq(segmentStatistics.direction, "both"),
        lte(paths.minLat, box.north),
        gte(paths.maxLat, box.south),
        lte(paths.minLng, box.east),
        gte(paths.maxLng, box.west),
      ),
    )
    .orderBy(desc(segmentStatistics.popularityScore))
    .limit(limit)
    .all();
  const out: HeatmapSegment[] = [];
  for (const { stats, path } of rows) {
    const passages = passagesForPeriod(stats, period, now);
    if (passages <= 0 && period !== "all") continue;
    const s = rowToStatistics(stats);
    const published = isPublishable(s) ? s : redactStatistics(s);
    const mix = Object.entries(published.activityMix) as [ActivityMode, number][];
    const dominant = mix.sort((a, b) => b[1] - a[1])[0];
    out.push({
      segmentId: stats.segmentId,
      coordinates: toPathSegment(path).coordinates,
      passages,
      popularityScore: published.popularityScore,
      frequentation: published.frequentation,
      dominantActivity: dominant && dominant[1] >= 0.5 ? dominant[0] : null,
      insufficientData: published.insufficientData,
    });
  }
  return out;
}

/** Part des segments d'une emprise disposant de données (section 43). */
export function coverageInBBox(box: BBox): { withData: number; total: number } {
  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(paths)
    .where(and(lte(paths.minLat, box.north), gte(paths.maxLat, box.south), lte(paths.minLng, box.east), gte(paths.maxLng, box.west)))
    .get();
  const withData = db
    .select({ n: sql<number>`count(*)` })
    .from(paths)
    .where(
      and(
        lte(paths.minLat, box.north),
        gte(paths.maxLat, box.south),
        lte(paths.minLng, box.east),
        gte(paths.maxLng, box.west),
        sql`${paths.passageCount} > 0`,
      ),
    )
    .get();
  return { withData: withData?.n ?? 0, total: total?.n ?? 0 };
}

export { describeFrequentation };
