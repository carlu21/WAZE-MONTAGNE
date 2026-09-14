/**
 * Fonds de carte (section 10) : topographique, satellite, classique, relief.
 *
 * Chaque fond est un style MapLibre construit dynamiquement (`buildBasemapStyle`)
 * à partir de tuiles raster publiques. Les couches de données de l'application
 * (signalements, alertes, présence, position…) portent toutes le préfixe
 * `ml-` : `keepOverlays` (à passer en `transformStyle` à `map.setStyle`) les
 * conserve lors d'un changement de fond, avec leurs données GeoJSON.
 */
import type { LayerSpecification, SourceSpecification, StyleSpecification } from "maplibre-gl";
import { fr, type Basemap } from "@mountain-live/core";

/** Glyphes des étiquettes (nombre des clusters). Un seul nom de police par pile : hébergement statique. */
export const GLYPHS_URL = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";
/** Police unique disponible sur l'hébergement de glyphes ci-dessus. */
export const LABEL_FONT = ["Open Sans Bold"];

/** Tuiles d'altitude (terrarium) pour l'ombrage du relief. */
export const TERRAIN_TILES_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

export const BASEMAP_SOURCE_ID = "basemap";
export const BASEMAP_LAYER_ID = "basemap";
export const TERRAIN_SOURCE_ID = "terrain-dem";
export const HILLSHADE_LAYER_ID = "hillshade";
export const BACKGROUND_LAYER_ID = "background";

/** Préfixe des sources et couches de données ajoutées par l'application. */
export const OVERLAY_PREFIX = "ml-";

export interface BasemapDef {
  id: Basemap;
  label: string;
  description: string;
  tiles: string[];
  attribution: string;
  /** Zoom natif maximal des tuiles (au-delà, MapLibre agrandit). */
  maxzoom: number;
  /** Ajoute l'ombrage du relief par-dessus les tuiles. */
  hillshade: boolean;
  /** Couches raster superposées (routes, noms de lieux) : vue « hybride » à la Google Maps. */
  overlays?: BasemapOverlay[];
}

export interface BasemapOverlay {
  id: string;
  tiles: string[];
  attribution?: string;
  maxzoom: number;
  opacity?: number;
}

/** Routes et noms de lieux (fond transparent) à superposer aux images aériennes. */
const ESRI_REFERENCE_OVERLAYS: BasemapOverlay[] = [
  {
    id: "roads",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 19,
    opacity: 0.9,
  },
  {
    id: "places",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
    maxzoom: 19,
  },
];

/** Orthophotos IGN (BD ORTHO, jusqu'à 20 cm) servies par la Géoplateforme, sans clé. */
const IGN_ORTHO_TILES = [
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fjpeg",
];

const OPENTOPOMAP_TILES = ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`);
const OPENTOPOMAP_ATTRIBUTION = "© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)";

export const BASEMAPS: Record<Basemap, BasemapDef> = {
  topo: {
    id: "topo",
    label: fr.profilePage.basemaps.topo,
    description: "Courbes de niveau, sentiers, refuges et sommets.",
    tiles: OPENTOPOMAP_TILES,
    attribution: OPENTOPOMAP_ATTRIBUTION,
    maxzoom: 17,
    hillshade: false,
  },
  satellite: {
    id: "satellite",
    label: fr.profilePage.basemaps.satellite,
    description: "Images aériennes mondiales avec routes et noms de lieux (vue hybride).",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "© Esri, Maxar, Earthstar Geographics, GIS User Community",
    maxzoom: 19,
    hillshade: false,
    overlays: ESRI_REFERENCE_OVERLAYS,
  },
  ortho: {
    id: "ortho",
    label: fr.profilePage.basemaps.ortho,
    description: "Orthophotos IGN haute résolution (France) avec routes et noms de lieux.",
    tiles: IGN_ORTHO_TILES,
    attribution: "© IGN — Géoplateforme (BD ORTHO) | © Esri",
    maxzoom: 19,
    hillshade: false,
    overlays: ESRI_REFERENCE_OVERLAYS,
  },
  classic: {
    id: "classic",
    label: fr.profilePage.basemaps.classic,
    description: "Carte routière standard, très lisible.",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors",
    maxzoom: 19,
    hillshade: false,
  },
  relief: {
    id: "relief",
    label: fr.profilePage.basemaps.relief,
    description: "Topographie avec ombrage du relief.",
    tiles: OPENTOPOMAP_TILES,
    attribution: `${OPENTOPOMAP_ATTRIBUTION} | Terrain © Mapzen, AWS Open Data`,
    maxzoom: 17,
    hillshade: true,
  },
};

/** Ordre de présentation dans le sélecteur (section 10). */
export const BASEMAP_ORDER: readonly Basemap[] = ["topo", "satellite", "ortho", "classic", "relief"];

export function isBasemap(value: unknown): value is Basemap {
  return typeof value === "string" && value in BASEMAPS;
}

/** Style MapLibre complet d'un fond de carte (sans les couches de données). */
export function buildBasemapStyle(basemap: Basemap): StyleSpecification {
  const def = BASEMAPS[basemap] ?? BASEMAPS.topo;
  const sources: Record<string, SourceSpecification> = {
    [BASEMAP_SOURCE_ID]: {
      type: "raster",
      tiles: def.tiles,
      tileSize: 256,
      maxzoom: def.maxzoom,
      attribution: def.attribution,
    },
  };
  const layers: LayerSpecification[] = [
    // Beige naturel pendant le chargement des tuiles (jamais de damier gris).
    { id: BACKGROUND_LAYER_ID, type: "background", paint: { "background-color": "#e8e2d4" } },
    { id: BASEMAP_LAYER_ID, type: "raster", source: BASEMAP_SOURCE_ID, paint: { "raster-fade-duration": 150 } },
  ];
  for (const overlay of def.overlays ?? []) {
    const sourceId = `${BASEMAP_SOURCE_ID}-${overlay.id}`;
    sources[sourceId] = { type: "raster", tiles: overlay.tiles, tileSize: 256, maxzoom: overlay.maxzoom, attribution: overlay.attribution };
    layers.push({ id: `${BASEMAP_LAYER_ID}-${overlay.id}`, type: "raster", source: sourceId, paint: { "raster-fade-duration": 150, "raster-opacity": overlay.opacity ?? 1 } });
  }
  if (def.hillshade) {
    sources[TERRAIN_SOURCE_ID] = {
      type: "raster-dem",
      tiles: [TERRAIN_TILES_URL],
      tileSize: 256,
      encoding: "terrarium",
      maxzoom: 15,
    };
    layers.push({
      id: HILLSHADE_LAYER_ID,
      type: "hillshade",
      source: TERRAIN_SOURCE_ID,
      paint: {
        "hillshade-exaggeration": 0.38,
        "hillshade-shadow-color": "#3f3324",
        "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#4a3f2f",
        "hillshade-illumination-anchor": "map",
      },
    });
  }
  return { version: 8, glyphs: GLYPHS_URL, sources, layers };
}

export function isOverlayId(id: string): boolean {
  return id.startsWith(OVERLAY_PREFIX);
}

/**
 * `transformStyle` pour `map.setStyle` : reporte dans le nouveau style toutes
 * les sources et couches de données (préfixe `ml-`) du style précédent, avec
 * leurs données GeoJSON courantes, afin qu'un changement de fond ne vide pas la carte.
 */
export function keepOverlays(previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!previous) return next;
  const sources: Record<string, SourceSpecification> = { ...next.sources };
  for (const [id, source] of Object.entries(previous.sources ?? {})) {
    if (isOverlayId(id) && !(id in sources)) sources[id] = source;
  }
  const nextIds = new Set(next.layers.map((l) => l.id));
  const overlays = (previous.layers ?? []).filter((l) => isOverlayId(l.id) && !nextIds.has(l.id));
  return { ...next, sources, layers: [...next.layers, ...overlays] };
}
