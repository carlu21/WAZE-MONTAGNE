/**
 * Icône d'une catégorie, d'un sous-type, d'une pratique ou d'un badge de la
 * taxonomie, résolue dynamiquement depuis son nom lucide en kebab-case
 * (voir ./icons.ts pour les alias et le repli « map-pin »).
 *
 *   <CategoryIcon subtype="fallen_tree" size={32} />
 *   <CategoryIcon name="badge-check" label="Officiel" />
 */
import { forwardRef } from "react";
import { CATEGORY_BY_ID, SUBTYPE_BY_ID, type ReportCategory, type ReportSubtype } from "@mountain-live/core";
import { cn } from "./cn";
import { resolveLucideIcon, type LucideProps } from "./icons";

export interface CategoryIconProps extends Omit<LucideProps, "ref" | "name"> {
  /** Nom lucide (kebab-case) tel qu'écrit dans la taxonomie. */
  name?: string;
  /** Raccourci : icône du sous-type. */
  subtype?: ReportSubtype;
  /** Raccourci : icône de la catégorie (utilisé si `subtype` et `name` sont absents). */
  category?: ReportCategory;
  /** Libellé accessible. Sans libellé, l'icône est décorative (aria-hidden). */
  label?: string;
  /** Taille en px (défaut : 24). */
  size?: number;
}

/** Nom d'icône effectif selon la priorité name > subtype > category. */
export function iconNameFor(props: Pick<CategoryIconProps, "name" | "subtype" | "category">): string | undefined {
  if (props.name) return props.name;
  if (props.subtype) return SUBTYPE_BY_ID[props.subtype]?.icon;
  if (props.category) return CATEGORY_BY_ID[props.category]?.icon;
  return undefined;
}

export const CategoryIcon = forwardRef<SVGSVGElement, CategoryIconProps>(function CategoryIcon(
  { name, subtype, category, label, size = 24, strokeWidth = 2, className, ...rest },
  ref,
) {
  const Icon = resolveLucideIcon(iconNameFor({ name, subtype, category }));
  return (
    <Icon
      ref={ref}
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    />
  );
});
