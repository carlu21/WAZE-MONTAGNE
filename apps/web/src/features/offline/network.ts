/**
 * Détection de l'état réseau : événements online/offline + vérification légère
 * de /api/v1/health quand la connexion semble douteuse. Alimente useUiStore().online.
 */
import { useEffect } from "react";
import { API_PREFIX } from "@mountain-live/core";
import { useUiStore } from "@/store/ui";

export const HEALTH_INTERVAL_MS = 60_000;
const listeners = new Set<(online: boolean) => void>();
let started = false;
let healthTimer: number | null = null;

export function onNetworkChange(fn: (online: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setOnline(v: boolean) {
  const prev = useUiStore.getState().online;
  useUiStore.getState().setOnline(v);
  if (prev !== v) for (const l of listeners) l(v);
}

export async function checkHealth(timeoutMs = 5000): Promise<boolean> {
  if (typeof fetch === "undefined") return true;
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${(import.meta.env.VITE_API_URL as string | undefined) ?? ""}${API_PREFIX}/health`, { cache: "no-store", signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(t);
  }
}

/** À appeler une fois au démarrage (main.tsx). */
export function initNetwork(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  setOnline(navigator.onLine);
  window.addEventListener("online", () => {
    // navigator.onLine peut être optimiste : on confirme avec /health.
    void checkHealth().then((ok) => setOnline(ok || navigator.onLine));
  });
  window.addEventListener("offline", () => setOnline(false));
  healthTimer = window.setInterval(() => {
    if (!navigator.onLine) return;
    void checkHealth().then((ok) => {
      // Ne bascule hors ligne que si le navigateur est aussi sans réseau ; sinon, l'API est juste injoignable.
      if (!ok && !navigator.onLine) setOnline(false);
      else if (ok && !useUiStore.getState().online) setOnline(true);
    });
  }, HEALTH_INTERVAL_MS);
}

export function stopNetwork(): void {
  if (healthTimer) window.clearInterval(healthTimer);
  healthTimer = null;
  started = false;
}

/** Marque le réseau comme indisponible après un échec réseau applicatif. */
export function reportNetworkFailure(): void {
  if (!navigator.onLine) setOnline(false);
}

export function useNetworkStatus(): boolean {
  const online = useUiStore((s) => s.online);
  useEffect(() => {
    initNetwork();
  }, []);
  return online;
}
