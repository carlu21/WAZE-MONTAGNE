/**
 * Résolution dynamique des icônes lucide à partir des noms kebab-case de la
 * taxonomie (packages/core/src/taxonomy.ts : CATEGORIES[].icon, SUBTYPES[].icon,
 * PRACTICES[].icon, BADGES[].icon, CONFIRMATION_KINDS[].icon).
 *
 * - « tree-pine » → lucide.TreePine ; « loader-2 » → lucide.Loader2
 * - Les noms absents de lucide (ex. « horse ») passent par ICON_ALIASES.
 * - Ultime repli : « map-pin ».
 *
 * Note bundle : l'import en espace de noms empêche l'élagage de lucide-react.
 * C'est un choix assumé (résolution robuste de toute icône de la taxonomie) ;
 * si le poids devient un problème, remplacer l'espace de noms par un registre
 * statique des ~90 icônes utilisées.
 */
import * as lucide from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const FALLBACK_ICON = "map-pin";

/**
 * Alias : nom demandé → candidats essayés dans l'ordre. Sert pour les icônes qui
 * n'existent pas (ou plus) dans lucide, et pour les anciens noms renommés.
 * Les proxys visuels sont documentés dans docs/DESIGN_SYSTEM.md.
 */
export const ICON_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // Animaux sans équivalent lucide
  horse: ["magnet", "paw-print"], // fer à cheval (magnet) : proxy équestre
  cow: ["beef", "paw-print"],
  panda: ["paw-print"],
  boar: ["piggy-bank", "paw-print"],
  // Noms potentiellement absents selon la version de lucide
  beef: ["ham", "paw-print"],
  "piggy-bank": ["paw-print"],
  axe: ["hammer", "pickaxe", "logs"],
  shrub: ["sprout", "leaf", "trees"],
  "brick-wall": ["fence", "construction", "blocks"],
  volcano: ["mountain", "flame"],
  // Anciens noms lucide → nouveaux noms
  "alert-triangle": ["triangle-alert"],
  "alert-octagon": ["octagon-alert"],
  "alert-circle": ["circle-alert"],
  "x-circle": ["circle-x"],
  "check-circle": ["circle-check"],
  "check-circle-2": ["circle-check-big"],
  "help-circle": ["circle-help"],
  "loader-2": ["loader-circle"],
  home: ["house"],
  filter: ["funnel"],
  "more-horizontal": ["ellipsis"],
  "more-vertical": ["ellipsis-vertical"],
  "user-circle": ["circle-user-round"],
  "map-pin-off": ["map-pin-x", "map-pin"],
};

/** « tree-pine » → « TreePine », « loader-2 » → « Loader2 ». Laisse un nom déjà en PascalCase intact. */
export function kebabToPascal(name: string): string {
  return name
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const registry = lucide as unknown as Record<string, unknown>;

/** Un export lucide est-il un composant d'icône (forwardRef) ? */
function isIconComponent(value: unknown): value is LucideIcon {
  if (!value) return false;
  const t = typeof value;
  if (t !== "object" && t !== "function") return false;
  const v = value as { $$typeof?: unknown; render?: unknown };
  return "$$typeof" in v && typeof v.render === "function";
}

const cache = new Map<string, LucideIcon | null>();

/** Cherche une icône par nom exact (kebab-case ou PascalCase). `undefined` si absente. */
export function findLucideIcon(name: string): LucideIcon | undefined {
  const pascal = kebabToPascal(name);
  if (!pascal || pascal === "Icon") return undefined;
  const cached = cache.get(pascal);
  if (cached !== undefined) return cached ?? undefined;
  const candidate = registry[pascal];
  const icon = isIconComponent(candidate) ? candidate : null;
  cache.set(pascal, icon);
  return icon ?? undefined;
}

/** L'icône existe-t-elle (directement ou via alias) ? */
export function hasLucideIcon(name: string | null | undefined): boolean {
  if (!name) return false;
  return resolveLucideIconName(name) !== FALLBACK_ICON || findLucideIcon(name) !== undefined;
}

/**
 * Nom kebab-case effectivement utilisé après application des alias et du repli.
 * Utile pour les tests, la documentation et les identifiants d'images de carte.
 */
export function resolveLucideIconName(name: string | null | undefined): string {
  if (!name) return FALLBACK_ICON;
  if (findLucideIcon(name)) return name;
  const aliases = ICON_ALIASES[name];
  if (aliases) for (const alt of aliases) if (findLucideIcon(alt)) return alt;
  return FALLBACK_ICON;
}

/** Composant lucide pour un nom de la taxonomie, avec alias et repli « map-pin ». */
export function resolveLucideIcon(name: string | null | undefined): LucideIcon {
  const resolved = resolveLucideIconName(name);
  return findLucideIcon(resolved) ?? (lucide.MapPin as LucideIcon);
}

export type { LucideIcon, LucideProps } from "lucide-react";
