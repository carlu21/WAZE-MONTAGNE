/**
 * Maintien de l'écran allumé pendant une activité (section 2, usage extérieur).
 *
 * Sur un téléphone, le verrouillage de l'écran suspend la page : le suivi GPS
 * s'arrête et la trace se coupe. L'API Screen Wake Lock (HTTPS obligatoire,
 * iOS 16.4+ et Android) évite la mise en veille tant que la navigation est en
 * cours. Le verrou est perdu au passage en arrière-plan : il est repris au
 * retour au premier plan.
 */
let sentinel: WakeLockSentinel | null = null;
let active = false;
let unsubscribe: (() => void) | null = null;

export function wakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

async function acquire(): Promise<void> {
  if (!active || !wakeLockSupported() || sentinel) return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    // Batterie faible, autorisation refusée, onglet en arrière-plan : sans effet.
    sentinel = null;
  }
}

/** Demande le maintien de l'écran et le reprend à chaque retour au premier plan. */
export function keepScreenAwake(): void {
  if (active) return;
  active = true;
  void acquire();
  if (typeof document === "undefined") return;
  const onVisible = () => {
    if (!document.hidden) void acquire();
  };
  document.addEventListener("visibilitychange", onVisible);
  unsubscribe = () => document.removeEventListener("visibilitychange", onVisible);
}

export function releaseScreen(): void {
  active = false;
  unsubscribe?.();
  unsubscribe = null;
  const current = sentinel;
  sentinel = null;
  void current?.release().catch(() => undefined);
}
