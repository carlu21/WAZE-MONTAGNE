/**
 * Libellés de la collecte : licences, statuts, types de sources, niveaux de
 * qualité. Regroupés ici parce qu'ils sont partagés par les trois onglets du
 * back-office, et testables sans monter de composant.
 */
import type { GpxQualityLevel, LicenceId, ReuseStatus, SourceType } from "@mountain-live/core";

export const LICENCE_LABELS: Record<LicenceId, string> = {
  odbl: "ODbL",
  cc0: "CC0",
  "cc-by": "CC BY",
  "cc-by-sa": "CC BY-SA",
  "cc-by-nc": "CC BY-NC",
  "cc-by-nc-sa": "CC BY-NC-SA",
  "cc-by-nd": "CC BY-ND",
  "etalab-2.0": "Licence Ouverte 2.0",
  "licence-ouverte-1.0": "Licence Ouverte 1.0",
  "public-domain": "Domaine public",
  proprietary: "Propriétaire",
  unknown: "Licence inconnue",
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  open_data: "Open data",
  institutional: "Institution",
  osm: "OpenStreetMap",
  geotrek: "Geotrek",
  platform: "Plateforme",
  club: "Club / fédération",
  partner_api: "API partenaire",
  user_upload: "Dépôt manuel",
};

export const REUSE_LABELS: Record<ReuseStatus, string> = {
  approved: "Réutilisation autorisée",
  review_required: "À vérifier",
  forbidden: "Réutilisation interdite",
};

/** Ton du badge : l'inconnu n'est pas un succès, il n'est pas non plus un échec. */
export const REUSE_TONE: Record<ReuseStatus, "success" | "neutral" | "danger"> = {
  approved: "success",
  review_required: "neutral",
  forbidden: "danger",
};

export const QUALITY_LABELS: Record<GpxQualityLevel, string> = {
  excellent: "Excellente",
  good: "Bonne",
  fair: "Moyenne",
  poor: "Faible",
  unusable: "Inutilisable",
};

export const QUALITY_TONE: Record<GpxQualityLevel, "success" | "neutral" | "danger"> = {
  excellent: "success",
  good: "success",
  fair: "neutral",
  poor: "neutral",
  unusable: "danger",
};

export const TRACE_STATUS_LABELS: Record<string, string> = {
  review_required: "À valider",
  approved: "Validée",
  rejected: "Rejetée",
  merged: "Fusionnée",
};

/** Extension acceptée → format déclaré au serveur. */
export function formatFromFileName(name: string): "gpx" | "kml" | "geojson" | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "gpx") return "gpx";
  if (ext === "kml") return "kml";
  if (ext === "geojson" || ext === "json") return "geojson";
  return null;
}

/** Phrase d'accroche de la vérification des droits, côté déposant (section 17). */
export const RIGHTS_QUESTION = "Disposez-vous des droits nécessaires pour partager cette trace ?";
export const ORIGIN_QUESTION = "Quelle est la provenance de cette trace ?";
