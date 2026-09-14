/**
 * Chiffre-clé : valeur mise en avant et libellé (profil, tableaux de bord).
 */
import type { ReactNode } from "react";
import { cn } from "./cn";
import { formatNumber } from "@/lib/format";

export interface StatProps {
  value: number | string;
  label: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "primary" | "accent" | "danger";
  size?: "md" | "lg";
  /** Alignement centré (grilles de statistiques). */
  align?: "start" | "center";
  className?: string;
}

const TONES = {
  default: "text-fg",
  primary: "text-primary",
  accent: "text-accent",
  danger: "text-danger",
} as const;

export function Stat({ value, label, icon, tone = "default", size = "md", align = "start", className }: StatProps) {
  const display = typeof value === "number" ? formatNumber(value) : value;
  return (
    <div className={cn("flex min-w-0 flex-col", align === "center" ? "items-center text-center" : "items-start", className)}>
      <span className={cn("flex items-center gap-1.5 tabular font-bold leading-none", TONES[tone], size === "lg" ? "text-[32px]" : "text-[24px]")}>
        {icon ? (
          <span className={cn("inline-flex shrink-0", size === "lg" ? "[&_svg]:size-7" : "[&_svg]:size-5")} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {display}
      </span>
      <span className="mt-1 text-[13px] font-medium leading-snug text-muted">{label}</span>
    </div>
  );
}
