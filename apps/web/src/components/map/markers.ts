/**
 * Marqueurs de carte (MapLibre) générés à partir de la taxonomie.
 *
 * - buildMarkerSvg() : SVG d'une pastille (goutte ou disque) colorée par
 *   catégorie, avec l'icône lucide du sous-type en blanc.
 * - loadMarkerImages(map) : enregistre une image par sous-type et variante
 *   (default / official / selected) plus une par catégorie (alertes officielles),
 *   en pixelRatio 2 pour rester nette sur écran haute densité.
 * - CATEGORY_COLORS / clusterStyle : constantes partagées par les couches.
 *
 * Utilisation dans une couche symbole :
 *   layout: { "icon-image": ["get", "markerImage"], "icon-anchor": MARKER_ANCHOR, "icon-allow-overlap": true }
 *   paint:  { "icon-opacity": ["get", "fade"] }
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Map as MaplibreMap, CircleLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { CATEGORIES, CATEGORY_BY_ID, SUBTYPES, SUBTYPE_BY_ID, type ReportCategory, type ReportSubtype } from "@mountain-live/core";
import { resolveLucideIcon } from "@/components/ui/icons";

/** Couleurs de catégorie (identiques à CATEGORIES[].color : fixes sur la carte quel que soit le thème). */
export const CATEGORY_COLORS: Record<ReportCategory, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.color]),
) as Record<ReportCategory, string>;

/** Or : liseré des sources officielles. */
export const OFFICIAL_RING_COLOR = "#C9A227";
/** Vert profond : liseré du marqueur sélectionné. */
export const SELECTED_RING_COLOR = "#14351B";
export const MARKER_STROKE_COLOR = "#FFFFFF";

export type MarkerVariant = "default" | "official" | "selected";
export const MARKER_VARIANTS: readonly MarkerVariant[] = ["default", "official", "selected"];
export type MarkerShape = "pin" | "disc";

/** Largeur (px CSS) d'un marqueur standard et d'un marqueur sélectionné. */
export const MARKER_SIZE = 36;
export const MARKER_SIZE_SELECTED = 46;
/** Ancre à utiliser dans la couche symbole pour la forme « goutte ». */
export const MARKER_ANCHOR: "bottom" = "bottom";
/** Ratio hauteur / largeur de la goutte. */
export const PIN_ASPECT = 1.2;

export interface BuildMarkerSvgOptions {
  /** Nom lucide (kebab-case) de l'icône, ex. « tree-pine ». */
  icon: string;
  /** Couleur de fond (hex). */
  color: string;
  /** Largeur en px CSS (défaut : MARKER_SIZE). */
  size?: number;
  /** Liseré doré « source officielle ». */
  official?: boolean;
  /** Marqueur ancien : opacité réduite (section 5). */
  faded?: boolean;
  /** Marqueur sélectionné : liseré sombre épais. */
  selected?: boolean;
  shape?: MarkerShape;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Rendu statique de l'icône lucide en blanc, positionnée dans le repère 40×40 de la pastille. */
function iconMarkup(name: string, x: number, y: number, size: number): string {
  const Icon = resolveLucideIcon(name);
  const svg = renderToStaticMarkup(
    createElement(Icon, { size, color: "#FFFFFF", strokeWidth: 2.4, absoluteStrokeWidth: false, "aria-hidden": true }),
  );
  // On imbrique le <svg> de lucide dans le nôtre en le positionnant.
  return svg.replace(/^<svg /, `<svg x="${x}" y="${y}" `);
}

/**
 * SVG d'un marqueur. Repère interne : 40 unités de large ; 48 de haut pour
 * la goutte (pointe en bas), 40 pour le disque.
 */
export function buildMarkerSvg({ icon, color, size = MARKER_SIZE, official = false, faded = false, selected = false, shape = "pin" }: BuildMarkerSvgOptions): string {
  const fill = escapeAttr(color);
  const width = Math.round(size);
  const height = shape === "pin" ? Math.round(size * PIN_ASPECT) : width;
  const viewH = shape === "pin" ? 48 : 40;
  const ring = selected ? SELECTED_RING_COLOR : official ? OFFICIAL_RING_COLOR : MARKER_STROKE_COLOR;
  const ringWidth = selected ? 3.5 : official ? 3 : 2;
  const opacity = faded ? 0.45 : 1;
  const iconSize = 20;
  const cx = 20;
  const cy = shape === "pin" ? 19 : 20;

  const body =
    shape === "pin"
      ? `<ellipse cx="20" cy="45.5" rx="6" ry="2.2" fill="#000" opacity="0.22"/>` +
        `<path d="M20 2C10.6 2 3 9.6 3 19c0 12.5 17 27 17 27s17-14.5 17-27C37 9.6 29.4 2 20 2z" fill="${fill}" stroke="${ring}" stroke-width="${ringWidth}" stroke-linejoin="round"/>`
      : `<circle cx="20" cy="20" r="17.5" fill="${fill}" stroke="${ring}" stroke-width="${ringWidth}"/>`;

  const officialDot = official && !selected ? `<circle cx="32" cy="7" r="4.5" fill="${OFFICIAL_RING_COLOR}" stroke="#FFFFFF" stroke-width="1.5"/>` : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 40 ${viewH}">` +
    `<g opacity="${opacity}">${body}${iconMarkup(icon, cx - iconSize / 2, cy - iconSize / 2, iconSize)}${officialDot}</g>` +
    `</svg>`
  );
}

/** Data URI d'un SVG (encodage sûr pour les navigateurs). */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Identifiant d'image MapLibre pour un sous-type et une variante. */
export function markerImageId(subtype: ReportSubtype, variant: MarkerVariant = "default"): string {
  return `ml-marker-${subtype}-${variant}`;
}

/** Identifiant d'image pour une catégorie (alertes officielles, repli). */
export function categoryMarkerImageId(category: ReportCategory, variant: MarkerVariant = "default"): string {
  return `ml-marker-cat-${category}-${variant}`;
}

/** Variante à utiliser pour un signalement selon sa source et sa sélection. */
export function markerVariantFor(source: "official" | "partner" | "community", selected = false): MarkerVariant {
  if (selected) return "selected";
  return source === "official" ? "official" : "default";
}

interface MarkerSpec {
  id: string;
  svg: string;
}

function variantOptions(variant: MarkerVariant): Pick<BuildMarkerSvgOptions, "size" | "official" | "selected"> {
  switch (variant) {
    case "official":
      return { size: MARKER_SIZE, official: true };
    case "selected":
      return { size: MARKER_SIZE_SELECTED, selected: true };
    default:
      return { size: MARKER_SIZE };
  }
}

/** Toutes les images à enregistrer : sous-types × variantes + catégories × variantes. */
export function allMarkerSpecs(): MarkerSpec[] {
  const specs: MarkerSpec[] = [];
  for (const s of SUBTYPES) {
    const color = CATEGORY_COLORS[s.category];
    for (const v of MARKER_VARIANTS) specs.push({ id: markerImageId(s.id, v), svg: buildMarkerSvg({ icon: s.icon, color, ...variantOptions(v) }) });
  }
  for (const c of CATEGORIES) {
    for (const v of MARKER_VARIANTS) specs.push({ id: categoryMarkerImageId(c.id, v), svg: buildMarkerSvg({ icon: c.icon, color: c.color, ...variantOptions(v) }) });
  }
  return specs;
}

/** Charge un SVG dans un élément Image dimensionné pour le pixelRatio demandé. */
export function loadSvgImage(svg: string, pixelRatio = 2): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? MARKER_SIZE);
    const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? MARKER_SIZE);
    img.width = width * pixelRatio;
    img.height = height * pixelRatio;
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Impossible de charger le marqueur SVG."));
    img.src = svgToDataUri(svg);
  });
}

/**
 * Enregistre toutes les images de marqueurs sur la carte (idempotent : les
 * images déjà présentes sont ignorées). Une image en échec n'empêche pas les autres.
 */
export async function loadMarkerImages(map: MaplibreMap, pixelRatio = 2): Promise<void> {
  const specs = allMarkerSpecs().filter((s) => !map.hasImage(s.id));
  await Promise.allSettled(
    specs.map(async ({ id, svg }) => {
      const img = await loadSvgImage(svg, pixelRatio);
      if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio });
    }),
  );
}

/** Icône et couleur d'un sous-type (pour légendes, listes, aperçus). */
export function markerAppearance(subtype: ReportSubtype): { icon: string; color: string } {
  const def = SUBTYPE_BY_ID[subtype];
  return { icon: def.icon, color: CATEGORY_COLORS[def.category] };
}

/** Couleur d'une catégorie (repli : gris roche). */
export function categoryColor(category: ReportCategory | null | undefined): string {
  return category ? (CATEGORY_BY_ID[category]?.color ?? "#5B6B7A") : "#5B6B7A";
}

/* ------------------------------------------------------------------ */
/* Clusters (section 10 : regroupement automatique)                    */
/* ------------------------------------------------------------------ */

/** Paramètres de la source GeoJSON groupée. */
export const CLUSTER_SOURCE_OPTIONS = {
  cluster: true,
  clusterRadius: 48,
  clusterMaxZoom: 13,
} as const;

/** Paliers de taille (nombre de points → rayon px). */
export const CLUSTER_RADIUS_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 18],
  [10, 22],
  [50, 27],
  [200, 32],
];

export const clusterStyle = {
  color: "#1F4D28",
  colorDense: "#14351B",
  strokeColor: "#F9F7F1",
  strokeWidth: 3,
  textColor: "#FFFFFF",
  textSize: 14,
  /** Seuil à partir duquel la couleur « dense » s'applique. */
  denseThreshold: 50,
} as const;

/** Peinture de la couche cercle des clusters. */
export const CLUSTER_CIRCLE_PAINT: NonNullable<CircleLayerSpecification["paint"]> = {
  "circle-color": ["step", ["get", "point_count"], clusterStyle.color, clusterStyle.denseThreshold, clusterStyle.colorDense],
  "circle-radius": [
    "step",
    ["get", "point_count"],
    CLUSTER_RADIUS_STEPS[0][1],
    ...CLUSTER_RADIUS_STEPS.slice(1).flatMap(([count, radius]) => [count, radius]),
  ],
  "circle-stroke-color": clusterStyle.strokeColor,
  "circle-stroke-width": clusterStyle.strokeWidth,
  "circle-opacity": 0.95,
};

/** Disposition de la couche texte des clusters (nombre de signalements). */
export const CLUSTER_TEXT_LAYOUT: NonNullable<SymbolLayerSpecification["layout"]> = {
  "text-field": ["get", "point_count_abbreviated"],
  "text-size": clusterStyle.textSize,
  "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
  "text-allow-overlap": true,
};

export const CLUSTER_TEXT_PAINT: NonNullable<SymbolLayerSpecification["paint"]> = {
  "text-color": clusterStyle.textColor,
};

/** Disposition de la couche symbole des signalements individuels. */
export const REPORT_SYMBOL_LAYOUT: NonNullable<SymbolLayerSpecification["layout"]> = {
  "icon-image": ["get", "markerImage"],
  "icon-anchor": MARKER_ANCHOR,
  "icon-allow-overlap": true,
  "icon-ignore-placement": false,
  "icon-size": 1,
  "symbol-sort-key": ["-", 3, ["coalesce", ["get", "priority"], 2]],
};

export const REPORT_SYMBOL_PAINT: NonNullable<SymbolLayerSpecification["paint"]> = {
  "icon-opacity": ["coalesce", ["get", "fade"], 1],
};

/* ------------------------------------------------------------------ */
/* Images ponctuelles (marqueur de recherche…)                          */
/* ------------------------------------------------------------------ */

/** Marqueur temporaire d'un lieu trouvé par la recherche (goutte vert forêt, épingle). */
export const SEARCH_MARKER_IMAGE_ID = "ml-marker-search";

export function searchMarkerSvg(): string {
  return buildMarkerSvg({ icon: "map-pin", color: "#1F4D28", size: MARKER_SIZE_SELECTED, selected: false });
}

/**
 * Enregistre une image SVG sur la carte si elle n'y est pas déjà (utile pour
 * les images hors taxonomie, chargées à la demande).
 */
export async function ensureImage(map: MaplibreMap, id: string, svg: string, pixelRatio = 2): Promise<void> {
  if (map.hasImage(id)) return;
  const img = await loadSvgImage(svg, pixelRatio);
  if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio });
}
