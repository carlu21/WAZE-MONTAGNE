/**
 * Synchronisation de la file d'attente hors connexion (section 9) :
 * rejoue les créations de signalements (idempotentes via clientId, puis photo)
 * et les confirmations ; abandon après 5 tentatives avec notification locale.
 */
import { useEffect, useState } from "react";
import { fr, phrases } from "@mountain-live/core";
import { api, ApiError } from "@/lib/api";
import { db, type OutboxItem } from "@/lib/db";
import { flushOutbox, registerFlush } from "@/lib/outbox";
import { qk } from "@/lib/queryKeys";
import { queryClient } from "@/lib/queryClient";
import { useUiStore } from "@/store/ui";
import { useSessionStore } from "@/store/session";
import { toast } from "@/components/ui";
import { onNetworkChange } from "./network";

export const MAX_ATTEMPTS = 5;
export const SYNC_INTERVAL_MS = 2 * 60_000;
export const SYNCED_EVENT = "ml:synced";

let flushing = false;
let timer: number | null = null;
let started = false;

function isPermanentError(e: unknown): boolean {
  // Erreurs métier définitives (validation, interdit, introuvable) : inutile de réessayer.
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429;
}

async function sendItem(item: OutboxItem): Promise<void> {
  if (item.kind === "create_report") {
    const { report } = await api.reports.create(item.payload);
    if (item.photo) {
      try {
        await api.reports.uploadPhoto(report.id, item.photo);
      } catch (e) {
        // Le signalement est publié ; la photo est abandonnée si le serveur la refuse définitivement.
        if (!isPermanentError(e)) throw e;
      }
    }
    return;
  }
  await api.reports.confirm(item.payload.reportId, { kind: item.payload.kind, comment: item.payload.comment ?? null });
}

export async function flushImpl(): Promise<{ sent: number; failed: number }> {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    const { online } = useUiStore.getState();
    const { token } = useSessionStore.getState();
    if (!online) return { sent, failed };
    const items = await db.outbox.orderBy("createdAt").toArray();
    if (items.length === 0) return { sent, failed };
    if (!token) return { sent, failed: items.length }; // reconnexion nécessaire : on garde la file
    for (const item of items) {
      try {
        await sendItem(item);
        await db.outbox.delete(item.id);
        sent += 1;
      } catch (e) {
        failed += 1;
        const lastError = e instanceof Error ? e.message : String(e);
        if (!(e instanceof ApiError)) {
          // Erreur réseau (serveur injoignable, délai) : l'action est conservée sans compter d'échec ;
          // on réessaiera au prochain retour du réseau. Jamais de perte de données pour cause de réseau.
          await db.outbox.update(item.id, { lastError });
          break;
        }
        const attempts = item.attempts + 1;
        if (isPermanentError(e) || attempts >= MAX_ATTEMPTS) {
          await db.outbox.delete(item.id);
          toast.warning({ title: "Action hors connexion abandonnée", description: item.kind === "create_report" ? `Signalement non publié : ${lastError}` : `Confirmation non envoyée : ${lastError}` });
        } else {
          await db.outbox.update(item.id, { attempts, lastError });
          if (e.status === 401) break; // session expirée : on s'arrête
        }
      }
    }
    if (sent > 0) {
      void queryClient.invalidateQueries({ queryKey: qk.reportsRoot });
      useUiStore.getState().setLastSyncAt(Date.now());
      window.dispatchEvent(new CustomEvent(SYNCED_EVENT, { detail: { sent } }));
      toast.success(`${fr.offline.synced} — ${sent} ${sent > 1 ? "actions envoyées" : "action envoyée"}`);
    }
    return { sent, failed };
  } finally {
    flushing = false;
  }
}

/** À appeler une fois au démarrage (main.tsx). */
export function initSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  registerFlush(flushImpl);
  onNetworkChange((online) => {
    if (online) void flushOutbox();
  });
  timer = window.setInterval(() => void flushOutbox(), SYNC_INTERVAL_MS);
  window.setTimeout(() => void flushOutbox(), 3000);
}

export function stopSync(): void {
  if (timer) window.clearInterval(timer);
  timer = null;
  started = false;
}

/** Nombre d'actions en attente (rafraîchi toutes les 5 s et après chaque synchronisation). */
export function useOutboxCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const refresh = () => void db.outbox.count().then((n) => alive && setCount(n));
    refresh();
    const t = window.setInterval(refresh, 5000);
    window.addEventListener(SYNCED_EVENT, refresh);
    return () => {
      alive = false;
      window.clearInterval(t);
      window.removeEventListener(SYNCED_EVENT, refresh);
    };
  }, []);
  return count;
}

export function pendingLabel(n: number): string {
  return phrases.pendingSync(n);
}
