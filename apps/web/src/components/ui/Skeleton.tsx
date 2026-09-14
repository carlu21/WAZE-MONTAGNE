/**
 * Squelettes de chargement (shimmer). Toujours accompagnés d'un texte
 * « Chargement… » pour les lecteurs d'écran via `SkeletonGroup`.
 */
import type { CSSProperties, ReactNode } from "react";
import { cn } from "./cn";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** Forme ronde (avatar, icône). */
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ width, height = 16, circle = false, className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("ml-skeleton block", circle && "rounded-full", className)}
      style={{ width: width ?? (circle ? height : "100%"), height, ...style }}
    />
  );
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** Plusieurs lignes de texte, la dernière plus courte. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <span className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </span>
  );
}

/** Ligne de liste en cours de chargement (icône + deux lignes). */
export function SkeletonListItem({ className }: { className?: string }) {
  return (
    <span className={cn("flex min-h-14 items-center gap-3 px-4 py-2.5", className)} aria-hidden="true">
      <Skeleton circle height={44} />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton height={14} width="70%" />
        <Skeleton height={12} width="45%" />
      </span>
    </span>
  );
}

export interface SkeletonGroupProps {
  label?: string;
  children: ReactNode;
  className?: string;
}

/** Conteneur annoncé comme « Chargement… » (role=status). */
export function SkeletonGroup({ label = "Chargement…", children, className }: SkeletonGroupProps) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
