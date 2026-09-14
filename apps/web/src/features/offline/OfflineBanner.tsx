/**
 * Bannière « Mode hors connexion » / « Synchronisation effectuée » (section 9).
 * Invisible en fonctionnement normal.
 */
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { fr, phrases } from "@mountain-live/core";
import { useNetworkStatus } from "./network";
import { SYNCED_EVENT, useOutboxCount } from "./sync";
import { flushOutbox } from "@/lib/outbox";

export const SYNCED_BANNER_MS = 4000;

export function OfflineBanner() {
  const online = useNetworkStatus();
  const pending = useOutboxCount();
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const onSynced = () => {
      setSynced(true);
      window.setTimeout(() => setSynced(false), SYNCED_BANNER_MS);
    };
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, []);

  if (!online) {
    return (
      <div role="status" aria-live="polite" className="z-[var(--z-overlay)] flex items-center gap-2 bg-rock-700 px-4 py-2 text-[13px] font-semibold text-white" data-testid="offline-banner">
        <CloudOff className="size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {fr.offline.mode} — les données affichées peuvent être anciennes{pending ? ` · ${phrases.pendingSync(pending)}` : ""}
        </span>
      </div>
    );
  }
  if (synced) {
    return (
      <div role="status" aria-live="polite" className="z-[var(--z-overlay)] flex items-center gap-2 bg-success px-4 py-2 text-[13px] font-semibold text-white" data-testid="synced-banner">
        <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
        {fr.offline.synced}
      </div>
    );
  }
  if (pending > 0) {
    return (
      <button type="button" onClick={() => void flushOutbox()} className="z-[var(--z-overlay)] flex w-full items-center gap-2 bg-warning-soft px-4 py-2 text-left text-[13px] font-semibold text-fg" data-testid="pending-banner">
        <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
        {phrases.pendingSync(pending)} — appuyez pour réessayer
      </button>
    );
  }
  return null;
}
