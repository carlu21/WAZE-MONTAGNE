/**
 * Date relative auto-rafraîchie (« il y a 35 min »), mise à jour toutes les 30 s
 * et au retour au premier plan. Utilise formatRelative de @mountain-live/core.
 */
import { formatDateTime, formatRelative, toDate } from "@mountain-live/core";
import { useNow } from "./hooks";

export interface RelativeTimeProps {
  date: string | number | Date | null | undefined;
  /** Préfixe (« Signalé », « Dernière confirmation »). */
  prefix?: string;
  /** Intervalle de rafraîchissement (ms). Défaut : 30 000. */
  intervalMs?: number;
  className?: string;
  /** Texte de repli si la date est absente ou invalide. */
  fallback?: string;
}

export function RelativeTime({ date, prefix, intervalMs = 30_000, className, fallback = "" }: RelativeTimeProps) {
  const now = useNow(intervalMs, date != null);
  const d = date == null ? null : toDate(date);
  if (!d) return fallback ? <span className={className}>{fallback}</span> : null;
  const text = formatRelative(d, new Date(now));
  return (
    <time dateTime={d.toISOString()} title={formatDateTime(d)} className={className}>
      {prefix ? `${prefix} ${text}` : text}
    </time>
  );
}
