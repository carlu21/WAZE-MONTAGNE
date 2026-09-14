/**
 * État vide : icône, titre, explication, action.
 */
import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "./cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon, title, description, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg",
          compact ? "size-12 [&_svg]:size-6" : "size-16 [&_svg]:size-8",
        )}
        aria-hidden="true"
      >
        {icon ?? <Inbox />}
      </span>
      <p className={cn("text-balance font-bold leading-tight text-fg", compact ? "text-[16px]" : "text-[18px]")}>{title}</p>
      {description ? <p className="max-w-sm text-balance text-[15px] leading-snug text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
