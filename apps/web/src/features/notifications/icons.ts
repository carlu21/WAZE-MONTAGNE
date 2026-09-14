import type { NotificationType } from "@mountain-live/core";

/** Icône lucide par type de notification (section 23). */
export const NOTIFICATION_ICONS: Record<NotificationType, string> = {
  new_danger_on_route: "triangle-alert",
  new_battue_nearby: "megaphone",
  trail_closed: "ban",
  report_updated: "refresh-cw",
  report_confirmed: "check-circle",
  report_resolved: "circle-check",
  official_alert: "badge-check",
  system: "info",
};

export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "new_danger_on_route",
  "new_battue_nearby",
  "trail_closed",
  "report_updated",
  "report_confirmed",
  "report_resolved",
  "official_alert",
  "system",
];
