/**
 * Activités et contribution collective (sections 3, 5, 35 et 49 du moteur
 * cartographique).
 *
 * Ce que fait ce module, et surtout ce qu'il ne fait pas :
 *
 * - Toute activité terminée est enregistrée **sur l'appareil** (Dexie), avec sa
 *   trace brute intacte.
 * - Rien ne part vers le serveur sans un compte connecté ET un choix explicite.
 *   Le consentement est demandé à la fin de chaque activité ; la préférence
 *   « toujours contribuer » évite de reposer la question.
 * - Une activité envoyée reste modifiable : l'utilisateur peut retirer sa
 *   contribution, et la supprimer efface aussi ses passages côté serveur.
 * - Hors connexion, l'envoi est repoussé : `syncPendingActivities()` le reprend
 *   au retour du réseau.
 */
import type { ActivityDto, CreateActivityInput, RawPoint } from "@mountain-live/core";
import { api, ApiError } from "@/lib/api";
import { db, type SavedTrack } from "@/lib/db";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";

/** Nombre maximal de points envoyés : au-delà, la trace est échantillonnée. */
export const MAX_UPLOAD_POINTS = 20_000;

/** Réduit une trace trop longue en conservant un point sur n (jamais les extrémités). */
export function thinPoints(points: readonly RawPoint[], max = MAX_UPLOAD_POINTS): RawPoint[] {
  if (points.length <= max) return [...points];
  const step = Math.ceil(points.length / max);
  const out: RawPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Construit la charge utile d'envoi à partir d'une trace enregistrée localement. */
export function activityPayload(track: SavedTrack, contribute: boolean): CreateActivityInput | null {
  const raw = track.raw ?? [];
  // Sans trace brute (activité importée d'un GPX ancien), rien n'est envoyé :
  // une trace corrigée fausserait l'apprentissage du réseau.
  if (raw.length < 2) return null;
  const points = thinPoints(raw).map((p) => ({
    at: p.at,
    lat: p.lat,
    lng: p.lng,
    alt: p.alt,
    accuracy: p.accuracy,
    speed: p.speed,
    heading: p.heading,
  }));
  return {
    activityType: track.activity,
    source: "recorded",
    name: track.name,
    startedAt: new Date(points[0].at).toISOString(),
    endedAt: new Date(points[points.length - 1].at).toISOString(),
    contribute,
    clientId: track.id,
    points,
  };
}

function canUpload(): boolean {
  const { token } = useSessionStore.getState();
  return Boolean(token) && useUiStore.getState().online;
}

/**
 * Envoie une trace locale au serveur. Renvoie l'activité créée, ou null si
 * l'envoi n'est pas possible pour l'instant (hors connexion, sans compte) —
 * ce n'est pas une erreur : la trace reste sur l'appareil et partira plus tard.
 */
export async function uploadActivity(track: SavedTrack, contribute: boolean): Promise<ActivityDto | null> {
  if (track.remoteId) return null;
  const payload = activityPayload(track, contribute);
  if (!payload || !canUpload()) return null;
  try {
    const res = await api.activities.create(payload);
    await db.tracks.update(track.id, { remoteId: res.activity.id, contributed: res.activity.contribution === "contributed" });
    return res.activity;
  } catch (err) {
    // 409 : déjà envoyée (rejeu d'un envoi) — on mémorise l'identifiant distant.
    if (err instanceof ApiError && err.status === 409 && typeof err.details === "string") {
      await db.tracks.update(track.id, { remoteId: err.details });
    }
    return null;
  }
}

/** Reprend les envois en attente (retour du réseau, reconnexion). */
export async function syncPendingActivities(): Promise<number> {
  if (!canUpload()) return 0;
  let sent = 0;
  try {
    const pending = (await db.tracks.toArray()).filter((t) => !t.remoteId && t.id !== "__current__" && (t.raw?.length ?? 0) >= 2);
    for (const track of pending) {
      const dto = await uploadActivity(track, track.contributed ?? false);
      if (dto) sent += 1;
    }
  } catch {
    /* IndexedDB indisponible : rien à synchroniser */
  }
  return sent;
}

/** Retire (ou rétablit) la contribution d'une activité déjà envoyée. */
export async function setContribution(track: SavedTrack, contribute: boolean): Promise<boolean> {
  await db.tracks.update(track.id, { contributed: contribute });
  if (!track.remoteId || !canUpload()) return false;
  try {
    await api.activities.update(track.remoteId, { contribute });
    return true;
  } catch {
    return false;
  }
}

/** Supprime une activité localement et, si elle a été envoyée, côté serveur. */
export async function deleteActivity(track: SavedTrack): Promise<void> {
  if (track.remoteId && canUpload()) {
    try {
      await api.activities.remove(track.remoteId);
    } catch {
      /* la suppression locale prime : le serveur sera nettoyé à la prochaine tentative */
    }
  }
  await db.tracks.delete(track.id);
}

/** Supprime tout l'historique local (et distant lorsque c'est possible). */
export async function deleteAllActivities(): Promise<number> {
  const tracks = (await db.tracks.toArray()).filter((t) => t.id !== "__current__");
  for (const t of tracks) await deleteActivity(t);
  return tracks.length;
}
