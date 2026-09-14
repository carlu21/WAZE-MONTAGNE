import { and, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm";
import { bboxFromCenter, haversineM, type BBox, type LatLng, type OfficialAlertInput, type ReportCategory } from "@mountain-live/core";
import { db } from "../db/client";
import { officialAlerts, trails, waterPoints, type OfficialAlertRow, type TrailRow, type WaterPointRow } from "../db/schema";
import { geometryExtent, newId, nowIso } from "./util";

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
    .orderBy(sql`${officialAlerts.severity} DESC`, sql`${officialAlerts.startsAt} DESC`)
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
