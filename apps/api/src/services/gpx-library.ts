/**
 * Bibliothèque des traces importées (sections 6 à 10, 15, 17, 18, 20).
 *
 * Le pipeline, dans l'ordre, et aucune étape n'est facultative :
 *
 *   fichier ou URL
 *     → VÉRIFICATION DES DROITS (la seule qui peut tout arrêter)
 *     → analyse (GPX / KML / GeoJSON), fichier d'origine conservé
 *     → normalisation (validation, nettoyage, coupures préservées)
 *     → contrôle qualité
 *     → détection de doublon géométrique
 *     → rattachement au réseau : l'itinéraire devient une suite de segments
 *     → attestations : chaque segment emprunté sait qu'une source de plus l'atteste
 *
 * Ce qui n'est PAS fait ici, volontairement : modifier la carte. Une trace
 * importée n'écrase jamais une géométrie (section 24 : un GPX est une
 * observation, pas la vérité). Elle alimente la confiance et, quand elle
 * révèle un écart ou un chemin absent, une proposition de modération.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  MIN_USABLE_QUALITY_SCORE,
  attributionLine,
  gpxQuality,
  normalizeTrace,
  parseTraceFile,
  polylineLengthM,
  resolveItinerary,
  reuseDecision,
  traceHash,
  type ActivityMode,
  type GpxQualityReport,
  type LicenceId,
  type NormalizedTrace,
  type ParsedTrace,
  type ResolvedItinerary,
  type ReuseDecision,
} from "@mountain-live/core";
import { db } from "../db/client";
import {
  dataSources,
  importedTraceFiles,
  importedTraces,
  paths,
  segmentAttestations,
  traceSegments,
  traceVersions,
  type DataSourceRow,
  type ImportedTraceRow,
  type TraceOrigin,
} from "../db/schema";
import { boundsOf, segmentsInBBox } from "./network-graph";
import { toDataSource } from "./sources";
import { HttpError } from "./errors";
import { newId, nowIso } from "./util";

/** Taille maximale d'un fichier accepté (octets) : au-delà, c'est un jeu de données, pas une trace. */
export const MAX_TRACE_BYTES = 8 * 1024 * 1024;

/** Marge (degrés) autour de la trace pour charger le réseau de la zone. */
const NETWORK_MARGIN_DEG = 0.02;

export interface ImportInput {
  content: string;
  fileName?: string | null;
  originUrl?: string | null;
  origin: TraceOrigin;
  sourceId?: string | null;
  discoveryId?: string | null;
  territory?: string | null;
  activity?: ActivityMode | "all";
  /** Provenance déclarée par le déposant (section 17). */
  declaredOrigin?: string | null;
  /** Le déposant affirme disposer des droits (section 17). Sans source connue, c'est tout ce qu'on a. */
  declaredRights?: boolean;
  licence?: LicenceId;
  importedBy?: string | null;
}

export interface ImportResult {
  trace: ImportedTraceRow;
  quality: GpxQualityReport;
  itinerary: ResolvedItinerary;
  decision: ReuseDecision;
  /** Trace déjà présente dont celle-ci est un doublon géométrique. */
  duplicateOf: string | null;
  /** Ce qui empêche l'exploitation, en clair. */
  note: string | null;
}

/**
 * Droits d'exploitation de ce qui arrive. Sans source enregistrée, la licence
 * déclarée par le déposant ne suffit pas à approuver quoi que ce soit : le
 * dépôt part en revue. C'est la garantie de la section 3.
 */
export function importDecision(input: { sourceRow?: DataSourceRow | null; licence?: LicenceId; declaredRights?: boolean }): ReuseDecision {
  const source = input.sourceRow;
  if (source) {
    return reuseDecision({
      licence: input.licence ?? source.licence,
      sourceStatus: source.status,
      attributionText: source.attributionText,
      sourceName: source.name,
    });
  }
  return reuseDecision({
    licence: input.licence ?? "unknown",
    // Un dépôt manuel sans source enregistrée n'est jamais « approuvé » d'office :
    // la déclaration de droits engage son auteur, elle ne vaut pas vérification.
    sourceStatus: "review_required",
  });
}

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

/** Recherche une trace déjà importée décrivant la même géométrie (section 10). */
export function findDuplicate(hash: string, excludeId?: string): ImportedTraceRow | undefined {
  const rows = db.select().from(importedTraces).where(eq(importedTraces.geometryHash, hash)).all();
  return rows.find((r) => r.id !== excludeId);
}

/** Réseau connu autour d'une trace, pour le rattachement (section 6). */
function networkAround(trace: NormalizedTrace) {
  const box = {
    west: trace.bbox.west - NETWORK_MARGIN_DEG,
    south: trace.bbox.south - NETWORK_MARGIN_DEG,
    east: trace.bbox.east + NETWORK_MARGIN_DEG,
    north: trace.bbox.north + NETWORK_MARGIN_DEG,
  };
  return segmentsInBBox(box);
}

/**
 * Importe une trace. L'analyse a toujours lieu (même si les droits manquent :
 * l'administrateur doit pouvoir voir ce dont il s'agit avant de trancher),
 * mais rien n'est rattaché au réseau tant que la décision n'est pas favorable.
 */
export function importTrace(input: ImportInput): ImportResult {
  if (input.content.length > MAX_TRACE_BYTES) {
    throw new HttpError(413, "too_large", "Fichier trop volumineux : 8 Mo au maximum.");
  }
  const parsed: ParsedTrace | null = parseTraceFile(input.content, { fileName: input.fileName ?? null });
  if (!parsed) throw new HttpError(400, "bad_file", "Fichier illisible : ni GPX, ni KML, ni GeoJSON exploitable.");

  const normalized = normalizeTrace(parsed);
  if (!normalized) throw new HttpError(400, "empty_trace", "Aucune géométrie exploitable dans ce fichier.");

  const sourceRow = input.sourceId ? db.select().from(dataSources).where(eq(dataSources.id, input.sourceId)).get() ?? null : null;
  // La mention de copyright du fichier lui-même est un indice de licence.
  const licence = input.licence ?? sourceRow?.licence ?? "unknown";
  const decision = importDecision({ sourceRow, licence, declaredRights: input.declaredRights });

  const quality = gpxQuality(normalized, { source: sourceRow ? { reliabilityScore: sourceRow.reliabilityScore } : null });

  const hash = traceHash(normalized);
  const duplicate = findDuplicate(hash);

  // Rattachement au réseau : seulement si la trace est exploitable. Une trace
  // médiocre n'a rien à dire du tracé des chemins (section 9).
  const usable = quality.usable && quality.score >= MIN_USABLE_QUALITY_SCORE;
  const itinerary: ResolvedItinerary = usable
    ? resolveItinerary(normalized, networkAround(normalized), { traceId: "pending" })
    : { traceId: "pending", legs: [], matchedM: 0, unmatchedM: normalized.lengthM, matchedRatio: 0, gaps: [] };

  const id = newId();
  const now = nowIso();
  const attribution = sourceRow ? attributionLine(toDataSource(sourceRow)) : null;
  const recordedAt = parsed.metadata.time ?? normalized.times?.[0] ?? null;

  const row: ImportedTraceRow = {
    id,
    name: parsed.metadata.name ?? parsed.tracks[0]?.name ?? input.fileName ?? null,
    description: parsed.metadata.description ?? null,
    sourceId: input.sourceId ?? null,
    discoveryId: input.discoveryId ?? null,
    origin: input.origin,
    originUrl: input.originUrl ?? null,
    fileName: input.fileName ?? null,
    format: parsed.format,
    licence,
    attribution,
    territory: input.territory ?? null,
    activity: input.activity ?? "all",
    coordinates: normalized.coordinates.map((c) => [c[0], c[1]] as [number, number]),
    elevations: normalized.elevations,
    times: normalized.times,
    breaks: normalized.breaks,
    waypoints: parsed.waypoints,
    metadata: {
      ...parsed.metadata,
      // La provenance déclarée par le déposant fait partie de la preuve.
      declaredOrigin: input.declaredOrigin ?? null,
      declaredRights: input.declaredRights ?? false,
    } as ImportedTraceRow["metadata"],
    lengthM: Math.round(normalized.lengthM),
    elevationGainM: normalized.elevationGainM,
    elevationLossM: normalized.elevationLossM,
    minLat: normalized.bbox.south,
    minLng: normalized.bbox.west,
    maxLat: normalized.bbox.north,
    maxLng: normalized.bbox.east,
    qualityScore: quality.score,
    qualityLevel: quality.level,
    qualityFlags: quality.flags,
    matchedRatio: itinerary.matchedRatio,
    geometryHash: hash,
    duplicateOf: duplicate?.id ?? null,
    // Seule une décision favorable ET une qualité suffisante donnent « approved ».
    status: decision.status === "approved" && usable && !duplicate ? "approved" : "review_required",
    version: 1,
    recordedAt: recordedAt ? new Date(recordedAt).toISOString() : null,
    importedAt: now,
    importedBy: input.importedBy ?? null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
  };

  db.transaction((tx) => {
    tx.insert(importedTraces).values(row).run();
    // Le fichier d'origine est conservé tel quel (section 7).
    tx.insert(importedTraceFiles)
      .values({
        traceId: id,
        version: 1,
        content: input.content,
        byteSize: Buffer.byteLength(input.content, "utf8"),
        checksum: checksum(input.content),
        fetchedAt: now,
      })
      .run();
    persistLegs(tx, id, itinerary);
  });

  if (row.status === "approved") attestSegments(row, itinerary);

  return {
    trace: row,
    quality,
    itinerary: { ...itinerary, traceId: id },
    decision,
    duplicateOf: duplicate?.id ?? null,
    note: noteFor(decision, quality, duplicate?.id ?? null),
  };
}

function noteFor(decision: ReuseDecision, quality: GpxQualityReport, duplicateOf: string | null): string | null {
  if (decision.status === "forbidden") return decision.reason;
  if (duplicateOf) return "Cette géométrie est déjà présente dans la bibliothèque : à comparer avant de l'ajouter.";
  if (!quality.usable) return `Trace inexploitable en l'état : ${quality.summary}`;
  if (decision.status === "review_required") return decision.reason;
  return null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function persistLegs(tx: Tx, traceId: string, itinerary: ResolvedItinerary): void {
  tx.delete(traceSegments).where(eq(traceSegments.traceId, traceId)).run();
  itinerary.legs.forEach((leg, seq) => {
    tx.insert(traceSegments)
      .values({
        traceId,
        seq,
        segmentId: leg.segmentId,
        reversed: leg.reversed,
        distanceM: leg.distanceM,
        coverage: leg.coverage,
        deviationM: leg.deviationM,
      })
      .run();
  });
}

/**
 * Chaque segment emprunté par une trace approuvée reçoit une attestation
 * (sections 11 et 12). Une même source ne compte qu'une fois par segment :
 * c'est l'index unique de la table qui le garantit, pas une vérification
 * applicative qui pourrait être oubliée.
 */
export function attestSegments(row: ImportedTraceRow, itinerary: ResolvedItinerary): number {
  if (itinerary.legs.length === 0) return 0;
  const now = nowIso();
  let written = 0;
  db.transaction((tx) => {
    for (const leg of itinerary.legs) {
      const res = tx
        .insert(segmentAttestations)
        .values({
          id: newId(),
          segmentId: leg.segmentId,
          layer: "imported_gpx",
          sourceId: row.sourceId,
          traceId: row.id,
          deviationM: leg.deviationM,
          observedAt: row.recordedAt,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run();
      written += res.changes > 0 ? 1 : 0;
    }
  });
  refreshSegmentCounters(itinerary.legs.map((l) => l.segmentId));
  return written;
}

/** Met à jour les compteurs dénormalisés portés par les segments (affichage rapide). */
export function refreshSegmentCounters(segmentIds: readonly string[]): void {
  const ids = [...new Set(segmentIds)];
  if (ids.length === 0) return;
  const now = nowIso();
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const counts = db
      .select({
        segmentId: segmentAttestations.segmentId,
        sources: sql<number>`count(distinct coalesce(${segmentAttestations.sourceId}, ${segmentAttestations.layer}))`,
        traces: sql<number>`count(distinct ${segmentAttestations.traceId})`,
      })
      .from(segmentAttestations)
      .where(inArray(segmentAttestations.segmentId, slice))
      .groupBy(segmentAttestations.segmentId)
      .all();
    for (const c of counts) {
      db.update(paths)
        .set({ sourceCount: c.sources, traceCount: c.traces, updatedAt: now })
        .where(eq(paths.id, c.segmentId))
        .run();
    }
  }
}

export function traceById(id: string): ImportedTraceRow | undefined {
  return db.select().from(importedTraces).where(eq(importedTraces.id, id)).get();
}

export function originalFile(traceId: string, version?: number): string | null {
  const row = db
    .select()
    .from(importedTraceFiles)
    .where(
      version === undefined
        ? eq(importedTraceFiles.traceId, traceId)
        : and(eq(importedTraceFiles.traceId, traceId), eq(importedTraceFiles.version, version)),
    )
    .orderBy(desc(importedTraceFiles.version))
    .get();
  return row?.content ?? null;
}

export interface LibraryFilter {
  territory?: string;
  activity?: string;
  sourceId?: string;
  licence?: LicenceId;
  status?: ImportedTraceRow["status"];
  minQuality?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Bibliothèque filtrable du back-office (section 15). */
export function listTraces(filter: LibraryFilter = {}): { rows: ImportedTraceRow[]; total: number } {
  const conds = [];
  if (filter.territory) conds.push(eq(importedTraces.territory, filter.territory));
  if (filter.activity) conds.push(eq(importedTraces.activity, filter.activity));
  if (filter.sourceId) conds.push(eq(importedTraces.sourceId, filter.sourceId));
  if (filter.licence) conds.push(eq(importedTraces.licence, filter.licence));
  if (filter.status) conds.push(eq(importedTraces.status, filter.status));
  if (filter.minQuality !== undefined) conds.push(gte(importedTraces.qualityScore, filter.minQuality));
  if (filter.from) conds.push(gte(importedTraces.importedAt, filter.from));
  if (filter.to) conds.push(lte(importedTraces.importedAt, filter.to));
  const where = conds.length ? and(...conds) : undefined;
  const total = db.select({ n: sql<number>`count(*)` }).from(importedTraces).where(where).get()?.n ?? 0;
  const rows = db
    .select()
    .from(importedTraces)
    .where(where)
    .orderBy(desc(importedTraces.importedAt))
    .limit(Math.min(filter.limit ?? 50, 200))
    .offset(filter.offset ?? 0)
    .all();
  return { rows, total };
}

export function legsOf(traceId: string) {
  return db.select().from(traceSegments).where(eq(traceSegments.traceId, traceId)).orderBy(traceSegments.seq).all();
}

/**
 * Décision humaine sur une trace (section 15). L'approbation rattache la trace
 * au réseau ; le rejet retire ses attestations — une trace rejetée ne doit plus
 * peser dans la confiance d'aucun segment.
 */
export function reviewTrace(
  row: ImportedTraceRow,
  review: { status: ImportedTraceRow["status"]; note?: string | null; licence?: LicenceId },
  reviewerId: string,
): { row: ImportedTraceRow; attested: number } {
  const now = nowIso();
  const licence = review.licence ?? row.licence;
  if (review.status === "approved" && licence === "unknown") {
    throw new HttpError(400, "licence_unknown", "Impossible d'approuver une trace dont la licence n'est pas identifiée.");
  }
  const values = { status: review.status, licence, reviewNote: review.note ?? null, reviewedBy: reviewerId, reviewedAt: now };
  db.update(importedTraces).set(values).where(eq(importedTraces.id, row.id)).run();
  const updated = { ...row, ...values };

  const touched = legsOf(row.id).map((l) => l.segmentId);
  if (review.status === "approved") {
    const legs = legsOf(row.id).map((l) => ({
      segmentId: l.segmentId,
      reversed: l.reversed,
      distanceM: l.distanceM,
      coverage: l.coverage,
      deviationM: l.deviationM ?? 0,
    }));
    const attested = attestSegments(updated, { traceId: row.id, legs, matchedM: 0, unmatchedM: 0, matchedRatio: row.matchedRatio ?? 0, gaps: [] });
    return { row: updated, attested };
  }
  db.delete(segmentAttestations).where(eq(segmentAttestations.traceId, row.id)).run();
  refreshSegmentCounters(touched);
  return { row: updated, attested: 0 };
}

/**
 * Nouvelle version d'une trace dont la source a changé (section 20).
 * L'ancienne géométrie est archivée avec l'ampleur de la modification : rien
 * n'est perdu, et « le tracé officiel a bougé de 320 m » est une information.
 */
export function addTraceVersion(row: ImportedTraceRow, content: string, reason: string | null, importedBy: string | null): { version: number; changedM: number } {
  const parsed = parseTraceFile(content, { fileName: row.fileName });
  if (!parsed) throw new HttpError(400, "bad_file", "Nouvelle version illisible.");
  const normalized = normalizeTrace(parsed);
  if (!normalized) throw new HttpError(400, "empty_trace", "Nouvelle version sans géométrie exploitable.");

  const version = row.version + 1;
  const now = nowIso();
  const previousLength = polylineLengthM(row.coordinates);
  const changedM = Math.abs(normalized.lengthM - previousLength);
  const quality = gpxQuality(normalized);

  db.transaction((tx) => {
    // Archive de la version sortante, jamais écrasée.
    tx.insert(traceVersions)
      .values({
        id: newId(),
        traceId: row.id,
        version: row.version,
        coordinates: row.coordinates,
        lengthM: row.lengthM,
        qualityScore: row.qualityScore,
        changedM,
        reason,
        createdAt: now,
      })
      .run();
    tx.insert(importedTraceFiles)
      .values({
        traceId: row.id,
        version,
        content,
        byteSize: Buffer.byteLength(content, "utf8"),
        checksum: checksum(content),
        fetchedAt: now,
      })
      .run();
    tx.update(importedTraces)
      .set({
        coordinates: normalized.coordinates.map((c) => [c[0], c[1]] as [number, number]),
        elevations: normalized.elevations,
        times: normalized.times,
        breaks: normalized.breaks,
        lengthM: Math.round(normalized.lengthM),
        elevationGainM: normalized.elevationGainM,
        elevationLossM: normalized.elevationLossM,
        minLat: normalized.bbox.south,
        minLng: normalized.bbox.west,
        maxLat: normalized.bbox.north,
        maxLng: normalized.bbox.east,
        qualityScore: quality.score,
        qualityLevel: quality.level,
        qualityFlags: quality.flags,
        geometryHash: traceHash(normalized),
        version,
        // Une géométrie qui change repasse en revue : le terrain a peut-être changé.
        status: "review_required",
        importedBy: importedBy ?? row.importedBy,
      })
      .where(eq(importedTraces.id, row.id))
      .run();
  });
  return { version, changedM };
}

/** Supprime une trace et tout ce qu'elle a produit. */
export function deleteTrace(row: ImportedTraceRow): void {
  const touched = legsOf(row.id).map((l) => l.segmentId);
  db.transaction((tx) => {
    tx.delete(segmentAttestations).where(eq(segmentAttestations.traceId, row.id)).run();
    tx.delete(traceSegments).where(eq(traceSegments.traceId, row.id)).run();
    tx.delete(traceVersions).where(eq(traceVersions.traceId, row.id)).run();
    tx.delete(importedTraceFiles).where(eq(importedTraceFiles.traceId, row.id)).run();
    tx.delete(importedTraces).where(eq(importedTraces.id, row.id)).run();
  });
  refreshSegmentCounters(touched);
}

export { boundsOf };
