import { and, gte, lt, lte, sql } from "drizzle-orm";
import { haversineM, presenceCell, type BBox, type LatLng, type PresenceCell } from "@mountain-live/core";
import { config } from "../config";
import { db } from "../db/client";
import { presencePings } from "../db/schema";

/**
 * Présence agrégée (section 8). En base : uniquement (cellule ~1 km, tranche de 5 min, compteur).
 * Aucun identifiant utilisateur ni position précise n'est jamais écrit avec une position.
 *
 * Pour les alertes de proximité (section 12), on garde EN MÉMOIRE SEULEMENT, pendant
 * 30 min, la dernière cellule connue des utilisateurs authentifiés : jamais persisté,
 * jamais exposé, perdu au redémarrage, effaçable à la demande (suppression de compte).
 */

const recentUserCells = new Map<string, { lat: number; lng: number; at: number }>();

/** Début de la tranche courante (arrondi à 5 min), en ISO. */
export function bucketStart(now: Date): string {
  const ms = config.presenceBucketMin * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms).toISOString();
}

/** Centre d'une cellule « lat:lng » (arrondie à 0,01°). */
export function cellCenter(cell: string): LatLng {
  const [lat, lng] = cell.split(":").map(Number);
  return { lat, lng };
}

export function recordPresence(p: LatLng, userId: string | null, now = new Date()): void {
  const cell = presenceCell(p);
  const bucket = bucketStart(now);
  db.insert(presencePings)
    .values({ cell, bucketStart: bucket, count: 1 })
    .onConflictDoUpdate({
      target: [presencePings.cell, presencePings.bucketStart],
      set: { count: sql`${presencePings.count} + 1` },
    })
    .run();
  if (userId) {
    const center = cellCenter(cell);
    recentUserCells.set(userId, { lat: center.lat, lng: center.lng, at: now.getTime() });
  }
}

function retentionFloor(now: Date): string {
  return new Date(now.getTime() - config.presenceRetentionMin * 60_000).toISOString();
}

/**
 * Cellules actives dans une bbox. L'estimation par cellule est le maximum observé sur
 * une tranche de 5 min (chaque client n'envoie qu'un ping par tranche), ce qui évite de
 * compter plusieurs fois le même appareil resté sur place.
 */
export function aggregatePresence(box: BBox, now = new Date()): { cells: PresenceCell[]; activeUsersEstimate: number } {
  const rows = db
    .select({ cell: presencePings.cell, count: sql<number>`MAX(${presencePings.count})` })
    .from(presencePings)
    .where(gte(presencePings.bucketStart, retentionFloor(now)))
    .groupBy(presencePings.cell)
    .all();
  const cells: PresenceCell[] = [];
  let total = 0;
  for (const r of rows) {
    const c = cellCenter(r.cell);
    if (c.lat < box.south || c.lat > box.north || c.lng < box.west || c.lng > box.east) continue;
    cells.push({ cell: r.cell, lat: c.lat, lng: c.lng, count: r.count });
    total += r.count;
  }
  cells.sort((a, b) => b.count - a.count);
  return { cells, activeUsersEstimate: total };
}

/** Somme des estimations de présence dans une bbox (fréquentation d'un lieu). */
export function presenceEstimateInBBox(box: BBox, now = new Date()): number {
  return aggregatePresence(box, now).activeUsersEstimate;
}

/** Nombre de pings enregistrés sur une période (tableau de bord : fréquentation estimée). */
export function presencePingsBetween(box: BBox, fromIso: string, toIso: string): number {
  const rows = db
    .select({ cell: presencePings.cell, count: sql<number>`SUM(${presencePings.count})` })
    .from(presencePings)
    .where(and(gte(presencePings.bucketStart, fromIso), lte(presencePings.bucketStart, toIso)))
    .groupBy(presencePings.cell)
    .all();
  let total = 0;
  for (const r of rows) {
    const c = cellCenter(r.cell);
    if (c.lat >= box.south && c.lat <= box.north && c.lng >= box.west && c.lng <= box.east) total += r.count;
  }
  return total;
}

/** Purge des tranches plus anciennes que la durée de rétention (30 min). */
export function purgePresence(now = new Date()): number {
  const result = db.delete(presencePings).where(lt(presencePings.bucketStart, retentionFloor(now))).run();
  const floor = now.getTime() - config.presenceRetentionMin * 60_000;
  for (const [userId, entry] of recentUserCells) if (entry.at < floor) recentUserCells.delete(userId);
  return result.changes;
}

/**
 * Utilisateurs authentifiés récemment présents à moins de `radiusM` (mémoire uniquement).
 * La distance est celle du centre de cellule (précision ~1 km), jamais d'une position exacte.
 */
export function usersNear(p: LatLng, radiusM: number, now = new Date()): { userId: string; distanceM: number }[] {
  const floor = now.getTime() - config.presenceRetentionMin * 60_000;
  const found: { userId: string; distanceM: number }[] = [];
  for (const [userId, entry] of recentUserCells) {
    if (entry.at < floor) continue;
    const d = haversineM(p, entry);
    if (d <= radiusM) found.push({ userId, distanceM: Math.round(d) });
  }
  return found;
}

/** Oubli immédiat d'un utilisateur (suppression de compte). */
export function forgetUserPresence(userId: string): void {
  recentUserCells.delete(userId);
}

/** Réinitialisation (tests). */
export function resetPresenceMemory(): void {
  recentUserCells.clear();
}
