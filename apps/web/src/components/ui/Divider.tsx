/**
 * Séparateur horizontal (avec libellé optionnel : « ou ») ou vertical.
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface DividerProps {
  orientation?: "horizontal" | "vertical";
  label?: ReactNode;
  className?: string;
  /** Marge verticale (défaut : my-3). */
  spacing?: "none" | "sm" | "md" | "lg";
}

const SPACING = { none: "", sm: "my-2", md: "my-3", lg: "my-5" } as const;

export function Divider({ orientation = "horizontal", label, className, spacing = "md" }: DividerProps) {
  if (orientation === "vertical") {
    return <span role="separator" aria-orientation="vertical" className={cn("inline-block h-6 w-px self-center bg-line", className)} />;
  }
  if (label) {
    return (
      <div role="separator" className={cn("flex items-center gap-3 text-[13px] font-semibold uppercase tracking-wide text-subtle", SPACING[spacing], className)}>
        <span className="h-px flex-1 bg-line" />
        <span>{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return <hr className={cn("h-px w-full border-0 bg-line", SPACING[spacing], className)} />;
}
