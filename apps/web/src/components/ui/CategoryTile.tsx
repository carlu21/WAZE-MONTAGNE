/**
 * Tuiles tactiles du parcours de signalement (section 4) :
 * - CategoryTile : grande tuile (icône 32 px + libellé + description), couleur de catégorie.
 * - SubtypeTile : tuile de sous-type, plus compacte, colorée par sa catégorie.
 * Les deux sont des boutons (aria-pressed si `selected` est défini) ou des liens (`to`).
 */
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { CATEGORY_BY_ID, SUBTYPE_BY_ID, type ReportCategory, type ReportSubtype } from "@mountain-live/core";
import { cn } from "./cn";
import { CategoryIcon } from "./CategoryIcon";

interface TileBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  selected?: boolean;
  /** Rend un lien react-router au lieu d'un bouton. */
  to?: string;
  /** Chevron de navigation à droite (défaut : true pour la tuile de catégorie). */
  chevron?: boolean;
}

const TILE_BASE =
  "ml-tile relative flex w-full items-center gap-4 rounded-2xl text-left text-fg " +
  "transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-55";

export interface CategoryTileProps extends TileBaseProps {
  category: ReportCategory;
  /** Masque la description (grille serrée). */
  compact?: boolean;
}

export const CategoryTile = forwardRef<HTMLButtonElement, CategoryTileProps>(function CategoryTile(
  { category, selected, to, chevron, compact = false, className, style, type = "button", ...rest },
  ref,
) {
  const def = CATEGORY_BY_ID[category];
  const vars = { "--tile-color": `var(${def.colorVar})` } as CSSProperties;
  const showChevron = chevron ?? Boolean(to);
  const inner = (
    <>
      <span className="ml-tile__disc inline-flex size-16 shrink-0 items-center justify-center rounded-2xl" aria-hidden="true">
        <CategoryIcon name={def.icon} size={32} strokeWidth={2.25} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[18px] font-bold leading-tight">{def.label}</span>
        {!compact ? <span className="mt-1 block text-[14px] leading-snug text-muted">{def.description}</span> : null}
      </span>
      {showChevron ? <ChevronRight className="size-6 shrink-0 text-subtle" aria-hidden="true" /> : null}
    </>
  );
  const classes = cn(TILE_BASE, "min-h-[88px] p-3 pr-4", className);
  const mergedStyle = { ...vars, ...style };

  if (to) {
    const { onClick, id, title, tabIndex } = rest;
    return (
      <Link
        to={to}
        className={classes}
        style={mergedStyle}
        data-category={category}
        id={id}
        title={title}
        tabIndex={tabIndex}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type} className={classes} style={mergedStyle} aria-pressed={selected} data-category={category} {...rest}>
      {inner}
    </button>
  );
});

export interface SubtypeTileProps extends TileBaseProps {
  subtype: ReportSubtype;
  /** Ligne secondaire (durée par défaut, indication…). */
  hint?: string;
  /** Disposition verticale (grille 2 colonnes) ou horizontale (liste). */
  layout?: "row" | "column";
}

export const SubtypeTile = forwardRef<HTMLButtonElement, SubtypeTileProps>(function SubtypeTile(
  { subtype, selected, to, chevron = false, hint, layout = "row", className, style, type = "button", ...rest },
  ref,
) {
  const def = SUBTYPE_BY_ID[subtype];
  const cat = CATEGORY_BY_ID[def.category];
  const vars = { "--tile-color": `var(${cat.colorVar})` } as CSSProperties;
  const column = layout === "column";
  const inner = (
    <>
      <span className={cn("ml-tile__disc inline-flex shrink-0 items-center justify-center rounded-xl", column ? "size-14" : "size-12")} aria-hidden="true">
        <CategoryIcon name={def.icon} size={column ? 28 : 24} strokeWidth={2.25} />
      </span>
      <span className={cn("min-w-0 flex-1", column && "text-center")}>
        <span className={cn("block font-bold leading-tight", column ? "text-[15px]" : "text-[16px]")}>{def.label}</span>
        {hint ? <span className="mt-0.5 block text-[13px] leading-snug text-muted">{hint}</span> : null}
      </span>
      {chevron ? <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden="true" /> : null}
    </>
  );
  const classes = cn(TILE_BASE, column ? "min-h-[120px] flex-col justify-center gap-2 p-3" : "min-h-16 gap-3 p-2.5 pr-3", className);
  const mergedStyle = { ...vars, ...style };

  if (to) {
    const { onClick, id, title, tabIndex } = rest;
    return (
      <Link
        to={to}
        className={classes}
        style={mergedStyle}
        data-subtype={subtype}
        id={id}
        title={title}
        tabIndex={tabIndex}
        onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type} className={classes} style={mergedStyle} aria-pressed={selected} data-subtype={subtype} {...rest}>
      {inner}
    </button>
  );
});
