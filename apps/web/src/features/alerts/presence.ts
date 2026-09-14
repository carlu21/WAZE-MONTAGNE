/**
 * Ping de présence agrégée (section 8) : cellule ~1 km calculée par le serveur,
 * jamais d'historique local. Désactivable par l'utilisateur (localStorage ml.presence=off).
 */
import { api } from "@/lib/api";
import { useUiStore } from "@/store/ui";

export const PRESENCE_KEY = "ml.presence";
export const PRESENCE_INTERVAL_MS = 5 * 60_000;
let lastPingAt = 0;

export function isPresenceSharingEnabled(): boolean {
  try {
    return localStorage.getItem(PRESENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setPresenceSharing(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(PRESENCE_KEY);
    else localStorage.setItem(PRESENCE_KEY, "off");
  } catch {
    /* ignore */
  }
}

/** Envoie un ping si la position est connue, le réseau disponible et le dernier ping ancien de 5 min. */
export async function maybePingPresence(now: number = Date.now()): Promise<boolean> {
  if (!isPresenceSharingEnabled()) return false;
  const { position, online } = useUiStore.getState();
  if (!position || !online) return false;
  if (now - lastPingAt < PRESENCE_INTERVAL_MS) return false;
  lastPingAt = now;
  try {
    await api.presence.ping({ lat: position.lat, lng: position.lng });
    return true;
  } catch {
    lastPingAt = now - PRESENCE_INTERVAL_MS + 60_000; // nouvelle tentative dans 1 min
    return false;
  }
}

export function resetPresenceClock(): void {
  lastPingAt = 0;
}
