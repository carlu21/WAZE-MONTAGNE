import { Hono } from "hono";
import { desc, eq, inArray } from "drizzle-orm";
import {
  buildCorridor,
  compareTraces,
  clusterTraces,
  traceCompareSchema,
  traceLibraryQuerySchema,
  traceReviewSchema,
  traceUploadSchema,
  traceUrlImportSchema,
  type ComparableTrace,
  type ImportTraceResponse,
  type ImportedTraceDto,
  type TraceComparison,
  type TraceComparisonResponse,
  type TraceDetail,
  type TracesResponse,
} from "@mountain-live/core";
import { z } from "zod";
import { db } from "../db/client";
import { dataSources, importedTraces, paths, traceVersions, type ImportedTraceRow } from "../db/schema";
import { requireAuth, requireRole, type AppEnv } from "../middleware/auth";
import { readJson, readQuery } from "../middleware/validate";
import { HttpError } from "../services/errors";
import {
  deleteTrace,
  importTrace,
  legsOf,
  listTraces,
  originalFile,
  reviewTrace,
  traceById,
  addTraceVersion,
} from "../services/gpx-library";
import { refreshConfidence } from "../services/segment-knowledge";
import { fetchResource, robotsGate } from "../services/source-discovery";

/**
 * Bibliothèque GPX du back-office (sections 15, 17, 18, 20).
 *
 * Une trace entre ici par un fichier ou par une URL, jamais par un scraping :
 * l'importation par URL vérifie le robots.txt de l'hôte avant de tenter quoi
 * que ce soit, et une licence non identifiée envoie la trace en revue au lieu
 * de l'intégrer.
 */
export const adminTracesRoutes = new Hono<AppEnv>();

adminTracesRoutes.use("*", requireAuth, requireRole("moderator", "admin"));

function sourceName(id: string | null): string | null {
  if (!id) return null;
  return db.select({ name: dataSources.name }).from(dataSources).where(eq(dataSources.id, id)).get()?.name ?? null;
}

export function toTraceDto(row: ImportedTraceRow): ImportedTraceDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sourceId: row.sourceId,
    sourceName: sourceName(row.sourceId),
    origin: row.origin,
    originUrl: row.originUrl,
    format: row.format,
    licence: row.licence,
    attribution: row.attribution,
    territory: row.territory,
    activity: row.activity as ImportedTraceDto["activity"],
    distanceM: row.lengthM,
    elevationGainM: row.elevationGainM,
    elevationLossM: row.elevationLossM,
    points: row.coordinates.length,
    qualityScore: row.qualityScore,
    qualityLevel: row.qualityLevel,
    qualityFlags: row.qualityFlags as ImportedTraceDto["qualityFlags"],
    matchedRatio: row.matchedRatio,
    segmentCount: legsOf(row.id).length,
    status: row.status,
    duplicateOf: row.duplicateOf,
    version: row.version,
    recordedAt: row.recordedAt,
    importedAt: row.importedAt,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
  };
}

function importResponse(result: ReturnType<typeof importTrace>): ImportTraceResponse {
  const row = result.trace;
  return {
    trace: toTraceDto(row),
    decision: result.decision,
    summary: {
      distanceM: row.lengthM,
      elevationGainM: row.elevationGainM,
      elevationLossM: row.elevationLossM,
      points: row.coordinates.length,
      bbox: { west: row.minLng, south: row.minLat, east: row.maxLng, north: row.maxLat },
      matchedSegments: result.itinerary.legs.length,
      matchedRatio: result.itinerary.matchedRatio,
      quality: result.quality.summary,
    },
    duplicateOf: result.duplicateOf,
    note: result.note,
  };
}

adminTracesRoutes.get("/", (c) => {
  const q = readQuery(c, traceLibraryQuerySchema);
  const { rows, total } = listTraces(q);
  const body: TracesResponse = { traces: rows.map(toTraceDto), total };
  return c.json(body);
});

adminTracesRoutes.get("/:id", (c) => {
  const row = traceById(c.req.param("id"));
  if (!row) throw new HttpError(404, "not_found", "Trace introuvable");
  const legs = legsOf(row.id);
  const names = new Map<string, string | null>();
  if (legs.length > 0) {
    const ids = [...new Set(legs.map((l) => l.segmentId))];
    for (const p of db.select({ id: paths.id, name: paths.name }).from(paths).where(inArray(paths.id, ids)).all()) names.set(p.id, p.name);
  }
  const versions = db
    .select()
    .from(traceVersions)
    .where(eq(traceVersions.traceId, row.id))
    .orderBy(desc(traceVersions.version))
    .all()
    .map((v) => ({ version: v.version, lengthM: v.lengthM, changedM: v.changedM, reason: v.reason, createdAt: v.createdAt }));
  const body: TraceDetail = {
    trace: toTraceDto(row),
    coordinates: row.coordinates,
    elevations: row.elevations,
    legs: legs.map((l) => ({
      segmentId: l.segmentId,
      segmentName: names.get(l.segmentId) ?? null,
      reversed: l.reversed,
      distanceM: l.distanceM,
      coverage: l.coverage,
      deviationM: l.deviationM,
    })),
    // Les portions hors réseau sont recalculées à la demande : voir /resolve.
    gaps: [],
    versions,
  };
  return c.json(body);
});

/** Fichier d'origine (section 7) : réservé à la modération, jamais rediffusé publiquement. */
adminTracesRoutes.get("/:id/original", (c) => {
  const row = traceById(c.req.param("id"));
  if (!row) throw new HttpError(404, "not_found", "Trace introuvable");
  const content = originalFile(row.id);
  if (!content) throw new HttpError(404, "not_found", "Fichier d'origine absent");
  c.header("Content-Type", row.format === "geojson" ? "application/geo+json" : "application/xml");
  c.header("Content-Disposition", `attachment; filename="${row.fileName ?? `${row.id}.${row.format}`}"`);
  return c.body(content);
});

/** Dépôt manuel d'un fichier (section 17). */
adminTracesRoutes.post("/upload", async (c) => {
  const input = await readJson(c, traceUploadSchema);
  const user = c.get("user")!;
  const result = importTrace({
    content: input.content,
    fileName: input.fileName ?? null,
    origin: "manual_upload",
    sourceId: input.sourceId ?? null,
    territory: input.territory ?? null,
    activity: input.activity,
    licence: input.licence,
    declaredOrigin: input.declaredOrigin ?? null,
    declaredRights: input.declaredRights,
    importedBy: user.id,
  });
  if (result.trace.status === "approved") refreshConfidence(result.itinerary.legs.map((l) => l.segmentId));
  return c.json(importResponse(result), 201);
});

/** Importation depuis une URL (section 18) : robots.txt d'abord, droits ensuite. */
adminTracesRoutes.post("/import-url", async (c) => {
  const input = await readJson(c, traceUrlImportSchema);
  const user = c.get("user")!;

  const robots = await robotsGate(input.url);
  if (!robots.allowed) {
    throw new HttpError(
      403,
      "robots_disallow",
      robots.checked
        ? `Cette adresse est interdite à la collecte par le site lui-même : ${robots.detail}`
        : `Impossible de vérifier ce que le site autorise : ${robots.detail}`,
    );
  }
  const fetched = await fetchResource(input.url, { accept: "application/gpx+xml,application/xml,application/geo+json,*/*" });
  if (!fetched.ok) {
    throw new HttpError(
      fetched.reason === "blocked" ? 503 : 400,
      fetched.reason === "blocked" ? "network_unavailable" : "fetch_failed",
      fetched.reason === "blocked"
        ? "Aucun accès réseau sortant depuis ce serveur : l'importation par URL doit être relancée depuis un environnement connecté."
        : `Téléchargement impossible : ${fetched.detail}`,
    );
  }
  const result = importTrace({
    content: fetched.body,
    fileName: input.url.split("/").pop() ?? null,
    originUrl: fetched.finalUrl,
    origin: "url_import",
    sourceId: input.sourceId ?? null,
    territory: input.territory ?? null,
    activity: input.activity,
    licence: input.licence,
    declaredOrigin: input.declaredOrigin ?? null,
    declaredRights: input.declaredRights,
    importedBy: user.id,
  });
  if (result.trace.status === "approved") refreshConfidence(result.itinerary.legs.map((l) => l.segmentId));
  return c.json(importResponse(result), 201);
});

/** Nouvelle version d'une trace dont la source a changé (section 20). */
adminTracesRoutes.post("/:id/versions", async (c) => {
  const row = traceById(c.req.param("id"));
  if (!row) throw new HttpError(404, "not_found", "Trace introuvable");
  const input = await readJson(c, z.object({ content: z.string().min(20).max(8 * 1024 * 1024), reason: z.string().max(300).nullable().optional() }));
  const user = c.get("user")!;
  const { version, changedM } = addTraceVersion(row, input.content, input.reason ?? null, user.id);
  const fresh = traceById(row.id);
  return c.json({
    trace: fresh ? toTraceDto(fresh) : null,
    version,
    changedM: Math.round(changedM),
    note: `Modification de ${Math.round(changedM)} mètres du tracé.`,
  });
});

adminTracesRoutes.patch("/:id", async (c) => {
  const row = traceById(c.req.param("id"));
  if (!row) throw new HttpError(404, "not_found", "Trace introuvable");
  const input = await readJson(c, traceReviewSchema);
  const user = c.get("user")!;
  const { row: updated, attested } = reviewTrace(row, input, user.id);
  refreshConfidence(legsOf(row.id).map((l) => l.segmentId));
  return c.json({ trace: toTraceDto(updated), attested });
});

adminTracesRoutes.delete("/:id", (c) => {
  const row = traceById(c.req.param("id"));
  if (!row) throw new HttpError(404, "not_found", "Trace introuvable");
  const touched = legsOf(row.id).map((l) => l.segmentId);
  deleteTrace(row);
  refreshConfidence(touched);
  return c.body(null, 204);
});

/**
 * Comparaison de plusieurs traces d'un même parcours (section 10).
 * Ne choisit pas arbitrairement : superpose, mesure les écarts, et dit quand
 * plusieurs sources INDÉPENDANTES décrivent le même corridor.
 */
adminTracesRoutes.post("/compare", async (c) => {
  const input = await readJson(c, traceCompareSchema);
  const rows = db.select().from(importedTraces).where(inArray(importedTraces.id, input.traceIds)).all();
  if (rows.length < 2) throw new HttpError(400, "not_enough", "Au moins deux traces existantes sont nécessaires.");

  const comparable: ComparableTrace[] = rows.map((r) => ({
    id: r.id,
    coordinates: r.coordinates,
    sourceId: r.sourceId,
    layer: "imported_gpx",
    at: r.recordedAt ? Date.parse(r.recordedAt) : null,
    quality: r.qualityScore ?? 0,
  }));

  const comparisons: TraceComparison[] = [];
  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) comparisons.push(compareTraces(comparable[i], comparable[j]));
  }
  const groups = clusterTraces(comparable);
  const byId = new Map(comparable.map((t) => [t.id, t]));
  const corridors = groups
    .map((ids) => buildCorridor(ids.map((id) => byId.get(id)).filter((t): t is ComparableTrace => Boolean(t))))
    .filter((corridor): corridor is NonNullable<typeof corridor> => corridor !== null)
    .map((corridor) => ({
      id: corridor.id,
      traceIds: corridor.traceIds,
      coordinates: corridor.coordinates,
      lengthM: Math.round(corridor.lengthM),
      dispersionM: Math.round(corridor.dispersionM * 10) / 10,
      uniqueSources: corridor.uniqueSources,
      confidence: corridor.confidence,
    }));

  const body: TraceComparisonResponse = {
    comparisons,
    corridors,
    note:
      corridors.length === 0
        ? "Aucun faisceau : ces traces ne décrivent pas le même passage, ou proviennent d'une source unique."
        : null,
  };
  return c.json(body);
});
