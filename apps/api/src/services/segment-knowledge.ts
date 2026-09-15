/**
 * Connaissance d'un segment (sections 11, 12, 21, 30 du cahier des charges GPX).
 *
 * C'est la réponse à la question finale du cahier des charges : cliquer sur
 * n'importe quel chemin et savoir sa géométrie, ses sources, les GPX qui
 * l'empruntent, son niveau de confiance, sa dernière validation, les
 * itinéraires auxquels il appartient — puis, dès que l'application est
 * utilisée, ses passages, son temps moyen, ses activités et sa fréquentation.
 *
 * Distinction tenue partout : « pas encore de données » n'est pas « personne
 * n'y passe ». Les champs d'usage inconnus valent `null`, jamais zéro.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  describeFrequentation,
  estimateTime,
  segmentConfidence,
  segmentKnowledge,
  segmentProfile,
  isPublishable,
  type SegmentAttestation,
  type SegmentConfidence,
  type SegmentKnowledgeCard,
} from "@mountain-live/core";
import { db } from "../db/client";
import {
  dataSources,
  importedTraces,
  paths,
  segmentAttestations,
  traceSegments,
  trails,
  type SegmentAttestationRow,
} from "../db/schema";
import { toPathSegment } from "./paths";
import { overallStatistics } from "./network-stats";
import { nowIso } from "./util";

/** Attestations d'un segment, converties pour le cœur. */
export function attestationsOf(segmentId: string): SegmentAttestation[] {
  return db
    .select()
    .from(segmentAttestations)
    .where(eq(segmentAttestations.segmentId, segmentId))
    .all()
    .map(toAttestation);
}

function toAttestation(row: SegmentAttestationRow): SegmentAttestation {
  return {
    layer: row.layer,
    sourceId: row.sourceId,
    traceId: row.traceId,
    at: row.observedAt ? Date.parse(row.observedAt) : row.createdAt ? Date.parse(row.createdAt) : null,
    deviationM: row.deviationM,
  };
}

/** Itinéraires importés empruntant ce segment (section 6). */
export function itinerariesOn(segmentId: string): { id: string; name: string | null; licence: string; sourceId: string | null }[] {
  const links = db.select().from(traceSegments).where(eq(traceSegments.segmentId, segmentId)).all();
  if (links.length === 0) return [];
  const ids = [...new Set(links.map((l) => l.traceId))];
  const rows = db
    .select({ id: importedTraces.id, name: importedTraces.name, licence: importedTraces.licence, sourceId: importedTraces.sourceId, status: importedTraces.status })
    .from(importedTraces)
    .where(inArray(importedTraces.id, ids))
    .all();
  // Une trace rejetée n'est pas une référence : elle ne figure pas sur la fiche.
  return rows.filter((r) => r.status !== "rejected").map((r) => ({ id: r.id, name: r.name, licence: r.licence, sourceId: r.sourceId }));
}

/** Noms des sources attestant ce segment, pour l'attribution (section 22). */
export function sourcesOf(segmentId: string): { id: string; name: string; type: string; licence: string; attribution: string | null }[] {
  const ids = [...new Set(attestationsOf(segmentId).map((a) => a.sourceId).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return [];
  return db
    .select({ id: dataSources.id, name: dataSources.name, type: dataSources.type, licence: dataSources.licence, attribution: dataSources.attributionText })
    .from(dataSources)
    .where(inArray(dataSources.id, ids))
    .all();
}

/** Confiance d'un segment (section 12), calculée à partir de tout ce qu'on sait. */
export function confidenceOf(segmentId: string, now = Date.now()): SegmentConfidence {
  const row = db.select().from(paths).where(eq(paths.id, segmentId)).get();
  const attestations = attestationsOf(segmentId);
  return segmentConfidence(
    attestations,
    {
      passages: row?.passageCount ?? 0,
      lastPassageAt: row?.lastPassageAt ? Date.parse(row.lastPassageAt) : null,
    },
    now,
  );
}

/**
 * Fiche complète d'un segment (section 30). Les statistiques d'usage ne sont
 * incluses qu'au-delà du seuil d'anonymat du moteur collectif : la provenance
 * est publique, la fréquentation ne l'est qu'agrégée.
 */
export function knowledgeCard(segmentId: string, now = Date.now()): SegmentKnowledgeCard | null {
  const row = db.select().from(paths).where(eq(paths.id, segmentId)).get();
  if (!row) return null;
  const segment = toPathSegment(row);
  const stats = overallStatistics(segmentId);
  const publishable = stats && isPublishable(stats) ? stats : null;
  return segmentKnowledge(
    {
      segment,
      attestations: attestationsOf(segmentId),
      itineraries: itinerariesOn(segmentId).map((t) => ({ id: t.id, name: t.name })),
      usage: publishable
        ? {
            passages: publishable.passages.total,
            uniqueUsers: publishable.uniqueUsers,
            lastPassageAt: publishable.lastPassageAt,
          }
        : undefined,
      lastValidatedAt: row.lastValidatedAt ? Date.parse(row.lastValidatedAt) : null,
    },
    now,
  );
}

/**
 * Recalcule et mémorise la confiance des segments indiqués. Dénormalisation
 * assumée : la carte doit pouvoir colorer un réseau entier sans recalculer.
 */
export function refreshConfidence(segmentIds: readonly string[], now = Date.now()): number {
  const ids = [...new Set(segmentIds)].filter(Boolean);
  if (ids.length === 0) return 0;
  const stamp = nowIso();
  let written = 0;
  db.transaction((tx) => {
    for (const id of ids) {
      const confidence = confidenceOf(id, now);
      tx.update(paths)
        .set({ trailConfidence: confidence.score, sourceCount: confidence.uniqueSources, traceCount: confidence.traces, updatedAt: stamp })
        .where(eq(paths.id, id))
        .run();
      written += 1;
    }
  });
  return written;
}

/** Recalcule la confiance de tous les segments attestés ou parcourus. */
export function refreshAllConfidence(now = Date.now()): number {
  const attested = db.selectDistinct({ id: segmentAttestations.segmentId }).from(segmentAttestations).all().map((r) => r.id);
  const travelled = db.select({ id: paths.id }).from(paths).where(sql`${paths.passageCount} > 0`).all().map((r) => r.id);
  return refreshConfidence([...new Set([...attested, ...travelled])], now);
}

/** Couverture d'un territoire : ce que l'on sait, et où l'on ne sait rien (section 23, étape 7). */
export function coverageReport(box: { west: number; south: number; east: number; north: number }): {
  segments: number;
  withSource: number;
  withTrace: number;
  withPassages: number;
  averageConfidence: number | null;
} {
  const rows = db
    .select({ id: paths.id, sources: paths.sourceCount, traces: paths.traceCount, passages: paths.passageCount, confidence: paths.trailConfidence })
    .from(paths)
    .where(
      and(
        sql`${paths.maxLat} >= ${box.south}`,
        sql`${paths.minLat} <= ${box.north}`,
        sql`${paths.maxLng} >= ${box.west}`,
        sql`${paths.minLng} <= ${box.east}`,
      ),
    )
    .all();
  if (rows.length === 0) return { segments: 0, withSource: 0, withTrace: 0, withPassages: 0, averageConfidence: null };
  const scored = rows.filter((r) => r.confidence !== null);
  return {
    segments: rows.length,
    withSource: rows.filter((r) => r.sources > 0).length,
    withTrace: rows.filter((r) => r.traces > 0).length,
    withPassages: rows.filter((r) => r.passages > 0).length,
    averageConfidence: scored.length > 0 ? scored.reduce((n, r) => n + (r.confidence ?? 0), 0) / scored.length : null,
  };
}

export { describeFrequentation, estimateTime, segmentProfile, trails };
