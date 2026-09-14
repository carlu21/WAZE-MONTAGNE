/**
 * Niveau de fiabilité public (section 16) : 1 à 5 points, jamais de score
 * brut ni de valeur négative.
 */
import { cn } from "./cn";

export interface ReliabilityLevelProps {
  /** Niveau 1..5 ; toute valeur hors bornes est ramenée dans l'intervalle. */
  level: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export const RELIABILITY_MAX = 5;

/** Ramène un niveau quelconque dans 1..5 (jamais négatif, jamais NaN). */
export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(RELIABILITY_MAX, Math.max(1, Math.round(level)));
}

const DOT: Record<NonNullable<ReliabilityLevelProps["size"]>, string> = { sm: "size-2", md: "size-3", lg: "size-4" };

export function ReliabilityLevel({ level, size = "md", showLabel = false, className }: ReliabilityLevelProps) {
  const value = clampLevel(level);
  const label = `Fiabilité : niveau ${value} sur ${RELIABILITY_MAX}`;
  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="img" aria-label={label} title={label} data-level={value}>
      <span className="inline-flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: RELIABILITY_MAX }, (_, i) => (
          <span key={i} className={cn("rounded-full", DOT[size], i < value ? "bg-primary" : "bg-line-strong")} />
        ))}
      </span>
      {showLabel ? (
        <span className={cn("font-semibold text-fg", size === "sm" ? "text-[13px]" : "text-[15px]")} aria-hidden="true">
          Niveau {value}
        </span>
      ) : null}
    </span>
  );
}
