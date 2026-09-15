import { Hono } from "hono";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import {
  buildRoutingGraph,
  describeFrequentation,
  estimateTime,
  heatmapQuerySchema,
  isPublishable,
  planRoutes,
  redactStatistics,
  routePlanSchema,
  segmentProfile,
  theoreticalTimeMs,
  timeConfidence,
  type ActivityMode,
  type HeatmapResponse,
  type NetworkCandidateDto,
  type NetworkCandidatesResponse,
  type NetworkOverview,
  type RoutePlanResponse,
  type RoutingSegmentInput,
  type SegmentDetail,
  type SegmentNote,
  type SegmentSourcesResponse,
  type SegmentStatistics,
  type SegmentTimeDto,
  type TraversalDirection,
} from "@mountain-live/core";
import { z } from "zod";
import { db } from "../db/client";
import { activities, networkCandidates, paths, segmentTraversals, trails, type NetworkCandidateRow } from "../db/schema";
import { optionalAuth, type AppEnv } from "../middleware/auth";
import { readJson, readQuery } from "../middleware/validate";
import { HttpError } from "../services/errors";
import { boundsOf, segmentsInBBox } from "../services/network-graph";
import { countOpenByKind, listCandidates } from "../services/network-learning";
import { coverageInBBox, heatmap, overallStatistics, publishableStatistics, rowToStatistics } from "../services/network-stats";
import { knowledgeCard, sourcesOf } from "../services/segment-knowledge";
import { toPathSegment } from "../services/paths";
import { listVisibleReports } from "../services/reports";
import { nowIso } from "../services/util";

/**
 * Lecture du réseau vivant : fiche d'un chemin, carte de fréquentation,
 * itinéraires multicritères, synthèse analytique, candidatures.
 *
 * Tout est agrégé : aucune de ces routes ne peut révéler le passage d'une
 * personne identifiable (section 34). Sous le seuil d'utilisateurs distincts,
 * les statistiques sont neutralisées avant d'être servies.
 */
export const networkRoutes = new Hono<AppEnv>();

const ACTIVITIES: ActivityMode[] = ["hiking", "trail", "mtb", "equestrian", "other"];

networkRoutes.get("/segments/:id", (c) => {
  const row = db.select().from(paths).where(eq(paths.id, c.req.param("id"))).get();
  if (!row) throw new HttpError(404, "not_found", "Chemin introuvable");
  const segment = toPathSegment(row);
  const stats = publishableStatistics(segment.id);
  const overall =
    stats.find((s) => s.activity === "all" && s.direction === "both") ??
    ({
      segmentId: segment.id,
      activity: "all",
      direction: "both",
      passages: { last7: 0, last30: 0, last365: 0, total: 0 },
      uniqueSessions: 0,
      uniqueUsers: 0,
      duration: null,
      averageSpeedMs: null,
      firstPassageAt: null,
      lastPassageAt: null,
      popularityScore: 0,
      frequentation: "unknown",
      confidence: 0,
      insufficientData: true,
      activityMix: {},
      monthly: {},
      hourly: {},
      trend: null,
      possiblyInactive: false,
    } satisfies SegmentStatistics);

  // Temps par activité et par sens (sections 14 et 15).
  const times: SegmentTimeDto[] = [];
  for (const activity of ACTIVITIES) {
    for (const direction of ["forward", "backward"] as TraversalDirection[]) {
      const profile = segmentProfile(segment, direction);
      const theoretical = theoreticalTimeMs(profile, activity);
      const observed = stats.find((s) => s.activity === activity && s.direction === direction)?.duration ?? null;
      if (!observed && activity !== "hiking") continue; // sans observation, une seule estimation suffit
      const estimate = estimateTime({ theoreticalMs: theoretical, observed });
      times.push({
        activity,
        direction,
        ms: estimate.ms,
        observedMs: observed ? observed.medianMs : null,
        theoreticalMs: theoretical,
        samples: observed?.count ?? 0,
        confidence: timeConfidence(observed),
        observedWeight: estimate.observedWeight,
      });
    }
  }

  // Observations comportementales publiées sur ce segment (sections 27 à 29).
  const notes: SegmentNote[] = db
    .select()
    .from(networkCandidates)
    .where(and(eq(networkCandidates.segmentId, segment.id), inArray(networkCandidates.kind, ["slow_zone", "turnaround"])))
    .all()
    .filter((k) => k.status !== "rejected" && k.uniqueUsers >= 3)
    .map((k) => {
      const detail = (k.detail ?? {}) as Record<string, number>;
      if (k.kind === "slow_zone") {
        return {
          kind: "slow_zone" as const,
          label: "Ralentissement observé",
          detail: `Vitesse divisée par ${Math.max(1, Math.round((1 / Math.max(0.05, detail.ratio ?? 0.5)) * 10) / 10)} sur environ ${Math.max(0, Math.round((detail.toAlong ?? 0) - (detail.fromAlong ?? 0)))} m.`,
          along: detail.fromAlong ?? null,
          confidence: k.confidence,
        };
      }
      return {
        kind: "turnaround" as const,
        label: "Demi-tours fréquents",
        detail: `${Math.round((detail.rate ?? 0) * 100)} % des passages font demi-tour à cet endroit.`,
        along: detail.along ?? null,
        confidence: k.confidence,
      };
    });

  const trail = row.trailId ? db.select({ name: trails.name }).from(trails).where(eq(trails.id, row.trailId)).get() : null;
  const box = boundsOf(segment.coordinates.map((c2) => ({ lat: c2[1], lng: c2[0] })));
  const reportCount = box ? listVisibleReports({ bbox: box, limit: 200 }).length : 0;

  const body: SegmentDetail = {
    segment,
    profile: segmentProfile(segment, "forward"),
    overall,
    byActivity: stats.filter((s) => s.activity !== "all" && s.direction === "both"),
    times,
    frequentation: overall.frequentation,
    frequentationLabel: describeFrequentation(overall),
    trailName: trail?.name ?? null,
    reportCount,
    notes,
  };
  return c.json(body);
});

/**
 * Provenance et fiabilité d'un chemin (section 30 du cahier des charges GPX) :
 * d'où vient cette géométrie, qui l'atteste, quels itinéraires l'empruntent,
 * quelle confiance lui accorder — et, seulement au-delà du seuil d'anonymat,
 * ce que l'usage réel en dit.
 */
networkRoutes.get("/segments/:id/sources", (c) => {
  const id = c.req.param("id");
  const card = knowledgeCard(id);
  if (!card) throw new HttpError(404, "not_found", "Chemin introuvable");
  const sources = sourcesOf(id);
  const attributions = sources
    .map((s) => s.attribution ?? `${s.name} (${s.licence})`)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const body: SegmentSourcesResponse = {
    segmentId: id,
    name: card.name,
    geometry: card.geometry,
    confidence: card.confidence,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type as SegmentSourcesResponse["sources"][number]["type"],
      licence: s.licence as SegmentSourcesResponse["sources"][number]["licence"],
      attribution: s.attribution,
    })),
    itineraries: card.itineraries.map((i) => ({ id: i.id, name: i.name })),
    lastValidatedAt: card.lastValidatedAt ? new Date(card.lastValidatedAt).toISOString() : null,
    usage: card.usage,
    summary: card.summary,
    attributions,
  };
  c.header("Cache-Control", "public, max-age=300");
  return c.json(body);
});

networkRoutes.get("/heatmap", (c) => {
  const q = readQuery(c, heatmapQuerySchema);
  const now = Date.now();
  const segments = heatmap(q.bbox, q.period, q.activity, now);
  const coverage = coverageInBBox(q.bbox);
  const body: HeatmapResponse = {
    period: q.period,
    activity: q.activity,
    segments,
    maxPassages: segments.reduce((n, s) => Math.max(n, s.passages), 0),
    coverage: coverage.total > 0 ? coverage.withData / coverage.total : 0,
    generatedAt: new Date(now).toISOString(),
  };
  c.header("Cache-Control", "public, max-age=120");
  return c.json(body);
});

networkRoutes.post("/routes", async (c) => {
  const input = await readJson(c, routePlanSchema);
  // Emprise de travail : le rectangle englobant les deux points, élargi.
  const box = boundsOf([input.from, input.to]);
  if (!box) throw new HttpError(400, "bad_request", "Points de départ et d'arrivée invalides");
  const segments = segmentsInBBox({
    west: box.west - 0.05,
    south: box.south - 0.04,
    east: box.east + 0.05,
    north: box.north + 0.04,
  });
  const inputs: RoutingSegmentInput[] = segments.map((segment) => {
    const stats = publishableStatistics(segment.id);
    return {
      segment,
      profile: segmentProfile(segment, "forward"),
      statsForward: stats.find((s) => s.activity === "all" && s.direction === "forward") ?? null,
      statsBackward: stats.find((s) => s.activity === "all" && s.direction === "backward") ?? null,
    };
  });
  const graph = buildRoutingGraph(inputs);
  const options = planRoutes(graph, input.from, input.to, { activity: input.activity, criteria: input.criteria });
  const body: RoutePlanResponse = {
    options,
    unreachable: options.length === 0,
    note:
      options.length === 0
        ? segments.length === 0
          ? "Aucun chemin connu dans cette zone : importez le réseau ou téléchargez la zone."
          : "Aucun itinéraire ne relie ces deux points sur le réseau connu."
        : null,
  };
  return c.json(body);
});

networkRoutes.get("/overview", optionalAuth, (c) => {
  const q = readQuery(c, z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() }));
  const to = q.to ? Date.parse(q.to) : Date.now();
  const from = q.from ? Date.parse(q.from) : to - 365 * 86_400_000;
  const traversals = db.select().from(segmentTraversals).where(and(gte(segmentTraversals.exitedAt, from), sql`${segmentTraversals.exitedAt} <= ${to}`)).all();
  const byActivity: Record<string, number> = {};
  const monthly: Record<string, number> = {};
  const hourly: Record<string, number> = {};
  const users = new Set<string>();
  let distance = 0;
  for (const t of traversals) {
    byActivity[t.activityType] = (byActivity[t.activityType] ?? 0) + 1;
    const d = new Date(t.exitedAt);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthly[month] = (monthly[month] ?? 0) + 1;
    hourly[String(d.getHours())] = (hourly[String(d.getHours())] ?? 0) + 1;
    users.add(t.userKey);
    distance += t.distanceM;
  }
  const segmentsTotal = db.select({ n: sql<number>`count(*)` }).from(paths).get()?.n ?? 0;
  const segmentsWithData = db.select({ n: sql<number>`count(*)` }).from(paths).where(sql`${paths.passageCount} > 0`).get()?.n ?? 0;
  const activitiesCount =
    db
      .select({ n: sql<number>`count(*)` })
      .from(activities)
      .where(and(eq(activities.contribution, "contributed"), isNotNull(activities.processedAt)))
      .get()?.n ?? 0;
  const top = db
    .select({ id: paths.id, name: paths.name, passages: paths.passageCount, popularity: paths.popularityScore })
    .from(paths)
    .where(sql`${paths.passageCount} > 0`)
    .orderBy(desc(paths.passageCount))
    .limit(15)
    .all();
  const potential = db
    .select()
    .from(networkCandidates)
    .where(and(eq(networkCandidates.kind, "new_trail"), eq(networkCandidates.status, "open")))
    .orderBy(desc(networkCandidates.confidence))
    .limit(10)
    .all();

  const body: NetworkOverview = {
    period: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    segmentsWithData,
    segmentsTotal,
    activitiesCount,
    // Contributeurs distincts, et jamais moins de ce que l'anonymat autorise à publier.
    contributorsCount: users.size,
    passagesCount: traversals.length,
    distanceM: Math.round(distance),
    byActivity,
    monthly,
    hourly,
    topSegments: top.map((t) => ({ segmentId: t.id, name: t.name, passages: t.passages, popularityScore: t.popularity })),
    openCandidates: countOpenByKind(),
    potentialTrails: potential.map((p) => ({
      id: p.id,
      coordinates: (p.geometry ?? []) as [number, number][],
      lengthM: Number((p.detail as Record<string, number> | null)?.lengthM ?? 0),
      observations: p.observations,
      uniqueUsers: p.uniqueUsers,
      firstSeenAt: p.firstSeenAt ?? 0,
      lastSeenAt: p.lastSeenAt ?? 0,
      dispersionM: Number((p.detail as Record<string, number> | null)?.dispersionM ?? 0),
      activityMix: ((p.detail as Record<string, unknown> | null)?.activityMix ?? {}) as Partial<Record<ActivityMode, number>>,
      confidence: p.confidence,
    })),
  };
  return c.json(body);
});

export function toCandidateDto(row: NetworkCandidateRow, segmentName: string | null = null): NetworkCandidateDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    segmentId: row.segmentId,
    segmentName,
    coordinates: row.geometry,
    observations: row.observations,
    uniqueUsers: row.uniqueUsers,
    confidence: row.confidence,
    firstSeenAt: row.firstSeenAt ? new Date(row.firstSeenAt).toISOString() : null,
    lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
  };
}

networkRoutes.get("/candidates", (c) => {
  const q = readQuery(c, z.object({ kind: z.string().optional(), status: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }));
  const rows = listCandidates(q);
  const names = new Map<string, string | null>();
  const ids = rows.map((r) => r.segmentId).filter((x): x is string => Boolean(x));
  if (ids.length) {
    for (const p of db.select({ id: paths.id, name: paths.name }).from(paths).where(inArray(paths.id, ids)).all()) names.set(p.id, p.name);
  }
  const body: NetworkCandidatesResponse = {
    candidates: rows.map((r) => toCandidateDto(r, r.segmentId ? (names.get(r.segmentId) ?? null) : null)),
    total: rows.length,
    openByKind: countOpenByKind(),
  };
  return c.json(body);
});

/** Horodatage de service, utile aux clients pour dater un cache. */
networkRoutes.get("/status", (c) => c.json({ generatedAt: nowIso() }));
