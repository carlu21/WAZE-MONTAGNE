/**
 * Apprentissage du réseau à partir des passages (sections 17 à 21 et 27 à 30
 * du moteur cartographique).
 *
 * Ce service ne modifie JAMAIS la carte : il produit des candidatures
 * (`network_candidates`) soumises à modération. Chaque candidature porte son
 * nombre d'observations, d'utilisateurs distincts et un score de confiance ;
 * une candidature déjà tranchée conserve sa décision, seules ses statistiques
 * sont rafraîchies.
 *
 * Entrées : les traces rattachées des activités contribuées, jointes à la
 * trace brute (indispensable pour détecter un décalage de géométrie — la trace
 * rattachée, elle, est déjà collée au tracé existant). Les traces brutes étant
 * purgées après quelques mois, la détection travaille sur une fenêtre glissante ;
 * les candidatures déjà créées, elles, restent.
 */
import { and, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  detectConfusionPoints,
  detectPotentialTrails,
  detectSlowZones,
  detectTurnarounds,
  detectVariants,
  geometryCandidate,
  hashString,
  nodeKey,
  speedSamples,
  type ActivityMode,
  type CorridorTrace,
  type MatchedPoint,
  type OffNetworkRun,
  type PathObservation,
  type SegmentTraversal,
  type SessionPath,
  type SpeedSample,
  type TraversalDirection,
} from "@mountain-live/core";
import { db } from "../db/client";
import { activities, activityMatchedPoints, activityPoints, networkCandidates, paths, segmentTraversals, type NetworkCandidateRow } from "../db/schema";
import { segmentIndex, segmentsInBBox } from "./network-graph";
import { toPathSegment } from "./paths";
import { nowIso } from "./util";

/** Fenêtre d'observation (jours) : au-delà, les traces brutes sont purgées. */
export const LEARNING_WINDOW_DAYS = 180;
/** Nombre maximal d'activités relues par passe (garde-fou). */
export const MAX_ACTIVITIES_PER_RUN = 500;

interface ActivityTrace {
  activityId: string;
  activity: ActivityMode;
  userKey: string;
  at: number;
  matched: MatchedPoint[];
}

/**
 * Relit les traces rattachées récentes, en réassociant à chaque point sa
 * position BRUTE (nécessaire pour juger la géométrie) et son horodatage.
 */
function recentTraces(now: number): ActivityTrace[] {
  const cutoff = new Date(now - LEARNING_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = db
    .select({ id: activities.id, type: activities.activityType, endedAt: activities.endedAt })
    .from(activities)
    .where(and(eq(activities.contribution, "contributed"), isNotNull(activities.processedAt), isNull(activities.rawPurgedAt), gte(activities.endedAt, cutoff)))
    .limit(MAX_ACTIVITIES_PER_RUN)
    .all();
  const out: ActivityTrace[] = [];
  for (const a of rows) {
    // Le pseudonyme est porté par les passages : une activité sans passage
    // (trace entièrement hors réseau) reste exploitable pour les chemins potentiels.
    const key =
      db.select({ k: segmentTraversals.userKey }).from(segmentTraversals).where(eq(segmentTraversals.activityId, a.id)).get()?.k ?? `act:${a.id}`;
    const matchedRows = db.select().from(activityMatchedPoints).where(eq(activityMatchedPoints.activityId, a.id)).orderBy(activityMatchedPoints.seq).all();
    if (matchedRows.length === 0) continue;
    const rawRows = db.select().from(activityPoints).where(eq(activityPoints.activityId, a.id)).orderBy(activityPoints.seq).all();
    const rawBySeq = new Map(rawRows.map((r) => [r.seq, r]));
    const matched: MatchedPoint[] = [];
    for (const m of matchedRows) {
      const raw = rawBySeq.get(m.seq);
      matched.push({
        index: m.seq,
        at: raw?.at ?? 0,
        segmentId: m.segmentId,
        lat: m.lat,
        lng: m.lng,
        along: m.along,
        confidence: m.confidence,
        deviationM: m.deviationM ?? 0,
        alt: raw?.alt ?? null,
        accuracy: raw?.accuracy ?? null,
      });
    }
    out.push({ activityId: a.id, activity: a.type as ActivityMode, userKey: key, at: Date.parse(a.endedAt), matched });
  }
  return out;
}

/** Position brute d'un point (celle qui révèle un décalage de tracé). */
function rawPositions(activityId: string): Map<number, { lat: number; lng: number; accuracy: number | null }> {
  const rows = db.select().from(activityPoints).where(eq(activityPoints.activityId, activityId)).all();
  return new Map(rows.map((r) => [r.seq, { lat: r.lat, lng: r.lng, accuracy: r.accuracy }]));
}

/** Portions hors réseau reconstituées depuis la trace rattachée. */
function offNetworkRuns(traces: readonly ActivityTrace[]): OffNetworkRun[] {
  const runs: OffNetworkRun[] = [];
  for (const t of traces) {
    let current: MatchedPoint[] = [];
    const flush = () => {
      if (current.length >= 5) {
        const points = current.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at, accuracy: p.accuracy }));
        let length = 0;
        for (let i = 1; i < points.length; i++) {
          const dLat = (points[i].lat - points[i - 1].lat) * 111_320;
          const dLng = (points[i].lng - points[i - 1].lng) * 111_320 * Math.cos((points[i].lat * Math.PI) / 180);
          length += Math.hypot(dLat, dLng);
        }
        if (length >= 80) {
          runs.push({
            userKey: t.userKey,
            activity: t.activity,
            at: t.at,
            fromIndex: current[0].index,
            toIndex: current[current.length - 1].index,
            lengthM: length,
            points,
          });
        }
      }
      current = [];
    };
    for (const p of t.matched) {
      if (p.segmentId === null) current.push(p);
      else flush();
    }
    flush();
  }
  return runs;
}

/** Sessions (suites de passages d'une même activité) pour l'analyse des comportements. */
function sessions(now: number): SessionPath[] {
  const cutoff = now - LEARNING_WINDOW_DAYS * 86_400_000;
  const rows = db
    .select()
    .from(segmentTraversals)
    .where(gte(segmentTraversals.exitedAt, cutoff))
    .orderBy(segmentTraversals.activityId, segmentTraversals.enteredAt)
    .all();
  const byActivity = new Map<string, { userKey: string; activity: ActivityMode; at: number; traversals: SegmentTraversal[] }>();
  for (const r of rows) {
    const entry = byActivity.get(r.activityId) ?? { userKey: r.userKey, activity: r.activityType as ActivityMode, at: r.exitedAt, traversals: [] };
    entry.traversals.push({
      segmentId: r.segmentId,
      direction: r.direction as TraversalDirection,
      enteredAt: r.enteredAt,
      exitedAt: r.exitedAt,
      durationMs: r.durationMs,
      coverage: r.coverage,
      distanceM: r.distanceM,
      averageSpeedMs: r.averageSpeedMs ?? 0,
      points: 0,
      confidence: r.confidence,
    });
    entry.at = Math.max(entry.at, r.exitedAt);
    byActivity.set(r.activityId, entry);
  }
  return [...byActivity.values()].map((e) => ({ userKey: e.userKey, activity: e.activity, at: e.at, traversals: e.traversals }));
}

/** Itinéraires observés entre deux nœuds (matière première des variantes). */
function pathObservations(sess: readonly SessionPath[]): PathObservation[] {
  const out: PathObservation[] = [];
  const segments = new Map<string, { start: string | null; end: string | null }>();
  const rows = db.select({ id: paths.id, start: paths.startNode, end: paths.endNode }).from(paths).all();
  for (const r of rows) segments.set(r.id, { start: r.start, end: r.end });
  for (const s of sess) {
    if (s.traversals.length < 2) continue;
    const first = segments.get(s.traversals[0].segmentId);
    const last = segments.get(s.traversals[s.traversals.length - 1].segmentId);
    if (!first || !last) continue;
    const fromNode = (s.traversals[0].direction === "forward" ? first.start : first.end) ?? "";
    const toNode = (s.traversals[s.traversals.length - 1].direction === "forward" ? last.end : last.start) ?? "";
    if (!fromNode || !toNode || fromNode === toNode) continue;
    out.push({
      fromNode,
      toNode,
      segmentIds: s.traversals.map((t) => t.segmentId),
      distanceM: s.traversals.reduce((n, t) => n + t.distanceM, 0),
      durationMs: s.traversals.reduce((n, t) => n + t.durationMs, 0),
      userKey: s.userKey,
      at: s.at,
    });
  }
  return out;
}

interface CandidateInput {
  id: string;
  kind: NetworkCandidateRow["kind"];
  segmentId?: string | null;
  geometry?: [number, number][] | null;
  detail: Record<string, unknown>;
  observations: number;
  uniqueUsers: number;
  confidence: number;
  firstSeenAt?: number | null;
  lastSeenAt?: number | null;
}

function bboxOf(geometry: [number, number][] | null | undefined): { minLat: number; minLng: number; maxLat: number; maxLng: number } | null {
  if (!geometry || geometry.length === 0) return null;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [lng, lat] of geometry) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return { minLat, minLng, maxLat, maxLng };
}

/** Enregistre une candidature en conservant toute décision humaine déjà prise. */
function upsertCandidate(input: CandidateInput, now: string): "created" | "updated" {
  const existing = db.select().from(networkCandidates).where(eq(networkCandidates.id, input.id)).get();
  const box = bboxOf(input.geometry ?? null);
  const values = {
    id: input.id,
    kind: input.kind,
    segmentId: input.segmentId ?? null,
    geometry: input.geometry ?? null,
    detail: input.detail,
    observations: input.observations,
    uniqueUsers: input.uniqueUsers,
    confidence: input.confidence,
    status: existing?.status ?? ("open" as const),
    firstSeenAt: input.firstSeenAt ?? existing?.firstSeenAt ?? null,
    lastSeenAt: input.lastSeenAt ?? null,
    minLat: box?.minLat ?? null,
    minLng: box?.minLng ?? null,
    maxLat: box?.maxLat ?? null,
    maxLng: box?.maxLng ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    reviewedBy: existing?.reviewedBy ?? null,
    reviewedAt: existing?.reviewedAt ?? null,
    reviewNote: existing?.reviewNote ?? null,
  };
  db.insert(networkCandidates).values(values).onConflictDoUpdate({ target: networkCandidates.id, set: values }).run();
  return existing ? "updated" : "created";
}

export interface RebuildResult {
  created: number;
  updated: number;
  byKind: Record<string, number>;
}

/** Recalcule l'ensemble des candidatures à partir des passages récents. */
export function rebuildCandidates(now = Date.now()): RebuildResult {
  const traces = recentTraces(now);
  const sess = sessions(now);
  const result: RebuildResult = { created: 0, updated: 0, byKind: {} };
  const stamp = nowIso();
  const record = (r: "created" | "updated", kind: string) => {
    result[r] += 1;
    result.byKind[kind] = (result.byKind[kind] ?? 0) + 1;
  };

  // 1. Chemins potentiels : corridors empruntés hors de tout chemin connu (section 19).
  for (const trail of detectPotentialTrails(offNetworkRuns(traces), {}, now)) {
    record(
      upsertCandidate(
        {
          id: `nt_${trail.id}`,
          kind: "new_trail",
          geometry: trail.coordinates.map((c) => [c[0], c[1]] as [number, number]),
          detail: { lengthM: Math.round(trail.lengthM), dispersionM: Math.round(trail.dispersionM * 10) / 10, activityMix: trail.activityMix },
          observations: trail.observations,
          uniqueUsers: trail.uniqueUsers,
          confidence: trail.confidence,
          firstSeenAt: trail.firstSeenAt,
          lastSeenAt: trail.lastSeenAt,
        },
        stamp,
      ),
      "new_trail",
    );
  }

  // 2. Géométries à corriger : faisceau systématiquement décalé (sections 17 et 18).
  const bySegment = new Map<string, CorridorTrace[]>();
  for (const t of traces) {
    const raw = rawPositions(t.activityId);
    const grouped = new Map<string, { lat: number; lng: number; accuracy: number | null }[]>();
    for (const p of t.matched) {
      if (!p.segmentId) continue;
      const position = raw.get(p.index);
      if (!position) continue;
      const list = grouped.get(p.segmentId) ?? [];
      list.push(position);
      grouped.set(p.segmentId, list);
    }
    for (const [segmentId, points] of grouped) {
      if (points.length < 5) continue;
      const list = bySegment.get(segmentId) ?? [];
      list.push({ userKey: t.userKey, activity: t.activity, at: t.at, points });
      bySegment.set(segmentId, list);
    }
  }
  for (const [segmentId, corridorTraces] of bySegment) {
    if (corridorTraces.length < 8) continue;
    const row = db.select().from(paths).where(eq(paths.id, segmentId)).get();
    if (!row) continue;
    const candidate = geometryCandidate(toPathSegment(row), corridorTraces);
    if (!candidate) continue;
    record(
      upsertCandidate(
        {
          id: `geo_${segmentId}`,
          kind: "geometry",
          segmentId,
          geometry: candidate.coordinates.map((c) => [c[0], c[1]] as [number, number]),
          detail: {
            offsetM: Math.round(candidate.offsetM * 10) / 10,
            maxOffsetM: Math.round(candidate.maxOffsetM * 10) / 10,
            dispersionM: Math.round(candidate.dispersionM * 10) / 10,
          },
          observations: candidate.observations,
          uniqueUsers: candidate.uniqueUsers,
          confidence: candidate.confidence,
          firstSeenAt: candidate.firstSeenAt,
          lastSeenAt: candidate.lastSeenAt,
        },
        stamp,
      ),
      "geometry",
    );
  }

  // 3. Comportements : ralentissements, demi-tours, intersections confuses (sections 27 à 29).
  const samples: SpeedSample[] = [];
  for (const t of traces) samples.push(...speedSamples(t.matched, { activity: t.activity, userKey: t.userKey }));
  for (const zone of detectSlowZones(samples)) {
    record(
      upsertCandidate(
        {
          id: `sz_${zone.segmentId}_${Math.round(zone.fromAlong)}`,
          kind: "slow_zone",
          segmentId: zone.segmentId,
          detail: {
            fromAlong: Math.round(zone.fromAlong),
            toAlong: Math.round(zone.toAlong),
            speedKmh: Math.round(zone.speedMs * 3.6 * 10) / 10,
            referenceKmh: Math.round(zone.referenceSpeedMs * 3.6 * 10) / 10,
            ratio: Math.round(zone.ratio * 100) / 100,
          },
          observations: zone.observations,
          uniqueUsers: zone.uniqueUsers,
          confidence: zone.confidence,
          lastSeenAt: now,
        },
        stamp,
      ),
      "slow_zone",
    );
  }

  const segmentsForBehaviour = segmentIndex(
    (() => {
      const ids = [...new Set(sess.flatMap((s) => s.traversals.map((t) => t.segmentId)))];
      const out = [];
      for (let i = 0; i < ids.length; i += 400) {
        out.push(...db.select().from(paths).where(inArray(paths.id, ids.slice(i, i + 400))).all().map(toPathSegment));
      }
      return out;
    })(),
  );

  for (const spot of detectTurnarounds(sess, segmentsForBehaviour)) {
    record(
      upsertCandidate(
        {
          id: `ta_${spot.segmentId}_${Math.round(spot.along)}`,
          kind: "turnaround",
          segmentId: spot.segmentId,
          geometry: [[spot.lng, spot.lat]],
          detail: { along: Math.round(spot.along), rate: Math.round(spot.rate * 100) / 100 },
          observations: spot.observations,
          uniqueUsers: spot.uniqueUsers,
          confidence: spot.confidence,
          lastSeenAt: now,
        },
        stamp,
      ),
      "turnaround",
    );
  }

  for (const point of detectConfusionPoints(sess, segmentsForBehaviour)) {
    record(
      upsertCandidate(
        {
          id: `cf_${hashString(point.nodeKey).toString(36)}`,
          kind: "confusion",
          geometry: [[point.lng, point.lat]],
          detail: { nodeKey: point.nodeKey, rate: Math.round(point.rate * 100) / 100, wrongSegmentIds: point.wrongSegmentIds.slice(0, 5) },
          observations: point.observations,
          uniqueUsers: point.uniqueUsers,
          confidence: point.confidence,
          lastSeenAt: now,
        },
        stamp,
      ),
      "confusion",
    );
  }

  // 4. Variantes réellement empruntées entre deux mêmes points (section 21).
  const variants = detectVariants(pathObservations(sess));
  for (const v of variants) {
    if (v.share >= 0.95) continue; // une seule façon d'y aller : ce n'est pas une variante
    record(
      upsertCandidate(
        {
          id: `var_${hashString(`${v.fromNode}|${v.toNode}|${v.segmentIds.join(",")}`).toString(36)}`,
          kind: "variant",
          detail: {
            fromNode: v.fromNode,
            toNode: v.toNode,
            segmentIds: v.segmentIds.slice(0, 40),
            distanceM: Math.round(v.distanceM),
            medianDurationMs: v.medianDurationMs,
            share: Math.round(v.share * 100) / 100,
          },
          observations: v.passages,
          uniqueUsers: v.uniqueUsers,
          confidence: Math.min(1, v.uniqueUsers / 10),
          lastSeenAt: now,
        },
        stamp,
      ),
      "variant",
    );
  }

  // 5. Chemins peut-être abandonnés (section 30) : signalé, jamais conclu.
  const stale = db
    .select({ id: paths.id, last: paths.lastPassageAt, count: paths.passageCount })
    .from(paths)
    .where(and(sql`${paths.passageCount} >= 10`, isNotNull(paths.lastPassageAt), sql`${paths.lastPassageAt} < ${new Date(now - 365 * 86_400_000).toISOString()}`))
    .limit(200)
    .all();
  for (const s of stale) {
    record(
      upsertCandidate(
        {
          id: `in_${s.id}`,
          kind: "inactive",
          segmentId: s.id,
          detail: { lastPassageAt: s.last, passages: s.count },
          observations: s.count,
          uniqueUsers: 0,
          confidence: 0.5,
          lastSeenAt: s.last ? Date.parse(s.last) : null,
        },
        stamp,
      ),
      "inactive",
    );
  }

  return result;
}

export function listCandidates(filter: { kind?: string; status?: string; limit?: number } = {}): NetworkCandidateRow[] {
  const conds = [];
  if (filter.kind) conds.push(eq(networkCandidates.kind, filter.kind as NetworkCandidateRow["kind"]));
  if (filter.status) conds.push(eq(networkCandidates.status, filter.status as NetworkCandidateRow["status"]));
  return db
    .select()
    .from(networkCandidates)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${networkCandidates.confidence} DESC`, sql`${networkCandidates.observations} DESC`)
    .limit(Math.min(filter.limit ?? 100, 500))
    .all();
}

export function countOpenByKind(): Record<string, number> {
  const rows = db
    .select({ kind: networkCandidates.kind, n: sql<number>`count(*)` })
    .from(networkCandidates)
    .where(eq(networkCandidates.status, "open"))
    .groupBy(networkCandidates.kind)
    .all();
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}
