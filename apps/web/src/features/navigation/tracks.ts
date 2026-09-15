/**
 * Traces enregistrées (section 17) : stockage local uniquement (jamais envoyées
 * au serveur), export GPX, sauvegarde de la trace en cours pour survivre à un
 * rechargement de la page.
 */
import { buildGpx, trackStats, type ActivityMode, type RawPoint, type TrackPoint } from "@mountain-live/core";
import { fr } from "@mountain-live/core";
import { db, type SavedTrack } from "@/lib/db";

export const CURRENT_TRACK_ID = "__current__";

export function trackName(activity: ActivityMode, date: Date = new Date()): string {
  const label = fr.navigation.activities[activity];
  return `${label} du ${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })} à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

export async function saveTrack(input: {
  name: string;
  activity: ActivityMode;
  points: TrackPoint[];
  /** Trace brute, conservée telle quelle pour un envoi éventuel (section 5 du moteur collectif). */
  raw?: readonly RawPoint[];
  contributed?: boolean;
}): Promise<SavedTrack> {
  const track: SavedTrack = {
    id: `trk_${Date.now().toString(36)}`,
    name: input.name,
    activity: input.activity,
    savedAt: Date.now(),
    points: input.points,
    raw: input.raw ? [...input.raw] : undefined,
    contributed: input.contributed ?? false,
    stats: trackStats(input.points),
  };
  await db.tracks.put(track);
  return track;
}

export async function listTracks(): Promise<SavedTrack[]> {
  try {
    return (await db.tracks.orderBy("savedAt").reverse().toArray()).filter((t) => t.id !== CURRENT_TRACK_ID);
  } catch {
    return [];
  }
}

export async function deleteTrack(id: string): Promise<void> {
  await db.tracks.delete(id);
}

/** Sauvegarde de la trace en cours (reprise après rechargement). */
export async function persistCurrentTrack(activity: ActivityMode, points: TrackPoint[]): Promise<void> {
  try {
    await db.tracks.put({ id: CURRENT_TRACK_ID, name: "En cours", activity, savedAt: Date.now(), points, stats: trackStats(points) });
  } catch {
    /* facultatif */
  }
}

export async function loadCurrentTrack(): Promise<SavedTrack | null> {
  try {
    return (await db.tracks.get(CURRENT_TRACK_ID)) ?? null;
  } catch {
    return null;
  }
}

export async function clearCurrentTrack(): Promise<void> {
  try {
    await db.tracks.delete(CURRENT_TRACK_ID);
  } catch {
    /* ignore */
  }
}

export function gpxFileName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${base || "trace"}.gpx`;
}

/** Télécharge un GPX (navigateur) ; renvoie false si l'API Blob n'est pas disponible. */
export function downloadGpx(name: string, points: TrackPoint[], description?: string | null): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") return false;
  const xml = buildGpx({ name, points, description: description ?? null });
  try {
    const blob = new Blob([xml], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = gpxFileName(name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch {
    return false;
  }
}

/** Partage natif (mobile) d'un fichier GPX quand disponible, sinon téléchargement. */
export async function shareOrDownloadGpx(name: string, points: TrackPoint[]): Promise<boolean> {
  const xml = buildGpx({ name, points });
  if (typeof navigator !== "undefined" && typeof File !== "undefined" && "canShare" in navigator) {
    try {
      const file = new File([xml], gpxFileName(name), { type: "application/gpx+xml" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return true;
      }
    } catch {
      /* annulé ou non pris en charge : téléchargement */
    }
  }
  return downloadGpx(name, points);
}
