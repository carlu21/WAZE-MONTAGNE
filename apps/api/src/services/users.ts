import { eq } from "drizzle-orm";
import type { NotificationType, UserPreferences } from "@mountain-live/core";
import { db } from "../db/client";
import { userPreferences, users, type UserRow } from "../db/schema";
import { nowIso } from "./util";

const ALL_NOTIFICATIONS: NotificationType[] = [
  "new_danger_on_route",
  "new_battue_nearby",
  "trail_closed",
  "report_updated",
  "report_confirmed",
  "report_resolved",
  "official_alert",
  "system",
];

/** Préférences par défaut d'un nouveau compte (section 11 et 23). */
export function defaultPreferences(): UserPreferences {
  return {
    filters: [],
    showOfficialOnly: false,
    basemap: "topo",
    theme: "system",
    alerts: { enabled: true, radiusM: 1000, categories: [] },
    notifications: Object.fromEntries(ALL_NOTIFICATIONS.map((t) => [t, true])) as Record<NotificationType, boolean>,
    aroundRadiusM: 3000,
    // Contribution collective : refusée tant que l'utilisateur ne l'a pas acceptée.
    contributeTraces: false,
    personalPace: true,
  };
}

/** Préférences complètes (valeurs par défaut fusionnées avec celles enregistrées). */
export function getPreferences(userId: string): UserPreferences {
  const row = db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).get();
  const defaults = defaultPreferences();
  if (!row) return defaults;
  const stored = row.data as Partial<UserPreferences>;
  return {
    ...defaults,
    ...stored,
    alerts: { ...defaults.alerts, ...(stored.alerts ?? {}) },
    notifications: { ...defaults.notifications, ...(stored.notifications ?? {}) },
  };
}

export function savePreferences(userId: string, prefs: UserPreferences): UserPreferences {
  const updatedAt = nowIso();
  db.insert(userPreferences)
    .values({ userId, data: prefs, updatedAt })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { data: prefs, updatedAt } })
    .run();
  return prefs;
}

export function findUserById(id: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
}

/** Un utilisateur est-il actuellement suspendu ? */
export function isUserSuspended(user: Pick<UserRow, "suspendedUntil">, now = Date.now()): boolean {
  return !!user.suspendedUntil && Date.parse(user.suspendedUntil) > now;
}
