import { Hono } from "hono";
import type { NotificationsResponse } from "@mountain-live/core";
import type { UserRow } from "../db/schema";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { HttpError } from "../services/errors";
import { getNotification, listNotifications, markAllNotificationsRead, markNotificationRead } from "../services/notifications";
import { toNotification } from "../services/serializers";

/** GET /notifications, POST /notifications/:id/read, POST /notifications/read-all */
export const notificationsRoutes = new Hono<AppEnv>();

notificationsRoutes.use("*", requireAuth);

notificationsRoutes.get("/", (c) => {
  const user = c.get("user") as UserRow;
  const { notifications, unreadCount } = listNotifications(user.id);
  const body: NotificationsResponse = { notifications: notifications.map(toNotification), unreadCount };
  return c.json(body);
});

notificationsRoutes.post("/read-all", (c) => {
  markAllNotificationsRead((c.get("user") as UserRow).id);
  return c.body(null, 204);
});

notificationsRoutes.post("/:id/read", (c) => {
  const user = c.get("user") as UserRow;
  const id = c.req.param("id");
  if (!getNotification(user.id, id)) throw new HttpError(404, "not_found", "Notification introuvable");
  markNotificationRead(user.id, id);
  return c.body(null, 204);
});
