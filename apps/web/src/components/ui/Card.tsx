/**
 * Carte de contenu. Cliquable via `to` (lien) ou `onClick` (bouton) : ne pas y
 * imbriquer d'autres éléments interactifs dans ce cas.
 */
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

export type CardTone = "default" | "glass" | "outline" | "soft";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: CardTone;
  padding?: "none" | "sm" | "md" | "lg";
  /** Lien react-router : la carte entière est cliquable. */
  to?: string;
  /** Chevron à droite pour signaler la navigation (défaut : true si `to`). */
  chevron?: boolean;
  /** Liseré coloré à gauche (couleur de catégorie, danger…). */
  accentColor?: string;
  as?: "div" | "section" | "article" | "li";
  children?: ReactNode;
}

const TONES: Record<CardTone, string> = {
  default: "bg-surface shadow-sm",
  glass: "glass-strong shadow-md",
  outline: "bg-surface border-2 border-line",
  soft: "bg-surface-2",
};

const PADDINGS: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { tone = "default", padding = "md", to, chevron, accentColor, as = "div", className, style, children, onClick, ...rest },
  ref,
) {
  const interactive = Boolean(to || onClick);
  const classes = cn(
    "relative block w-full overflow-hidden rounded-xl text-left text-fg",
    TONES[tone],
    PADDINGS[padding],
    interactive &&
      "transition-[transform,box-shadow,background-color] duration-150 ease-out hover:shadow-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
    accentColor && "pl-5",
    className,
  );
  const inner = (
    <>
      {accentColor ? (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5" style={{ background: accentColor }} />
      ) : null}
      {interactive && (chevron ?? Boolean(to)) ? (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden="true">
          <ChevronRight className="size-5" />
        </span>
      ) : null}
      <div className={cn(interactive && (chevron ?? Boolean(to)) && "pr-6")}>{children}</div>
    </>
  );

  if (to) {
    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        to={to}
        className={classes}
        style={style}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
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
        className={classes}
        style={style}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLButtonElement>}
        {...(rest as HTMLAttributes<HTMLButtonElement>)}
      >
        {inner}
      </button>
    );
  }
  // Les balises acceptées partagent l'interface HTMLElement : on fixe le type pour la ref.
  const Tag = as as "div";
  return (
    <Tag ref={ref as React.Ref<HTMLDivElement>} className={classes} style={style} {...(rest as HTMLAttributes<HTMLDivElement>)}>
      {inner}
    </Tag>
  );
});

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** En-tête standard d'une carte : icône, titre, sous-titre, actions. */
export function CardHeader({ title, subtitle, icon, actions, className }: CardHeaderProps) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      {icon ? (
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg [&_svg]:size-5" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h3 className="text-[17px] font-bold leading-tight text-fg">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-[14px] leading-snug text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}
