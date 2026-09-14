/**
 * Veilleur monté une fois dans la coquille : alertes de proximité (section 12)
 * et ping de présence agrégée (section 8). Sans rendu.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { haversineM, type OfficialAlert, type Report } from "@mountain-live/core";
import { qk } from "@/lib/queryKeys";
import { db } from "@/lib/db";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { toast } from "@/components/ui";
import { DEFAULT_ALERT_PREFS, computeAlerts, notifiedKeysFor, type AlertPrefs } from "./engine";
import { maybePingPresence } from "./presence";

export const ALERT_TICK_MS = 20_000;
export const ALERT_MOVE_M = 50;
export const NOTIFIED_KEY = "ml.alerted";
export const NOTIFIED_TTL_MS = 6 * 60 * 60_000;

function loadNotified(): Map<string, number> {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    const obj = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const now = Date.now();
    return new Map(Object.entries(obj).filter(([, t]) => now - t < NOTIFIED_TTL_MS));
  } catch {
    return new Map();
  }
}
function saveNotified(m: Map<string, number>) {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(Object.fromEntries(m)));
  } catch {
    /* ignore */
  }
}

export function AlertsWatcher() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const position = useUiStore((s) => s.position);
  const prefsFromUser = useSessionStore((s) => s.user?.preferences.alerts);
  const notified = useRef<Map<string, number> | null>(null);
  const lastPos = useRef<{ lat: number; lng: number } | null>(null);
  const lastRun = useRef(0);
  const runRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined);

  // Passe de détection : lue via une ref pour que l'intervalle ne dépende ni de la position ni des préférences.
  runRef.current = async (force = false) => {
    if (!notified.current) notified.current = loadNotified();
    const pos = useUiStore.getState().position;
    if (!pos) return;
    const moved = !lastPos.current || haversineM(lastPos.current, pos) >= ALERT_MOVE_M;
    const stale = Date.now() - lastRun.current >= ALERT_TICK_MS;
    if (!force && !moved && !stale) return;
    lastPos.current = { lat: pos.lat, lng: pos.lng };
    lastRun.current = Date.now();

    const prefs: AlertPrefs = prefsFromUser ?? DEFAULT_ALERT_PREFS;
    // Signalements connus : cache TanStack (carte, autour de moi) + cache local Dexie.
    const seen = new Map<string, Report>();
    const alerts = new Map<string, OfficialAlert>();
    for (const [, data] of queryClient.getQueriesData<{ reports?: Report[]; officialAlerts?: OfficialAlert[] }>({ queryKey: qk.reportsRoot })) {
      for (const r of data?.reports ?? []) seen.set(r.id, r);
      for (const a of data?.officialAlerts ?? []) alerts.set(a.id, a);
    }
    for (const [, data] of queryClient.getQueriesData<{ items?: Report[]; officialAlerts?: OfficialAlert[] }>({ queryKey: ["around"] })) {
      for (const r of data?.items ?? []) seen.set(r.id, r);
      for (const a of data?.officialAlerts ?? []) alerts.set(a.id, a);
    }
    try {
      for (const c of await db.reports.toArray()) if (!seen.has(c.id)) seen.set(c.id, c);
    } catch {
      /* IndexedDB indisponible */
    }
    const found = computeAlerts(pos, [...seen.values()], [...alerts.values()], prefs, new Set(notified.current.keys()));
    for (const a of found.slice(0, 3)) {
      for (const k of notifiedKeysFor(a)) notified.current.set(k, Date.now());
      toast.show({
        title: a.message,
        tone: a.severity === "info" ? "info" : "warning",
        duration: 0,
        assertive: a.severity !== "info",
        action: a.reportId ? { label: "Voir", onClick: () => navigate(`/reports/${a.reportId}`) } : undefined,
      });
      if (a.severity !== "info" && typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(200);
        } catch {
          /* ignore */
        }
      }
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        try {
          new Notification("Mountain Live", { body: a.message, tag: a.key });
        } catch {
          /* ignore */
        }
      }
    }
    if (found.length) saveNotified(notified.current);
  };

  // Nouvelle position : passe immédiate (seuil de 50 m géré dans la passe).
  useEffect(() => {
    void runRef.current(false);
  }, [position?.lat, position?.lng]);

  // Horloge indépendante de la position : détection périodique et ping de présence (limité à 5 min).
  useEffect(() => {
    void runRef.current(true);
    void maybePingPresence();
    const t = window.setInterval(() => {
      void runRef.current(false);
      void maybePingPresence();
    }, ALERT_TICK_MS);
    return () => window.clearInterval(t);
  }, []);

  return null;
}
