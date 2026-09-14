/**
 * Alertes de proximité (section 12) : compare la position aux signalements et
 * alertes officielles connus, dans le rayon et les catégories choisis.
 * Formats : « Attention : Battue à 600 m. », « Arbre tombé à 300 m. »,
 * « Troupeau et chiens de protection à 400 m. ». Les alertes officielles priment.
 */
import { SUBTYPE_BY_ID, haversineM, phrases, type LatLng, type OfficialAlert, type Report, type ReportCategory } from "@mountain-live/core";

export interface AlertPrefs {
  enabled: boolean;
  radiusM: number;
  categories: readonly ReportCategory[];
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = { enabled: true, radiusM: 500, categories: ["danger", "activity", "animals", "path"] };

export interface ProximityAlert {
  /** Clé de dédoublonnage (identifiant du signalement ou de l'alerte, ou groupe). */
  key: string;
  message: string;
  severity: "official" | "danger" | "info";
  distanceM: number;
  reportId?: string;
  alertId?: string;
}

const VISIBLE = new Set<Report["status"]>(["active", "confirmed", "probably_resolved", "disputed"]);

export function computeAlerts(
  position: LatLng,
  reports: readonly Report[],
  officialAlerts: readonly OfficialAlert[],
  prefs: AlertPrefs,
  alreadyNotified: ReadonlySet<string>,
  now: number = Date.now(),
): ProximityAlert[] {
  if (!prefs.enabled) return [];
  const out: ProximityAlert[] = [];

  for (const a of officialAlerts) {
    const d = haversineM(position, { lat: a.centroidLat, lng: a.centroidLng });
    // Les alertes officielles sont prises en compte dans un rayon plus large (×3).
    if (d > prefs.radiusM * 3 || alreadyNotified.has(`alert:${a.id}`)) continue;
    if (a.endsAt && new Date(a.endsAt).getTime() < now) continue;
    out.push({ key: `alert:${a.id}`, message: `Alerte officielle : ${a.title} (${a.organisation}).`, severity: "official", distanceM: Math.round(d), alertId: a.id });
  }

  const near = reports
    .filter((r) => VISIBLE.has(r.status) && prefs.categories.includes(r.category) && new Date(r.expiresAt).getTime() > now && (!r.endsAt || new Date(r.endsAt).getTime() > now))
    .map((r) => ({ r, d: haversineM(position, r) }))
    .filter(({ d }) => d <= prefs.radiusM)
    .sort((a, b) => a.d - b.d);

  // Regroupement troupeau + chiens de protection : un seul message.
  const herd = near.find(({ r }) => r.subtype === "herd" && !alreadyNotified.has(`report:${r.id}`));
  const dogs = near.find(({ r }) => r.subtype === "guard_dogs" && !alreadyNotified.has(`report:${r.id}`));
  const grouped = new Set<string>();
  if (herd && dogs) {
    const d = Math.min(herd.d, dogs.d);
    out.push({ key: `group:${herd.r.id}:${dogs.r.id}`, message: phrases.proximityAlert("Troupeau et chiens de protection", d, "nearby"), severity: "danger", distanceM: Math.round(d), reportId: dogs.r.id });
    grouped.add(herd.r.id);
    grouped.add(dogs.r.id);
  }

  for (const { r, d } of near) {
    if (grouped.has(r.id) || alreadyNotified.has(`report:${r.id}`)) continue;
    const label = SUBTYPE_BY_ID[r.subtype]?.label ?? r.subtype;
    const isDanger = r.category === "danger" || r.subtype === "battue" || r.subtype === "hunting" || r.subtype === "guard_dogs" || r.subtype === "aggressive_animal";
    const message = isDanger ? `Attention : ${phrases.proximityAlert(label, d, "nearby")}` : phrases.proximityAlert(label, d, "nearby");
    out.push({ key: `report:${r.id}`, message, severity: isDanger ? "danger" : "info", distanceM: Math.round(d), reportId: r.id });
  }
  return out;
}

/** Clés à marquer comme notifiées pour une alerte (les groupes marquent leurs membres). */
export function notifiedKeysFor(alert: ProximityAlert): string[] {
  if (alert.key.startsWith("group:")) {
    const [, a, b] = alert.key.split(":");
    return [`report:${a}`, `report:${b}`, alert.key];
  }
  return [alert.key];
}
