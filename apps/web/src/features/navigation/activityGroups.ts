/**
 * Regroupement des activités par jour (« ACTIVITÉS », cahier des charges).
 *
 * L'utilisateur ne lit pas une suite d'horodatages : il lit « aujourd'hui »,
 * « hier », puis des dates. Chaque jour porte son total — nombre de sorties et
 * distance réellement parcourue — parce que c'est ce qu'on vient y chercher.
 */
export interface DayActivity {
  id: string;
  savedAt: number;
  stats: { distanceM: number };
}

export interface ActivityDay<T extends DayActivity> {
  /** Clé stable `AAAA-MM-JJ`, en heure locale. */
  key: string;
  label: string;
  tracks: T[];
  count: number;
  distanceM: number;
}

/** Clé de jour locale (et non UTC : une sortie du soir appartient à son jour). */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** « Aujourd'hui », « Hier », sinon « lundi 8 septembre 2025 ». */
export function dayLabel(at: number, now = Date.now()): string {
  const key = dayKey(at);
  if (key === dayKey(now)) return "Aujourd'hui";
  if (key === dayKey(now - 86_400_000)) return "Hier";
  return new Date(at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** Jours du plus récent au plus ancien ; à l'intérieur d'un jour, même ordre. */
export function groupActivitiesByDay<T extends DayActivity>(tracks: readonly T[], now = Date.now()): ActivityDay<T>[] {
  const days = new Map<string, ActivityDay<T>>();
  for (const t of [...tracks].sort((a, b) => b.savedAt - a.savedAt)) {
    const key = dayKey(t.savedAt);
    const day = days.get(key) ?? { key, label: dayLabel(t.savedAt, now), tracks: [], count: 0, distanceM: 0 };
    day.tracks.push(t);
    day.count += 1;
    day.distanceM += t.stats.distanceM;
    days.set(key, day);
  }
  return [...days.values()];
}
