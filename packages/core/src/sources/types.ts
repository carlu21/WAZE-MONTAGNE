/**
 * Collecte des données de sentiers existantes — contrat partagé.
 *
 * Objectif (section 26 du cahier des charges « traces GPX ») : ne pas
 * collectionner des fichiers GPX, mais transformer des données dispersées sur
 * Internet en un **réseau géospatial structuré**. L'objet central reste le
 * SEGMENT DE CHEMIN ; un GPX n'est qu'une source qui l'atteste.
 *
 * La chaîne est toujours la même :
 *
 *   recherche → vérification de la source → vérification des DROITS
 *   → téléchargement ou API → analyse → contrôle qualité → comparaison
 *   aux autres sources → rattachement au réseau → conservation de la
 *   provenance et de la licence
 *
 * Trois règles structurantes traversent tout le module :
 *
 * 1. **Les droits d'abord** (sections 2, 3). Un bouton « Télécharger GPX » ne
 *    vaut pas autorisation de réutilisation. Sans licence identifiée, rien
 *    n'entre automatiquement : le statut est `review_required`, jamais
 *    `approved` par défaut. Le module ne connaît aucun moyen de passer outre.
 * 2. **Un GPX est une OBSERVATION, pas la vérité** (section 24). Il peut être
 *    ancien, approximatif, tracé à la main, passer sur une zone désormais
 *    interdite ou suivre un chemin disparu. Il augmente la confiance d'une
 *    géométrie, il ne la décrète pas.
 * 3. **Rien n'écrase rien** (sections 11, 14, 20, 21). Les géométries
 *    coexistent par couche, avec leur provenance ; une correction se propose,
 *    elle ne s'applique pas d'office, et l'historique est conservé.
 *
 * Les tables correspondantes sont décrites dans docs/SOURCES_GPX.md.
 */
import type { LngLat } from "../geo";
import type { BBox } from "../types";
import type { ActivityMode, PathSegment } from "../navigation/types";

/* ------------------------------------------------------------------ */
/* 1. Licences et droits de réutilisation (sections 2, 3, 22)          */
/* ------------------------------------------------------------------ */

/**
 * Licences rencontrées sur les données de sentiers françaises et
 * internationales. `unknown` n'est pas un défaut commode : c'est un état qui
 * bloque l'importation automatique.
 */
export type LicenceId =
  | "odbl" // OpenStreetMap et dérivés : partage à l'identique
  | "cc0"
  | "cc-by"
  | "cc-by-sa"
  | "cc-by-nc"
  | "cc-by-nc-sa"
  | "cc-by-nd"
  | "etalab-2.0" // Licence Ouverte / Open Licence v2.0 (data.gouv.fr)
  | "licence-ouverte-1.0"
  | "public-domain"
  | "proprietary"
  | "unknown";

/** Ce qu'une licence autorise réellement, sans interprétation optimiste. */
export interface LicenceTerms {
  id: LicenceId;
  name: string;
  url: string | null;
  /** Réutilisation dans un service commercial. */
  commercialReuse: boolean;
  /** Redistribution des données (y compris via notre API). */
  redistribution: boolean;
  /** Attribution obligatoire de la source. */
  attributionRequired: boolean;
  /** Partage à l'identique : nos dérivés doivent porter la même licence. */
  shareAlike: boolean;
  /** Œuvres dérivées autorisées (une géométrie recalée EST un dérivé). */
  derivativesAllowed: boolean;
}

/** Décision d'exploitation d'une source ou d'une ressource (section 5). */
export type ReuseStatus =
  | "approved" // droits clairs et compatibles : importation automatique possible
  | "review_required" // licence inconnue, ambiguë ou restrictive : décision humaine
  | "forbidden"; // réutilisation explicitement incompatible

/** Pourquoi une ressource n'est pas librement exploitable (diagnostic). */
export type ReuseBlocker =
  | "licence_unknown"
  | "no_commercial_reuse"
  | "no_redistribution"
  | "no_derivatives"
  | "share_alike" // exploitable, mais contamine nos dérivés : décision produit
  | "robots_disallow"
  | "source_forbidden";

export interface ReuseDecision {
  status: ReuseStatus;
  blockers: ReuseBlocker[];
  /** Mention d'attribution à afficher si la donnée est utilisée (section 22). */
  attribution: string | null;
  /** Phrase prête à afficher au modérateur. */
  reason: string;
}

/* ------------------------------------------------------------------ */
/* 2. Registre des sources (section 4)                                 */
/* ------------------------------------------------------------------ */

export type SourceType =
  | "open_data" // data.gouv.fr, plateformes territoriales
  | "institutional" // parc national, PNR, département, commune, office de tourisme
  | "osm" // OpenStreetMap : réseau vectoriel et relations d'itinéraires
  | "geotrek" // instances Geotrek (API publique documentée)
  | "platform" // plateformes de randonnée / trail / VTT / équestre
  | "club" // clubs, fédérations, associations
  | "partner_api" // flux fourni par un partenaire (section 19)
  | "user_upload"; // dépôt manuel par un administrateur ou un utilisateur

/** Statut d'exploitation d'une source dans le registre (section 5). */
export type SourceStatus = "approved" | "review_required" | "forbidden";

/**
 * Source de données (table `data_sources`). Chaque géométrie importée pointe
 * vers une ligne d'ici : on doit toujours pouvoir répondre à « d'où vient ce
 * chemin ? ».
 */
export interface DataSource {
  id: string;
  name: string;
  url: string;
  type: SourceType;
  /** Code pays ISO 3166-1 alpha-2 (« FR »). */
  country: string;
  /** Territoire couvert, le plus précis connu (« FR-2A », « Bastelica »). */
  territory: string | null;
  licence: LicenceId;
  /** URL des conditions réellement consultées (jamais supposées). */
  licenceUrl: string | null;
  commercialReuseAllowed: boolean | null;
  redistributionAllowed: boolean | null;
  attributionRequired: boolean | null;
  /** Mention exacte exigée par la source, si elle en impose une. */
  attributionText: string | null;
  apiAvailable: boolean;
  apiUrl: string | null;
  /** Dernière vérification humaine des conditions (ISO). `null` = jamais vérifiée. */
  lastCheckedAt: string | null;
  /** Fiabilité constatée des données, 0..100. */
  reliabilityScore: number;
  status: SourceStatus;
  notes: string | null;
}

/** Ce qui fait autorité quand plusieurs sources décrivent la même géométrie. */
export type GeometryLayer =
  | "official" // donnée d'un gestionnaire (parc, département, commune)
  | "osm" // réseau vectoriel OpenStreetMap
  | "imported_gpx" // trace importée, licence vérifiée
  | "community" // ligne centrale reconstruite depuis nos passages
  | "observed"; // passages bruts de nos utilisateurs

/* ------------------------------------------------------------------ */
/* 3. Découverte des sources (sections 1, 5, 16, 23)                   */
/* ------------------------------------------------------------------ */

/** Territoire ciblé par une campagne de recherche (section 16). */
export interface Territory {
  /** Identifiant stable (« FR-2A-bastelica »). */
  id: string;
  name: string;
  country: string;
  /** Chaîne de rattachement, du plus large au plus précis. */
  parents: string[];
  bbox: BBox | null;
  /** Noms alternatifs utiles à la recherche (massif, vallée, sommet, refuge). */
  aliases: string[];
}

/** Requête de recherche construite pour un territoire (section 1). */
export interface DiscoveryQuery {
  /** Requête telle qu'elle serait soumise à un moteur ou à un catalogue. */
  query: string;
  /** Terme générique employé (« randonnée GPX »). */
  term: string;
  /** Qualificatif géographique employé (« Bastelica »). */
  place: string;
  activity: ActivityMode | "all";
  /** Priorité 0..1 : les sources institutionnelles d'abord (section 2). */
  priority: number;
}

/** Ressource repérée par la découverte, avant toute décision (section 5). */
export interface DiscoveredResource {
  /** Identifiant déterministe dérivé de l'URL : une relance ne duplique rien. */
  id: string;
  url: string;
  title: string | null;
  sourceId: string | null;
  territory: string | null;
  activity: ActivityMode | "all";
  discoveredAt: number;
  /** Un fichier GPX a-t-il été effectivement constaté (et non supposé) ? */
  hasGpxFile: boolean;
  /** Format constaté. */
  format: "gpx" | "kml" | "geojson" | "api" | "unknown";
  licence: LicenceId;
  status: ReuseStatus;
  /** Pourquoi ce statut, en clair. */
  reason: string;
}

/** Étape de l'assistant d'ouverture d'un territoire (section 23). */
export interface TerritoryStep {
  order: number;
  key:
    | "osm_network"
    | "open_data"
    | "geotrek"
    | "gpx_search"
    | "compare"
    | "build_graph"
    | "coverage_gaps"
    | "community";
  label: string;
  /** Ce que l'étape fait réellement, pour que personne ne l'imagine. */
  detail: string;
  /** L'étape a-t-elle besoin d'un accès réseau sortant ? */
  requiresNetwork: boolean;
}

/* ------------------------------------------------------------------ */
/* 4. Fichiers importés et normalisation (sections 7, 8)               */
/* ------------------------------------------------------------------ */

/** Point d'une trace importée : rien n'est inventé, tout est nullable. */
export interface TracePoint {
  lat: number;
  lng: number;
  /** Altitude (m) si le fichier en portait une. */
  ele: number | null;
  /** Horodatage (ms epoch) si le fichier en portait un. */
  at: number | null;
}

/** Segment de trace tel que le fichier le présentait (`trkseg`). */
export interface TraceSegment {
  points: TracePoint[];
}

/** Point remarquable du fichier (`wpt`). */
export interface TraceWaypoint {
  lat: number;
  lng: number;
  ele: number | null;
  name: string | null;
  description: string | null;
}

/** Métadonnées du fichier d'origine, telles qu'elles s'y trouvaient. */
export interface TraceMetadata {
  name: string | null;
  description: string | null;
  author: string | null;
  /** Mention de copyright rencontrée dans le fichier (indice de licence). */
  copyright: string | null;
  link: string | null;
  /** Logiciel émetteur (`creator`) : utile au diagnostic qualité. */
  creator: string | null;
  time: number | null;
  keywords: string[];
}

/** Contenu d'un fichier de trace, analysé sans perte (section 7). */
export interface ParsedTrace {
  format: "gpx" | "kml" | "geojson";
  metadata: TraceMetadata;
  /** Traces (`trk`) avec leurs segments, dans l'ordre du fichier. */
  tracks: { name: string | null; description: string | null; segments: TraceSegment[] }[];
  /** Itinéraires (`rte`) : suite de points de passage, pas un relevé. */
  routes: { name: string | null; points: TracePoint[] }[];
  waypoints: TraceWaypoint[];
}

/** Motif de nettoyage appliqué à un point lors de la normalisation (section 8). */
export type CleaningFlag =
  | "out_of_bounds" // coordonnée impossible
  | "duplicate" // même position, même instant
  | "spike" // aller-retour instantané incompatible avec la marche
  | "null_island" // (0, 0) : défaut classique d'export
  | "time_disorder"; // horodatage antérieur au point précédent

/** Trace normalisée : la forme commune à toutes les provenances (section 8). */
export interface NormalizedTrace {
  /** Géométrie retenue, `[lng, lat][]`. */
  coordinates: LngLat[];
  /** Altitudes alignées sur `coordinates`, ou null si le fichier n'en avait pas. */
  elevations: number[] | null;
  /** Horodatages alignés, ou null : beaucoup de GPX publiés en sont privés. */
  times: number[] | null;
  lengthM: number;
  elevationGainM: number | null;
  elevationLossM: number | null;
  bbox: BBox;
  /** Nombre de points écartés au nettoyage, par motif. */
  removed: Partial<Record<CleaningFlag, number>>;
  /** Le fichier contenait plusieurs segments disjoints (trace interrompue). */
  segments: number;
  /** Coupures conservées : indices où la trace s'interrompt réellement. */
  breaks: number[];
}

/* ------------------------------------------------------------------ */
/* 5. Qualité d'une trace importée (section 9)                         */
/* ------------------------------------------------------------------ */

export type GpxQualityLevel = "excellent" | "good" | "fair" | "poor" | "unusable";

/** Défaut constaté sur une trace importée. */
export type GpxQualityFlag =
  | "too_few_points"
  | "sparse" // points trop espacés : géométrie grossière
  | "irregular_spacing"
  | "no_elevation"
  | "no_time"
  | "gaps" // interruptions franches
  | "spikes"
  | "duplicates"
  | "self_overlap" // repasse longuement sur elle-même (aller-retour, boucle)
  | "hand_drawn" // espacement trop régulier : tracé à la main, pas un relevé
  | "implausible_speed"
  | "stale"; // trace très ancienne : le terrain a pu changer

export interface GpxQualityReport {
  /** Score 0..100. */
  score: number;
  level: GpxQualityLevel;
  points: number;
  /** Espacement médian entre points consécutifs (m). */
  medianSpacingM: number;
  /** Plus grande interruption (m). */
  maxGapM: number;
  hasElevation: boolean;
  hasTime: boolean;
  /** Âge de la trace en jours, si datée. */
  ageDays: number | null;
  flags: GpxQualityFlag[];
  /** Exploitable pour enrichir le réseau ? (`unusable` ne l'est jamais.) */
  usable: boolean;
  /** Phrase prête à afficher dans la bibliothèque. */
  summary: string;
}

/* ------------------------------------------------------------------ */
/* 6. Comparaison de plusieurs traces (sections 10, 13)                */
/* ------------------------------------------------------------------ */

/** Trace candidate à la comparaison : géométrie + provenance. */
export interface ComparableTrace {
  id: string;
  coordinates: LngLat[];
  sourceId: string | null;
  layer: GeometryLayer;
  /** Date de la trace (ms epoch) si connue. */
  at: number | null;
  quality: number;
}

/** Résultat de la superposition de deux traces (section 10). */
export interface TraceComparison {
  a: string;
  b: string;
  /** Part de A qui suit B à faible distance, 0..1. */
  overlap: number;
  medianDeviationM: number;
  maxDeviationM: number;
  /** Même sens de parcours. */
  sameDirection: boolean;
  /** Portions de A qui s'écartent franchement de B (variantes). */
  variants: { fromM: number; toM: number; maxDeviationM: number }[];
}

/**
 * Faisceau de traces indépendantes suivant le même passage (section 10).
 * Plusieurs traces indépendantes qui suivent le même corridor augmentent la
 * confiance ; une seule trace répétée par la même source ne l'augmente pas.
 */
export interface TraceCorridor {
  id: string;
  traceIds: string[];
  /** Ligne centrale du faisceau. */
  coordinates: LngLat[];
  lengthM: number;
  /** Dispersion latérale (m) entre les traces. */
  dispersionM: number;
  /** Sources DISTINCTES représentées : c'est elle qui fait la confiance. */
  uniqueSources: number;
  confidence: number;
}

/* ------------------------------------------------------------------ */
/* 7. Rattachement au réseau (sections 6, 30)                          */
/* ------------------------------------------------------------------ */

/** Portion d'un itinéraire empruntant un segment connu (section 6). */
export interface ItineraryLeg {
  segmentId: string;
  /** Sens d'emprunt par rapport à la géométrie du segment. */
  reversed: boolean;
  /** Longueur réellement suivie sur ce segment (m). */
  distanceM: number;
  /** Part du segment empruntée, 0..1. */
  coverage: number;
  /** Écart médian (m) entre la trace et le segment. */
  deviationM: number;
}

/**
 * Un itinéraire importé résolu en suite de segments : « GPX randonnée Pozzi »
 * devient « segments 112, 113, 245, 983, 984 » (section 6).
 */
export interface ResolvedItinerary {
  traceId: string;
  legs: ItineraryLeg[];
  /** Longueur totale rattachée (m). */
  matchedM: number;
  /** Longueur sans chemin connu correspondant (m) : matière des nouveaux chemins. */
  unmatchedM: number;
  /** Part rattachée, 0..1. */
  matchedRatio: number;
  /** Portions hors réseau, avec leur géométrie. */
  gaps: { fromM: number; toM: number; coordinates: LngLat[] }[];
}

/* ------------------------------------------------------------------ */
/* 8. Connaissance d'un segment (sections 11, 12, 21, 30)              */
/* ------------------------------------------------------------------ */

/** Une source atteste qu'un segment existe, avec son poids propre. */
export interface SegmentAttestation {
  layer: GeometryLayer;
  sourceId: string | null;
  /** Trace importée à l'origine de l'attestation, le cas échéant. */
  traceId: string | null;
  /** Date de l'attestation (ms epoch). */
  at: number | null;
  /** Écart médian (m) constaté avec la géométrie retenue. */
  deviationM: number | null;
}

/** Ce que l'on sait de la fiabilité d'un segment (section 12). */
export interface SegmentConfidence {
  /** Score 0..100. */
  score: number;
  /** Détail par couche, pour que le chiffre soit explicable. */
  byLayer: Partial<Record<GeometryLayer, number>>;
  /** Sources distinctes attestant le segment. */
  uniqueSources: number;
  /** Traces importées distinctes l'empruntant. */
  traces: number;
  /** Passages réels de nos utilisateurs. */
  passages: number;
  lastEvidenceAt: number | null;
  /** Raisons lisibles, dans l'ordre de contribution au score. */
  reasons: string[];
}

/** Géométrie retenue pour l'affichage, parmi les couches disponibles (section 21). */
export interface GeometryChoice {
  layer: GeometryLayer;
  coordinates: LngLat[];
  sourceId: string | null;
  /** Pourquoi cette couche l'emporte. */
  reason: string;
}

/* ------------------------------------------------------------------ */
/* 9. Propositions issues de la collecte (sections 13, 14)             */
/* ------------------------------------------------------------------ */

/** Chemin attesté par plusieurs sources mais absent de la carte (section 13). */
export interface PotentialExistingTrail {
  id: string;
  coordinates: LngLat[];
  lengthM: number;
  /** Traces importées indépendantes le décrivant. */
  traces: number;
  uniqueSources: number;
  /** Passages de nos utilisateurs sur le même corridor. */
  passages: number;
  dispersionM: number;
  /** Score 0..100. */
  score: number;
  reasons: string[];
}

/** Écart systématique entre une géométrie de référence et les observations (section 14). */
export interface PotentialGeometryCorrection {
  segmentId: string;
  /** Couche portant la géométrie jugée fautive. */
  layer: GeometryLayer;
  coordinates: LngLat[];
  /** Écart médian signé (m). */
  offsetM: number;
  maxOffsetM: number;
  evidence: number;
  uniqueSources: number;
  score: number;
  reasons: string[];
}

/* ------------------------------------------------------------------ */
/* 10. Seuils partagés                                                 */
/* ------------------------------------------------------------------ */

/** Sources indépendantes à partir desquelles un corridor devient crédible. */
export const CORRIDOR_MIN_SOURCES = 2;

/** Écart (m) au-delà duquel deux traces ne décrivent plus le même passage. */
export const SAME_PATH_TOLERANCE_M = 25;

/** Score de qualité sous lequel une trace importée n'entre pas dans le réseau. */
export const MIN_USABLE_QUALITY_SCORE = 40;

/** Une source jamais vérifiée ne peut pas dépasser ce score de fiabilité. */
export const UNVERIFIED_RELIABILITY_CAP = 40;

/** Type des segments produits par l'import (réutilise le contrat du réseau). */
export type ImportedSegment = PathSegment;
