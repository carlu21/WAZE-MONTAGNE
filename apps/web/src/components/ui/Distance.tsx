/**
 * Distance lisible (« 320 m », « 1,2 km ») via formatDistance de @mountain-live/core.
 */
import { formatDistance } from "@mountain-live/core";
import { cn } from "./cn";

export interface DistanceProps {
  meters: number | null | undefined;
  /** « À 320 m » (défaut : false). */
  withPrefix?: boolean;
  className?: string;
  fallback?: string;
}

export function Distance({ meters, withPrefix = false, className, fallback = "" }: DistanceProps) {
  if (meters == null || !Number.isFinite(meters)) return fallback ? <span className={className}>{fallback}</span> : null;
  const text = formatDistance(meters);
  return (
    <span className={cn("tabular whitespace-nowrap", className)} aria-label={`${withPrefix ? "À " : ""}${text}`}>
      {withPrefix ? `À ${text}` : text}
    </span>
  );
}
