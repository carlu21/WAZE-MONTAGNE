import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { LoaderCircle, Plus } from "lucide-react";
import { cn } from "./cn";

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
/** md = 48 px (minimum tactile), lg = 56 px (actions principales, gants), xl = 64 px. */
export type ButtonSize = "md" | "lg" | "xl";

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const BASE =
  "inline-flex items-center justify-center gap-2 select-none whitespace-nowrap rounded-lg font-semibold leading-none " +
  "transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55";

const SIZES: Record<ButtonSize, string> = {
  md: "h-12 min-w-12 px-4 text-[17px] [&_svg]:size-5",
  lg: "h-14 min-w-14 px-5 text-[17px] [&_svg]:size-6",
  xl: "h-16 min-w-16 px-6 text-lg [&_svg]:size-6",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover",
  secondary: "bg-primary-soft text-primary-soft-fg hover:bg-primary-soft/75",
  outline: "bg-surface text-fg border-2 border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-fg hover:bg-fg/6",
  /* Rouge : réservé aux actions destructrices / alertes importantes */
  danger: "bg-danger text-danger-fg shadow-sm hover:bg-danger-hover",
};

/** Classes d'un bouton, pour styler un <Link> ou un <label> comme un bouton. */
export function buttonClasses({ variant = "primary", size = "md", fullWidth = false }: ButtonStyleProps = {}): string {
  return cn(BASE, SIZES[size], VARIANTS[variant], fullWidth && "w-full");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {
  /** Affiche un indicateur, désactive le bouton et annonce aria-busy. */
  loading?: boolean;
  /** Texte de remplacement pendant le chargement (ex. « Publication… »). */
  loadingLabel?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    fullWidth,
    loading = false,
    loadingLabel,
    leftIcon,
    rightIcon,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const isDisabled = Boolean(disabled) || loading;
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonClasses({ variant, size, fullWidth }), className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className="shrink-0 animate-spin" aria-hidden="true" />
      ) : leftIcon ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      ) : null}
      <span className="truncate">{loading && loadingLabel ? loadingLabel : children}</span>
      {rightIcon && !loading ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      ) : null}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* LinkButton : lien react-router habillé en bouton                    */
/* ------------------------------------------------------------------ */

export interface LinkButtonProps extends Omit<LinkProps, "className" | "children">, ButtonStyleProps {
  className?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
}

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { variant = "primary", size = "md", fullWidth, leftIcon, rightIcon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <Link
      ref={ref}
      className={cn(buttonClasses({ variant, size, fullWidth }), disabled && "pointer-events-none opacity-55", className)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      {...rest}
    >
      {leftIcon ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
      {rightIcon ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      ) : null}
    </Link>
  );
});

/* ------------------------------------------------------------------ */
/* IconButton                                                          */
/* ------------------------------------------------------------------ */

export type IconButtonSize = 44 | 52;
export type IconButtonVariant = "solid" | "glass" | "ghost" | "outline" | "primary" | "danger";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Obligatoire : un bouton-icône n'a pas de texte visible. */
  "aria-label": string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** État enfoncé (bascule) : ajoute aria-pressed et un style actif. */
  pressed?: boolean;
  shape?: "square" | "round";
  loading?: boolean;
  children: ReactNode;
}

const ICON_SIZES: Record<IconButtonSize, string> = {
  44: "size-11 [&_svg]:size-6",
  52: "size-13 [&_svg]:size-7",
};

const ICON_VARIANTS: Record<IconButtonVariant, string> = {
  solid: "bg-surface text-fg shadow-md hover:bg-surface-2",
  /* Translucide flouté : boutons posés sur la carte */
  glass: "glass-strong text-fg shadow-md hover:bg-surface",
  ghost: "bg-transparent text-fg hover:bg-fg/6",
  outline: "bg-surface text-fg border-2 border-line-strong hover:bg-surface-2",
  primary: "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover",
  danger: "bg-transparent text-danger hover:bg-danger-soft",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 44, variant = "ghost", pressed, shape = "square", loading = false, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center select-none transition-[background-color,color,transform,box-shadow] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 active:scale-95 disabled:pointer-events-none disabled:opacity-55",
        "aria-pressed:bg-primary-soft aria-pressed:text-primary-soft-fg",
        shape === "round" ? "rounded-full" : "rounded-lg",
        ICON_SIZES[size],
        ICON_VARIANTS[variant],
        className,
      )}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      disabled={Boolean(disabled) || loading}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : children}
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Fab : bouton flottant « + Signaler »                                 */
/* ------------------------------------------------------------------ */

export interface FabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Libellé accessible et texte de la version étendue (défaut : « Signaler »). */
  label?: string;
  /** Orange sécurité (défaut) ou vert profond. */
  tone?: "safety" | "forest";
  /** Version pilule avec texte (barre latérale, écran large). */
  extended?: boolean;
  /** Halo pulsant discret pour attirer l'œil (défaut : true). */
  halo?: boolean;
  icon?: ReactNode;
  /** Si fourni, rend un lien react-router au lieu d'un bouton. */
  to?: string;
}

export const Fab = forwardRef<HTMLButtonElement, FabProps>(function Fab(
  { label = "Signaler", tone = "safety", extended = false, halo = true, icon, to, className, ...rest },
  ref,
) {
  const classes = cn(
    "relative inline-flex shrink-0 items-center justify-center gap-2 select-none font-bold text-[17px] shadow-fab",
    "transition-[transform,box-shadow,background-color] duration-150 ease-out active:scale-95",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/50",
    extended ? "h-14 rounded-full px-6" : "rounded-full",
    tone === "safety" ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-primary text-primary-fg hover:bg-primary-hover",
    className,
  );
  const style = extended ? undefined : { width: "var(--fab-size)", height: "var(--fab-size)" };
  const content = (
    <>
      {halo ? <span aria-hidden="true" className="ml-fab-halo pointer-events-none absolute inset-0 rounded-full" /> : null}
      <span className="relative inline-flex items-center gap-2">
        {icon ?? <Plus className={extended ? "size-6" : "size-8"} strokeWidth={2.75} aria-hidden="true" />}
        {extended ? <span>{label}</span> : <span className="sr-only">{label}</span>}
      </span>
    </>
  );
  if (to) {
    // Un lien : on ne transmet que les attributs sûrs pour une ancre.
    const { onClick, id, title, tabIndex } = rest;
    return (
      <Link
        to={to}
        className={classes}
        style={style}
        aria-label={extended ? undefined : label}
        id={id}
        title={title}
        tabIndex={tabIndex}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
      >
        {content}
      </Link>
    );
  }
  return (
    <button ref={ref} type="button" className={classes} style={style} aria-label={extended ? undefined : label} {...rest}>
      {content}
    </button>
  );
});
