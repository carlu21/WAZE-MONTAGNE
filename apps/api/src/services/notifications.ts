import { and, desc, eq, isNull } from "drizzle-orm";
import type { LatLng, NotificationType, ReportCategory } from "@mountain-live/core";
import { config } from "../config";
import { db } from "../db/client";
import { notifications, users, type NotificationRow } from "../db/schema";
import { usersNear } from "./presence";
import { getPreferences } from "./users";
import { newId, nowIso } from "./util";

/**
 * Notifications (section 23) : jamais inutiles. Chaque envoi respecte les préférences
 * de l'utilisateur (`notifications[type]`) et, pour les alertes de proximité,
 * l'activation des alertes et les catégories choisies.
 */

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  reportId?: string | null;
}

export function notifyUser(input: NotifyInput): NotificationRow | null {
  const target = db.select({ id: users.id, deletedAt: users.deletedAt }).from(users).where(eq(users.id, input.userId)).get();
  if (!target || target.deletedAt) return null;
  const prefs = getPreferences(input.userId);
  if (prefs.notifications[input.type] === false) return null;
  const row: NotificationRow = {
    id: newId(),
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    reportId: input.reportId ?? null,
    readAt: null,
    createdAt: nowIso(),
  };
  db.insert(notifications).values(row).run();
  return row;
}

/**
 * Alerte de proximité (section 12) : utilisateurs récemment présents à moins de `radiusM`
 * (cellules en mémoire, jamais de position individuelle persistée), hors auteur.
 * La distance transmise est arrondie à la centaine de mètres : la présence n'est connue
 * qu'à l'échelle d'une cellule d'environ 1 km.
 */
export function notifyNearbyUsers(opts: {
  at: LatLng;
  category: ReportCategory;
  type: NotificationType;
  title: string;
  body: (distanceM: number) => string;
  reportId: string | null;
  excludeUserId: string | null;
  radiusM?: number;
}): number {
  const radius = opts.radiusM ?? config.proximityNotifyRadiusM;
  let sent = 0;
  for (const { userId, distanceM } of usersNear(opts.at, radius)) {
    if (userId === opts.excludeUserId) continue;
    const prefs = getPreferences(userId);
    if (!prefs.alerts.enabled) continue;
    if (prefs.alerts.categories.length && !prefs.alerts.categories.includes(opts.category)) continue;
    const rounded = Math.max(100, Math.round(distanceM / 100) * 100);
    if (notifyUser({ userId, type: opts.type, title: opts.title, body: opts.body(rounded), reportId: opts.reportId })) sent++;
  }
  return sent;
}

export function listNotifications(userId: string, limit = 100): { notifications: NotificationRow[]; unreadCount: number } {
  const rows = db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .all();
  const unread = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .all().length;
  return { notifications: rows, unreadCount: unread };
}

/** Notification appartenant à l'utilisateur, ou undefined. */
export function getNotification(userId: string, id: string): NotificationRow | undefined {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .get();
}

export function markNotificationRead(userId: string, id: string): boolean {
  const res = db
    .update(notifications)
    .set({ readAt: nowIso() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)))
    .run();
  return res.changes > 0;
}

export function markAllNotificationsRead(userId: string): number {
  return db
    .update(notifications)
    .set({ readAt: nowIso() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .run().changes;
}
