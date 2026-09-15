/**
 * Activités : ingestion, traitement et vie privée (sections 3, 5, 6, 7, 8, 9,
 * 35 et 36 du moteur cartographique).
 *
 * Chaîne d'ingestion :
 *
 *   trace brute reçue  →  activités + activity_points (jamais modifiés)
 *        │
 *        └── si et seulement si l'utilisateur contribue :
 *            masquage des abords privés  →  notation des points  →  map matching
 *            →  activity_matched_points  →  segment_traversals  →  statistiques
 *
 * Une activité privée est conservée pour son auteur (résumé, trace, export) et
 * n'alimente RIEN de collectif : aucun passage n'est calculé. Retirer la
 * contribution efface les passages correspondants.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  K_ANONYMITY_MIN,
  RAW_TRACE_RETENTION_DAYS,
  extractOffNetworkRuns,
  extractTraversals,
  matchTrace,
  maskTrace,
  scoreTrace,
  toObservations,
  traceQuality,
  trackStats,
  usablePoints,
  type ActivityDto,
  type ActivityMode,
  type ActivityPointInput,
  type ContributionStatus,
  type CreateActivityInput,
  type OffNetworkRun,
  type PrivacyZone,
  type RawPoint,
  type SegmentTraversal,
  type TrackPoint,
} from "@mountain-live/core";
import { config } from "../config";
import { db } from "../db/client";
import {
  activities,
  activityMatchedPoints,
  activityPoints,
  paths,
  privacyZones,
  segmentTraversals,
  type ActivityRow,
} from "../db/schema";
import { boundsOf, graphForBBox, segmentIndex, segmentsInBBox } from "./network-graph";
import { userKey } from "./pseudonym";
import { newId, nowIso } from "./util";

/** Qualité minimale d'une trace pour alimenter le réseau (part de points utilisables). */
export const MIN_USABLE_RATIO = 0.5;
/** Précision médiane au-delà de laquelle une trace est trop floue pour apprendre. */
export const MAX_MEDIAN_ACCURACY_M = 40;
/** Longueur écartée au départ et à l'arrivée de chaque trace contribuée (section 36). */
export const TRIM_ENDS_M = 250;

export interface ProcessResult {
  traversals: number;
  segments: number;
  offNetworkRuns: number;
  contributed: boolean;
  note: string | null;
  /** Segments dont les statistiques sont à recalculer. */
  touchedSegmentIds: string[];
  /** Portions hors réseau retenues (matière première des chemins potentiels). */
  runs: OffNetworkRun[];
}

function toRawPoints(points: readonly ActivityPointInput[]): RawPoint[] {
  return points
    .map((p) => ({
      lat: p.lat,
      lng: p.lng,
      alt: p.alt ?? null,
      at: p.at,
      accuracy: p.accuracy ?? null,
      speed: p.speed ?? null,
      heading: p.heading ?? null,
    }))
    .sort((a, b) => a.at - b.at);
}

function toTrackPoints(points: readonly RawPoint[]): TrackPoint[] {
  return points.map((p) => ({ lat: p.lat, lng: p.lng, alt: p.alt, at: p.at, accuracy: p.accuracy }));
}

/** Zones privées déclarées par l'utilisateur (section 36). */
export function privacyZonesOf(userId: string): PrivacyZone[] {
  return db
    .select()
    .from(privacyZones)
    .where(eq(privacyZones.userId, userId))
    .all()
    .map((z) => ({ lat: z.lat, lng: z.lng, radiusM: z.radiusM }));
}

export function activityById(id: string): ActivityRow | undefined {
  return db.select().from(activities).where(and(eq(activities.id, id), isNull(activities.deletedAt))).get();
}

export function activityByClientId(userId: string, clientId: string): ActivityRow | undefined {
  return db
    .select()
    .from(activities)
    .where(and(eq(activities.userId, userId), eq(activities.name, clientId)))
    .get();
}

/**
 * Enregistre une activité et sa trace brute. Le traitement collectif n'est
 * lancé que si l'utilisateur contribue.
 */
export function createActivity(input: CreateActivityInput, userId: string): { row: ActivityRow; points: RawPoint[] } {
  const points = toRawPoints(input.points.slice(0, config.maxActivityPoints));
  const stats = trackStats(toTrackPoints(points));
  const bounds = boundsOf(points);
  const now = nowIso();
  const id = newId();
  const row: ActivityRow = {
    id,
    userId,
    name: input.name ?? null,
    activityType: input.activityType,
    source: input.source,
    startedAt: new Date(points[0]?.at ?? Date.parse(input.startedAt)).toISOString(),
    endedAt: new Date(points[points.length - 1]?.at ?? Date.parse(input.endedAt)).toISOString(),
    distanceM: stats.distanceM,
    durationMs: stats.durationMs,
    movingMs: stats.movingMs,
    elevationGainM: stats.gainM,
    elevationLossM: stats.lossM,
    maxAltM: stats.maxAltM,
    averageSpeedMs: stats.avgSpeedMs || null,
    pointCount: points.length,
    qualityScore: null,
    matchedRatio: null,
    contribution: input.contribute ? "contributed" : "private",
    contributedAt: input.contribute ? now : null,
    processedAt: null,
    rawPurgedAt: null,
    minLat: bounds?.south ?? null,
    minLng: bounds?.west ?? null,
    maxLat: bounds?.north ?? null,
    maxLng: bounds?.east ?? null,
    createdAt: now,
    deletedAt: null,
  };
  db.transaction((tx) => {
    tx.insert(activities).values(row).run();
    for (let i = 0; i < points.length; i += 500) {
      const batch = points.slice(i, i + 500).map((p, k) => ({
        activityId: id,
        seq: i + k,
        at: p.at,
        lat: p.lat,
        lng: p.lng,
        alt: p.alt,
        accuracy: p.accuracy,
        speed: p.speed,
        heading: p.heading,
        quality: null,
      }));
      tx.insert(activityPoints).values(batch).run();
    }
  });
  return { row, points };
}

export function rawPointsOf(activityId: string): RawPoint[] {
  return db
    .select()
    .from(activityPoints)
    .where(eq(activityPoints.activityId, activityId))
    .orderBy(activityPoints.seq)
    .all()
    .map((p) => ({ lat: p.lat, lng: p.lng, alt: p.alt, at: p.at, accuracy: p.accuracy, speed: p.speed, heading: p.heading }));
}

/**
 * Traite une activité contribuée : masquage, notation, map matching, passages.
 * Idempotent : les passages précédents de cette activité sont remplacés.
 */
export function processActivity(row: ActivityRow, rawInput?: readonly RawPoint[]): ProcessResult {
  const empty: ProcessResult = { traversals: 0, segments: 0, offNetworkRuns: 0, contributed: false, note: null, touchedSegmentIds: [], runs: [] };
  if (row.contribution !== "contributed" || !row.userId) {
    return { ...empty, note: "Activité privée : aucune donnée collective n'en est tirée." };
  }
  const raw = rawInput ?? rawPointsOf(row.id);
  if (raw.length < 10) return { ...empty, note: "Trace trop courte pour être exploitée." };

  // 1. Vie privée : les abords du départ et de l'arrivée ne sortent jamais (section 36).
  const zones = privacyZonesOf(row.userId);
  const masked = maskTrace(raw, { zones, trimStartM: TRIM_ENDS_M, trimEndM: TRIM_ENDS_M });
  if (masked.dropped || masked.points.length < 10) {
    return { ...empty, note: "Trace trop courte une fois les abords privés écartés." };
  }

  // 2. Qualité des points (section 6) : une trace trop floue apprendrait n'importe quoi.
  const scored = scoreTrace(masked.points, row.activityType);
  const quality = traceQuality(scored);
  const usableRatio = quality.total > 0 ? quality.usable / quality.total : 0;
  if (usableRatio < MIN_USABLE_RATIO || (quality.medianAccuracyM ?? 0) > MAX_MEDIAN_ACCURACY_M) {
    db.update(activities).set({ qualityScore: quality.averageQuality, processedAt: nowIso() }).where(eq(activities.id, row.id)).run();
    return { ...empty, note: "Trace trop imprécise pour alimenter le réseau (GPS dégradé)." };
  }

  // 3. Map matching différé sur le réseau de la zone (section 7).
  const bounds = boundsOf(masked.points);
  if (!bounds) return { ...empty, note: "Trace sans emprise exploitable." };
  const segments = segmentsInBBox(bounds);
  const graph = graphForBBox(bounds);
  const index = segmentIndex(segments);
  const matched = matchTrace(usablePoints(scored), graph, row.activityType);
  const matchedRatio = matched.length > 0 ? matched.filter((m) => m.segmentId !== null).length / matched.length : 0;

  // 4. Passages et portions hors réseau (sections 9 et 19).
  const key = userKey(row.userId);
  const traversals = extractTraversals(matched, index);
  const runs = extractOffNetworkRuns(matched, { activity: row.activityType, userKey: key });

  const now = nowIso();
  db.transaction((tx) => {
    tx.delete(segmentTraversals).where(eq(segmentTraversals.activityId, row.id)).run();
    tx.delete(activityMatchedPoints).where(eq(activityMatchedPoints.activityId, row.id)).run();
    for (let i = 0; i < matched.length; i += 500) {
      const batch = matched.slice(i, i + 500).map((m) => ({
        activityId: row.id,
        seq: m.index,
        segmentId: m.segmentId,
        lat: m.lat,
        lng: m.lng,
        along: m.along,
        confidence: m.confidence,
        deviationM: Number.isFinite(m.deviationM) ? m.deviationM : null,
      }));
      if (batch.length) tx.insert(activityMatchedPoints).values(batch).onConflictDoNothing().run();
    }
    for (const t of traversals) {
      tx.insert(segmentTraversals)
        .values({
          id: newId(),
          segmentId: t.segmentId,
          activityId: row.id,
          userKey: key,
          activityType: row.activityType,
          direction: t.direction,
          enteredAt: t.enteredAt,
          exitedAt: t.exitedAt,
          durationMs: t.durationMs,
          distanceM: t.distanceM,
          coverage: t.coverage,
          averageSpeedMs: t.averageSpeedMs,
          confidence: t.confidence,
          createdAt: now,
        })
        .run();
    }
    tx.update(activities)
      .set({ processedAt: now, qualityScore: quality.averageQuality, matchedRatio })
      .where(eq(activities.id, row.id))
      .run();
  });

  const touched = [...new Set(traversals.map((t) => t.segmentId))];
  return {
    traversals: traversals.length,
    segments: touched.length,
    offNetworkRuns: runs.length,
    contributed: true,
    note: traversals.length === 0 ? "Aucun chemin connu reconnu : la trace alimentera la détection de chemins potentiels." : null,
    touchedSegmentIds: touched,
    runs,
  };
}

/** Passages d'une activité (pour son résumé personnel). */
export function traversalCount(activityId: string): number {
  const row = db
    .select({ n: sql<number>`count(distinct ${segmentTraversals.segmentId})` })
    .from(segmentTraversals)
    .where(eq(segmentTraversals.activityId, activityId))
    .get();
  return row?.n ?? 0;
}

/** Retire la contribution : les passages disparaissent des statistiques (section 35). */
export function withdrawContribution(row: ActivityRow): string[] {
  const touched = db
    .selectDistinct({ segmentId: segmentTraversals.segmentId })
    .from(segmentTraversals)
    .where(eq(segmentTraversals.activityId, row.id))
    .all()
    .map((r) => r.segmentId);
  db.transaction((tx) => {
    tx.delete(segmentTraversals).where(eq(segmentTraversals.activityId, row.id)).run();
    tx.delete(activityMatchedPoints).where(eq(activityMatchedPoints.activityId, row.id)).run();
    tx.update(activities).set({ contribution: "withdrawn", contributedAt: null, processedAt: null }).where(eq(activities.id, row.id)).run();
  });
  return touched;
}

/** Supprime définitivement une activité et tout ce qui en découle (RGPD). */
export function deleteActivity(row: ActivityRow): string[] {
  const touched = db
    .selectDistinct({ segmentId: segmentTraversals.segmentId })
    .from(segmentTraversals)
    .where(eq(segmentTraversals.activityId, row.id))
    .all()
    .map((r) => r.segmentId);
  // Les tables filles sont en cascade : une seule suppression suffit.
  db.delete(activities).where(eq(activities.id, row.id)).run();
  return touched;
}

/** Purge des traces brutes trop anciennes (section 5 : conservation temporaire). */
export function purgeOldRawTraces(now = new Date()): number {
  const days = config.rawTraceRetentionDays || RAW_TRACE_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = db
    .select({ id: activities.id })
    .from(activities)
    .where(and(isNull(activities.rawPurgedAt), sql`${activities.endedAt} < ${cutoff}`))
    .limit(500)
    .all();
  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);
  db.transaction((tx) => {
    tx.delete(activityPoints).where(inArray(activityPoints.activityId, ids)).run();
    tx.update(activities).set({ rawPurgedAt: nowIso() }).where(inArray(activities.id, ids)).run();
  });
  return ids.length;
}

export function listActivities(userId: string, limit = 50, offset = 0): { rows: ActivityRow[]; total: number } {
  const rows = db
    .select()
    .from(activities)
    .where(and(eq(activities.userId, userId), isNull(activities.deletedAt)))
    .orderBy(desc(activities.startedAt))
    .limit(limit)
    .offset(offset)
    .all();
  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(activities)
    .where(and(eq(activities.userId, userId), isNull(activities.deletedAt)))
    .get();
  return { rows, total: total?.n ?? 0 };
}

export function toActivityDto(row: ActivityRow, segmentCount = 0): ActivityDto {
  return {
    id: row.id,
    name: row.name,
    activityType: row.activityType as ActivityMode,
    source: row.source,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    distanceM: row.distanceM,
    durationMs: row.durationMs,
    movingMs: row.movingMs,
    elevationGainM: row.elevationGainM,
    elevationLossM: row.elevationLossM,
    maxAltM: row.maxAltM,
    averageSpeedMs: row.averageSpeedMs,
    pointCount: row.pointCount,
    qualityScore: row.qualityScore,
    matchedRatio: row.matchedRatio,
    contribution: row.contribution as ContributionStatus,
    contributedAt: row.contributedAt,
    processedAt: row.processedAt,
    segmentCount,
    hasRawTrace: row.rawPurgedAt === null,
  };
}

/** Seuil d'anonymat rappelé ici pour les traitements qui publient des agrégats. */
export const MIN_UNIQUE_USERS = K_ANONYMITY_MIN;

/** Met à jour la synthèse dénormalisée d'un segment (fréquentation rapide). */
export function refreshSegmentSummary(segmentId: string, passages: number, lastPassageAt: number | null, popularity: number): void {
  db.update(paths)
    .set({
      passageCount: passages,
      lastPassageAt: lastPassageAt ? new Date(lastPassageAt).toISOString() : null,
      popularityScore: popularity,
    })
    .where(eq(paths.id, segmentId))
    .run();
}

export type { SegmentTraversal };
