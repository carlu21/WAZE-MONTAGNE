import { and, inArray, lt, lte, or, sql } from "drizzle-orm";
import { VISIBLE_STATUSES } from "@mountain-live/core";
import { config } from "../config";
import { db } from "../db/client";
import { photos, reports } from "../db/schema";
import { removePhotoFile } from "../services/photos";
import { purgePresence } from "../services/presence";
import { sweepRateLimits } from "../middleware/rateLimit";

/**
 * Tâche périodique (toutes les 60 s + au démarrage) :
 *  - passage en « expiré » des signalements dont expires_at ou ends_at est dépassé ;
 *  - purge des tranches de présence de plus de 30 min ;
 *  - purge définitive des signalements expirés / supprimés depuis plus de 90 jours (et de leurs photos).
 * Le fondu (fade) est calculé à la lecture, il n'est pas stocké.
 */
export interface ExpirationPassResult {
  expired: number;
  purgedPresence: number;
  purgedReports: number;
}

export function runExpirationPass(now = new Date()): ExpirationPassResult {
  const iso = now.toISOString();
  const expired = db
    .update(reports)
    .set({ status: "expired", updatedAt: iso })
    .where(
      and(
        inArray(reports.status, [...VISIBLE_STATUSES]),
        or(lte(reports.expiresAt, iso), sql`${reports.endsAt} IS NOT NULL AND ${reports.endsAt} <= ${iso}`),
      ),
    )
    .run().changes;

  const purgedPresence = purgePresence(now);

  const retentionFloor = new Date(now.getTime() - config.expiredRetentionDays * 86_400_000).toISOString();
  const stale = db
    .select({ id: reports.id })
    .from(reports)
    .where(
      or(
        and(sql`${reports.status} = 'expired'`, lt(reports.updatedAt, retentionFloor)),
        and(sql`${reports.status} = 'deleted'`, lt(reports.deletedAt, retentionFloor)),
      ),
    )
    .all()
    .map((r) => r.id);
  let purgedReports = 0;
  if (stale.length) {
    const files = db.select({ storagePath: photos.storagePath }).from(photos).where(inArray(photos.reportId, stale)).all();
    for (const f of files) removePhotoFile(f.storagePath);
    purgedReports = db.delete(reports).where(inArray(reports.id, stale)).run().changes;
  }

  sweepRateLimits(now.getTime());
  return { expired, purgedPresence, purgedReports };
}

/** Démarre la tâche ; renvoie une fonction d'arrêt. Le timer ne bloque pas la sortie du processus. */
export function startExpirationJob(intervalMs = 60_000): () => void {
  const safeRun = () => {
    try {
      const r = runExpirationPass();
      if (r.expired || r.purgedReports) {
        console.log(`[jobs] expiration : ${r.expired} expiré(s), ${r.purgedReports} purgé(s), ${r.purgedPresence} tranche(s) de présence`);
      }
    } catch (err) {
      console.error("[jobs] échec de la passe d'expiration", err);
    }
  };
  safeRun();
  const timer = setInterval(safeRun, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
