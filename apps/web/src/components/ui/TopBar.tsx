/**
 * Barre haute.
 * - variant « overlay » : translucide, posée sur la carte, contient un champ de
 *   recherche factice (bouton) et des boutons d'action (filtre, position…).
 * - variant « solid » : en-tête classique des écrans de liste (titre, retour, actions).
 */
import { forwardRef, useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { LoaderCircle, Search, X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./Button";

export interface TopBarProps {
  variant?: "overlay" | "solid";
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Élément à gauche (bouton retour, avatar…). */
  leading?: ReactNode;
  /** Boutons d'action à droite (IconButton). */
  actions?: ReactNode;
  /** Texte du champ de recherche factice (défaut : recherche de lieu). */
  searchPlaceholder?: string;
  /** Requête courante affichée dans le champ factice. */
  searchValue?: string;
  onSearchClick?: () => void;
  /** Alternative : le champ factice est un lien vers cette route. */
  searchTo?: string;
  /** Seconde ligne (puces de filtres…), défilable horizontalement. */
  children?: ReactNode;
  className?: string;
}

const DEFAULT_SEARCH_PLACEHOLDER = "Rechercher une montagne, une commune, un col…";

export function TopBar({
  variant = "overlay",
  title,
  subtitle,
  leading,
  actions,
  searchPlaceholder = DEFAULT_SEARCH_PLACEHOLDER,
  searchValue,
  onSearchClick,
  searchTo,
  children,
  className,
}: TopBarProps) {
  const hasSearch = Boolean(onSearchClick || searchTo);
  const searchInner = (
    <>
      <Search className="size-5 shrink-0 text-primary" aria-hidden="true" />
      <span className={cn("min-w-0 flex-1 truncate text-left text-[16px]", searchValue ? "font-semibold text-fg" : "text-muted")}>
        {searchValue || searchPlaceholder}
      </span>
    </>
  );
  const searchClasses =
    "glass-strong flex h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-4 shadow-md transition hover:bg-surface focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40";

  if (variant === "overlay") {
    return (
      <header
        className={cn("pointer-events-none absolute inset-x-0 top-0 z-[var(--z-overlay)] px-3", className)}
        style={{ paddingTop: "calc(var(--safe-top) + 8px)" }}
      >
        <div className="flex items-center gap-2 [&>*]:pointer-events-auto">
          {leading}
          {hasSearch ? (
            searchTo ? (
              <Link to={searchTo} className={searchClasses} aria-label={searchValue ? `Recherche : ${searchValue}` : "Rechercher un lieu"}>
                {searchInner}
              </Link>
            ) : (
              <button type="button" onClick={onSearchClick} className={searchClasses} aria-label={searchValue ? `Recherche : ${searchValue}` : "Rechercher un lieu"}>
                {searchInner}
              </button>
            )
          ) : title ? (
            <div className="glass-strong flex h-12 min-w-0 flex-1 items-center rounded-lg px-4 shadow-md">
              <span className="truncate text-[17px] font-bold">{title}</span>
            </div>
          ) : (
            <span className="flex-1" />
          )}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {children ? (
          <div className="no-scrollbar -mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1 [&>*]:pointer-events-auto">{children}</div>
        ) : null}
      </header>
    );
  }

  return (
    <header
      className={cn("glass-strong sticky top-0 z-[var(--z-overlay)] shrink-0 border-b border-line", className)}
      style={{ paddingTop: "var(--safe-top)" }}
    >
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-3">
        {leading}
        <div className="min-w-0 flex-1">
          {title ? <h1 className="truncate text-lg font-bold leading-tight text-fg">{title}</h1> : null}
          {subtitle ? <p className="truncate text-sm text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children ? <div className="no-scrollbar mx-auto flex w-full max-w-3xl gap-2 overflow-x-auto px-3 pb-2">{children}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* SearchField : vrai champ de recherche                                */
/* ------------------------------------------------------------------ */

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "onSubmit" | "value" | "size"> {
  value: string;
  onChange: (value: string) => void;
  /** Validation (touche Entrée / bouton Rechercher du clavier). */
  onSubmit?: (value: string) => void;
  onClear?: () => void;
  loading?: boolean;
  /** Bouton « Annuler » à droite (fermeture d'un écran de recherche). */
  onCancel?: () => void;
  size?: "md" | "lg";
  className?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onChange, onSubmit, onClear, loading = false, onCancel, size = "md", className, placeholder = "Rechercher…", id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [focused, setFocused] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.(value.trim());
  };
  return (
    <form role="search" onSubmit={submit} className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "relative flex min-w-0 flex-1 items-center rounded-lg border-2 bg-surface transition",
          focused ? "border-primary ring-4 ring-ring/25" : "border-line",
          size === "lg" ? "h-14" : "h-13",
        )}
      >
        <Search className="pointer-events-none absolute left-4 size-5 text-muted" aria-hidden="true" />
        <input
          ref={ref}
          id={inputId}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          className="h-full w-full min-w-0 bg-transparent pl-12 pr-12 text-[17px] text-fg placeholder:text-subtle focus:outline-none"
          {...rest}
        />
        <div className="absolute right-1 flex items-center">
          {loading ? (
            <span className="inline-flex size-11 items-center justify-center text-muted" role="status" aria-label="Recherche en cours">
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            </span>
          ) : value ? (
            <IconButton
              aria-label="Effacer la recherche"
              size={44}
              variant="ghost"
              onClick={() => {
                onChange("");
                onClear?.();
              }}
            >
              <X className="size-5" />
            </IconButton>
          ) : null}
        </div>
      </div>
      {onCancel ? (
        <button type="button" onClick={onCancel} className="h-12 shrink-0 rounded-lg px-3 text-[17px] font-semibold text-primary hover:bg-fg/6">
          Annuler
        </button>
      ) : null}
    </form>
  );
});
