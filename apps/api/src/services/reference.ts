import { and, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { bboxFromCenter, haversineM, type BBox, type LatLng, type NetworkStats, type OfficialAlertInput, type ReportCategory, type SourceCounts, type TrailSource } from "@mountain-live/core";
import { db } from "../db/client";
import { officialAlerts, paths, trails, waterPoints, type OfficialAlertRow, type TrailRow, type WaterPointRow } from "../db/schema";
import { geometryExtent, newId, nowIso } from "./util";
import { trailSegmentCounts } from "./trail-segments";

/** Données de référence (sentiers, points d'eau) et alertes officielles. */

export function listTrailsInBBox(box: BBox): TrailRow[] {
  return db
    .select()
    .from(trails)
    .where(
      and(lte(trails.minLat, box.north), gte(trails.maxLat, box.south), lte(trails.minLng, box.east), gte(trails.maxLng, box.west)),
    )
    .all();
}

export interface TrailInput {
  id: string;
  name: string;
  type: TrailRow["type"];
  difficulty: TrailRow["difficulty"];
  distanceKm: number;
  elevationGainM: number;
  geometry: TrailRow["geometry"];
  description: string | null;
  /**
   * Provenance, OBLIGATOIRE. Un itinéraire sans provenance déclarée n'est pas
   * affichable : plus loin dans la chaîne, `routeVerdict` refusera de dessiner
   * son tracé. L'exiger ici garantit qu'aucun appelant ne l'oublie en silence.
   */
  source: TrailSource;
  /** Tronçons non raccordés lors de l'assemblage (qualité de la source). */
  gapCount?: number | null;
  /** Confiance dans la géométrie assemblée (0..1). */
  geometryConfidence?: number | null;
}

/** Insère ou met à jour des sentiers (import d'itinéraires). */
export function upsertTrails(inputs: readonly TrailInput[]): number {
  const now = nowIso();
  let n = 0;
  for (let i = 0; i < inputs.length; i += 200) {
    const batch = inputs.slice(i, i + 200);
    db.transaction((tx) => {
      for (const t of batch) {
        const { bbox } = geometryExtent(t.geometry);
        const row = {
          id: t.id,
          name: t.name,
          type: t.type,
          difficulty: t.difficulty,
          distanceKm: t.distanceKm,
          elevationGainM: t.elevationGainM,
          geometry: t.geometry,
          minLat: bbox.south,
          minLng: bbox.west,
          maxLat: bbox.north,
          maxLng: bbox.east,
          description: t.description,
          source: t.source,
          gapCount: t.gapCount ?? null,
          geometryConfidence: t.geometryConfidence ?? null,
          createdAt: now,
        };
        tx.insert(trails)
          .values(row)
          .onConflictDoUpdate({
            target: trails.id,
            // La provenance est mise à jour AUSSI : un itinéraire réimporté
            // depuis une meilleure source doit cesser d'être annoncé comme seed.
            set: {
              name: row.name,
              type: row.type,
              difficulty: row.difficulty,
              distanceKm: row.distanceKm,
              elevationGainM: row.elevationGainM,
              geometry: row.geometry,
              minLat: row.minLat,
              minLng: row.minLng,
              maxLat: row.maxLat,
              maxLng: row.maxLng,
              description: row.description,
              source: row.source,
              gapCount: row.gapCount,
              geometryConfidence: row.geometryConfidence,
            },
          })
          .run();
        n++;
      }
    });
  }
  return n;
}

/** Agrège des lignes `{ source, n }` en décompte par provenance. */
function tally(rows: readonly { source: string | null; n: number }[]): SourceCounts {
  const get = (src: string): number => rows.find((r) => r.source === src)?.n ?? 0;
  return {
    total: rows.reduce((sum, r) => sum + r.n, 0),
    osm: get("osm"),
    ign: get("ign"),
    gpx: get("gpx"),
    seed: get("seed"),
    local: get("local"),
    official: get("official"),
    partner: get("partner"),
    // Une provenance absente est un DÉFAUT du pipeline, pas une catégorie de
    // données : on la compte à part pour qu'elle se voie.
    unknown: rows.filter((r) => r.source === null || r.source === "").reduce((sum, r) => sum + r.n, 0),
  };
}

/** Provenances considérées comme du terrain relevé (voir `SURVEYED_SOURCES` du noyau). */
function surveyedTotal(c: SourceCounts): number {
  return c.osm + c.ign + c.gpx + (c.official ?? 0) + (c.partner ?? 0);
}

/**
 * Santé du réseau cartographique.
 *
 * La provenance est lue dans la COLONNE `source`, plus jamais déduite d'un
 * `id LIKE 'osm_rel_%'` : c'était exactement le genre de déduction fragile qui
 * faisait passer de vraies données OpenStreetMap pour des inconnues.
 */
export function networkStats(): NetworkStats {
  const pathRows = db.select({ source: paths.source, n: sql<number>`count(*)` }).from(paths).groupBy(paths.source).all();
  const trailRows = db.select({ source: trails.source, n: sql<number>`count(*)` }).from(trails).groupBy(trails.source).all();
  const pathCounts = tally(pathRows);
  const trailCounts = tally(trailRows);
  const { trailSegments: links, linkedTrails } = trailSegmentCounts();
  /*
   * Randonnée orpheline : relevée, mais sans aucun segment associé. C'est le
   * signal d'un import incomplet — la relation est connue, son chemin non.
   */
  const orphanTrails =
    db
      .select({ n: sql<number>`count(*)` })
      .from(trails)
      .where(sql`${trails.source} IN ('osm','ign','gpx','official','partner') AND NOT EXISTS (SELECT 1 FROM trail_segments ts WHERE ts.trail_id = ${trails.id})`)
      .get()?.n ?? 0;
  return {
    paths: pathCounts,
    trails: trailCounts,
    links: { trailSegments: links, linkedTrails, orphanTrails },
    // Un seul chemin relevé ne fait pas un réseau : on exige aussi qu'il soit
    // majoritaire, sinon la démonstration reste ce que l'utilisateur voit.
    realDataReady: surveyedTotal(pathCounts) > 0 && surveyedTotal(pathCounts) >= pathCounts.seed,
  };
}

export function listWaterPointsInBBox(box: BBox): WaterPointRow[] {
  return db
    .select()
    .from(waterPoints)
    .where(
      and(
        gte(waterPoints.lat, box.south),
        lte(waterPoints.lat, box.north),
        gte(waterPoints.lng, box.west),
        lte(waterPoints.lng, box.east),
      ),
    )
    .all();
}

export function waterPointsAround(p: LatLng, radiusM: number): (WaterPointRow & { distanceM: number })[] {
  return listWaterPointsInBBox(bboxFromCenter(p, radiusM))
    .map((w) => ({ ...w, distanceM: Math.round(haversineM(p, { lat: w.lat, lng: w.lng })) }))
    .filter((w) => w.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Point d'eau le plus proche à moins de `maxDistanceM` (état source sèche / active). */
export function nearestWaterPoint(p: LatLng, maxDistanceM: number): (WaterPointRow & { distanceM: number }) | null {
  return waterPointsAround(p, maxDistanceM)[0] ?? null;
}

export function updateWaterPointState(id: string, state: "active" | "dry", at: string): void {
  db.update(waterPoints).set({ lastState: state, lastStateAt: at, updatedAt: at }).where(eq(waterPoints.id, id)).run();
}

/**
 * Alertes officielles en cours ou à venir (non terminées, non supprimées),
 * dont l'enveloppe croise la bbox demandée. Sans bbox : toutes les alertes en cours.
 */
export function listOfficialAlerts(box: BBox | null, now = new Date()): OfficialAlertRow[] {
  const nowIsoStr = now.toISOString();
  const conds = [isNull(officialAlerts.deletedAt), or(isNull(officialAlerts.endsAt), gt(officialAlerts.endsAt, nowIsoStr))];
  if (box) {
    conds.push(
      lte(officialAlerts.minLat, box.north),
      gte(officialAlerts.maxLat, box.south),
      lte(officialAlerts.minLng, box.east),
      gte(officialAlerts.maxLng, box.west),
    );
  }
  return db
    .select()
    .from(officialAlerts)
    .where(and(...conds))
    .orderBy(sql`CASE ${officialAlerts.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END`, sql`${officialAlerts.startsAt} DESC`)
    .all();
}

export type OfficialAlertData = Omit<OfficialAlertInput, "category"> & { category: ReportCategory };

export function createOfficialAlert(input: OfficialAlertData, createdBy: string | null, id = newId()): OfficialAlertRow {
  const { bbox, centroid } = geometryExtent(input.geometry);
  const row: OfficialAlertRow = {
    id,
    organisation: input.organisation,
    title: input.title,
    body: input.body,
    category: input.category,
    severity: input.severity,
    geometry: input.geometry,
    centroidLat: centroid.lat,
    centroidLng: centroid.lng,
    minLat: bbox.south,
    minLng: bbox.west,
    maxLat: bbox.north,
    maxLng: bbox.east,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    url: input.url ?? null,
    createdBy,
    createdAt: nowIso(),
    deletedAt: null,
  };
  db.insert(officialAlerts).values(row).run();
  return row;
}
