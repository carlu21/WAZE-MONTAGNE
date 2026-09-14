/** Enregistrement du service worker (vite-plugin-pwa) avec notifications de mise à jour. */
import { registerSW } from "virtual:pwa-register";
import { toast } from "@/lib/toast";

export function initServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) return; // désactivé en développement (devOptions.enabled = false)
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast.show({ title: "Nouvelle version disponible", tone: "info", duration: 0, action: { label: "Recharger", onClick: () => void update(true) } });
    },
    onOfflineReady() {
      toast.success("Application prête pour le hors connexion.");
    },
  });
}
