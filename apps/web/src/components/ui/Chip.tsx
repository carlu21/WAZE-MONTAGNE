/**
 * Puce sélectionnable (filtres de carte, pratiques, durées).
 * - `selected` défini → bouton bascule (aria-pressed).
 * - `category` → icône et couleur de la catégorie (taxonomie).
 * - Hauteur 48 px (md) ou 56 px (lg) : utilisable avec des gants.
 */
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import { CATEGORY_BY_ID, type ReportCategory } from "@mountain-live/core";
import { cn } from "./cn";
import { CategoryIcon } from "./CategoryIcon";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  /** État sélectionné (bouton bascule). Laisser indéfini pour une puce d'action simple. */
  selected?: boolean;
  /** Icône : nœud React ou nom lucide (kebab-case). */
  icon?: ReactNode | string;
  /** Couleur de sélection (hex ou var CSS). Défaut : couleur de la catégorie ou vert forêt. */
  color?: string;
  /** Catégorie : fixe l'icône et la couleur si elles ne sont pas fournies. */
  category?: ReportCategory;
  size?: "md" | "lg";
  /** Compteur affiché à droite (ex. nombre de signalements). */
  count?: number;
  /** Bouton de retrait (puce « tag »). */
  onRemove?: () => void;
  removeLabel?: string;
  children?: ReactNode;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, icon, color, category, size = "md", count, onRemove, removeLabel = "Retirer", className, style, children, type = "button", ...rest },
  ref,
) {
  const cat = category ? CATEGORY_BY_ID[category] : undefined;
  const chipColor = color ?? (cat ? `var(${cat.colorVar})` : undefined);
  const iconNode =
    typeof icon === "string" ? (
      <CategoryIcon name={icon} size={size === "lg" ? 22 : 20} />
    ) : icon !== undefined ? (
      icon
    ) : cat ? (
      <CategoryIcon name={cat.icon} size={size === "lg" ? 22 : 20} />
    ) : null;
  const vars = chipColor ? ({ "--chip-color": chipColor } as CSSProperties) : undefined;

  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "ml-chip inline-flex shrink-0 select-none items-center gap-2 whitespace-nowrap rounded-full font-semibold leading-none",
        "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-55",
        size === "lg" ? "h-14 px-5 text-[17px]" : "h-12 px-4 text-[15px]",
        onRemove && "pr-1.5",
        className,
      )}
      style={{ ...vars, ...style }}
      aria-pressed={selected}
      data-selected={selected || undefined}
      {...rest}
    >
      {iconNode ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {iconNode}
        </span>
      ) : null}
      {/*
        `leading-[1.35]` : la puce est en `leading-none`, et `truncate` masque ce
        qui dépasse — l'accent d'un « À » ou d'un « É » capital sortait du cadre
        et disparaissait. On rend la ligne au texte ; la hauteur de la puce est
        fixe, elle ne bouge pas.
      */}
      <span className="truncate leading-[1.35]">{children}</span>
      {typeof count === "number" ? (
        <span className="tabular rounded-full bg-fg/8 px-1.5 py-0.5 text-[12px] font-bold" aria-label={`${count}`}>
          {count}
        </span>
      ) : null}
      {onRemove ? (
        <span
          role="button"
          tabIndex={0}
          aria-label={removeLabel}
          className="inline-flex size-9 items-center justify-center rounded-full hover:bg-fg/10"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
        >
          <X className="size-4" aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );
});
