/**
 * Ligne de liste : icône, titre, sous-titre, accessoire à droite.
 * Cliquable via `to` (lien) ou `onClick` (bouton). Hauteur minimale 56 px.
 */
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

export interface ListItemProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  icon?: ReactNode;
  /** Couleur de fond du disque d'icône (hex ou var CSS). */
  iconColor?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Accessoire à droite : badge, distance, heure, interrupteur… */
  trailing?: ReactNode;
  to?: string;
  /** Chevron de navigation (défaut : true si `to`). */
  chevron?: boolean;
  disabled?: boolean;
  /** Ligne mise en avant (non lue, sélectionnée). */
  active?: boolean;
  divider?: boolean;
  as?: "div" | "li";
  children?: ReactNode;
}

export const ListItem = forwardRef<HTMLElement, ListItemProps>(function ListItem(
  { icon, iconColor, title, subtitle, trailing, to, chevron, disabled = false, active = false, divider = true, as = "div", className, onClick, children, ...rest },
  ref,
) {
  const interactive = Boolean(to || onClick) && !disabled;
  const showChevron = chevron ?? Boolean(to);
  const classes = cn(
    "flex w-full min-h-14 items-center gap-3 px-4 py-2.5 text-left text-fg",
    divider && "border-b border-line last:border-b-0",
    interactive && "transition-colors duration-150 hover:bg-fg/4 active:bg-fg/8 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:ring-inset",
    active && "bg-primary-soft/40",
    disabled && "opacity-55",
    className,
  );
  const inner = (
    <>
      {icon ? (
        <span
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg [&_svg]:size-6"
          style={iconColor ? { background: `color-mix(in srgb, ${iconColor} 16%, var(--surface))`, color: iconColor } : undefined}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[16px] leading-snug", active ? "font-bold" : "font-semibold")}>{title}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-[14px] leading-snug text-muted">{subtitle}</span> : null}
        {children}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2 text-[14px] text-muted">{trailing}</span> : null}
      {showChevron ? <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden="true" /> : null}
    </>
  );

  if (to && !disabled) {
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        to={to}
        className={classes}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
        aria-current={active ? "true" : undefined}
        {...(rest as HTMLAttributes<HTMLAnchorElement>)}
      >
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        disabled={disabled}
        className={classes}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLButtonElement>}
        {...(rest as HTMLAttributes<HTMLButtonElement>)}
      >
        {inner}
      </button>
    );
  }
  // « div » ou « li » : même interface HTMLElement, on fixe le type pour la ref.
  const Tag = as as "div";
  return (
    <Tag ref={ref as React.Ref<HTMLDivElement>} className={classes} {...(rest as HTMLAttributes<HTMLDivElement>)}>
      {inner}
    </Tag>
  );
});
