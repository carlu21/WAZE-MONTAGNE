/**
 * Bandeau d'information en ligne (hors connexion, avertissement, succès).
 * Le rouge (« danger ») est réservé aux alertes importantes.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { CircleCheck, Info, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./Button";

export type BannerTone = "info" | "warning" | "danger" | "success";

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  /** Action à droite (bouton « Voir », « Réessayer »…). */
  action?: ReactNode;
  /** Affiche un bouton de fermeture qui appelle `onDismiss`. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Version dense sur une ligne (bandeaux système au-dessus de la carte). */
  compact?: boolean;
}

const TONES: Record<BannerTone, { classes: string; icon: ReactNode; role: "status" | "alert" }> = {
  info: { classes: "bg-info-soft text-fg [&_.ml-banner-icon]:text-info", icon: <Info />, role: "status" },
  warning: { classes: "bg-warning-soft text-fg [&_.ml-banner-icon]:text-warning", icon: <TriangleAlert />, role: "status" },
  danger: { classes: "bg-danger-soft text-fg [&_.ml-banner-icon]:text-danger", icon: <OctagonAlert />, role: "alert" },
  success: { classes: "bg-success-soft text-fg [&_.ml-banner-icon]:text-success", icon: <CircleCheck />, role: "status" },
};

export function Banner({ tone = "info", title, children, icon, action, onDismiss, dismissLabel = "Fermer", compact = false, className, ...rest }: BannerProps) {
  const def = TONES[tone];
  return (
    <div
      role={def.role}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl",
        compact ? "min-h-12 px-3 py-2" : "px-4 py-3",
        def.classes,
        className,
      )}
      data-tone={tone}
      {...rest}
    >
      <span className={cn("ml-banner-icon inline-flex shrink-0 [&_svg]:size-6", compact ? "mt-0.5" : "mt-0.5")} aria-hidden="true">
        {icon ?? def.icon}
      </span>
      <div className={cn("min-w-0 flex-1", compact ? "flex flex-wrap items-center gap-x-2 gap-y-0.5" : "")}>
        {title ? <p className="text-[16px] font-bold leading-snug">{title}</p> : null}
        {children ? <div className={cn("text-[15px] leading-snug", Boolean(title) && !compact && "mt-0.5")}>{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      {onDismiss ? (
        <IconButton aria-label={dismissLabel} size={44} variant="ghost" onClick={onDismiss} className="-my-2 -mr-2 shrink-0">
          <X className="size-5" />
        </IconButton>
      ) : null}
    </div>
  );
}
