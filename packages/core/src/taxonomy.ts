import type {
  ReportCategory,
  ReportSubtype,
  DangerLevel,
  Practice,
  ConfirmationKind,
  ConfidenceLabel,
  ReportStatus,
  ReportSource,
  FlagReason,
  BadgeId,
} from "./types";

const H = 60; // minutes
const D = 24 * H;

export interface CategoryDef {
  id: ReportCategory;
  label: string;
  shortLabel: string;
  /** Nom d'icône lucide (kebab-case) */
  icon: string;
  /** Couleur de base (token du design system) */
  color: string;
  colorVar: string;
  description: string;
  order: number;
}

export interface SubtypeDef {
  id: ReportSubtype;
  category: ReportCategory;
  label: string;
  icon: string;
  /** Durée de vie par défaut (minutes). */
  defaultTtlMin: number;
  /** Bornes proposées à l'utilisateur (minutes). */
  minTtlMin: number;
  maxTtlMin: number;
  /** Le signalement demande-t-il un niveau de danger ? */
  askDangerLevel: boolean;
  /** Le signalement demande-t-il une heure de fin (chasse, travaux, événement) ? */
  askEndTime: boolean;
  /** Le point doit-il être flouté (espèces sensibles) ? */
  sensitive: boolean;
  /** Information persistante à reconfirmer régulièrement (sources, refuges). */
  recurring: boolean;
  /** Pertinent pour ces pratiques (préférences de filtres). */
  relevantFor: Practice[];
  /** Importance d'affichage à faible zoom : 3 = toujours visible, 1 = uniquement zoom élevé. */
  priority: 1 | 2 | 3;
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    id: "danger",
    label: "Danger",
    shortLabel: "Dangers",
    icon: "triangle-alert",
    color: "#C8341F",
    colorVar: "--c-danger",
    description: "Éboulement, arbre tombé, crue, neige, verglas, incendie…",
    order: 1,
  },
  {
    id: "path",
    label: "Chemin / accessibilité",
    shortLabel: "Chemins",
    icon: "route",
    color: "#D9822B",
    colorVar: "--c-path",
    description: "Fermeture, travaux, balisage, obstacle, état du chemin…",
    order: 2,
  },
  {
    id: "activity",
    label: "Chasse / activités",
    shortLabel: "Chasse / activités",
    icon: "target",
    color: "#B45309",
    colorVar: "--c-activity",
    description: "Chasse, battue, travaux forestiers, événement, pastoralisme…",
    order: 3,
  },
  {
    id: "animals",
    label: "Animaux",
    shortLabel: "Animaux",
    icon: "paw-print",
    color: "#6B4F2A",
    colorVar: "--c-animals",
    description: "Troupeau, chiens de protection, bovins, animaux sauvages…",
    order: 4,
  },
  {
    id: "water",
    label: "Eau / ressources",
    shortLabel: "Eau",
    icon: "droplets",
    color: "#1D6FA5",
    colorVar: "--c-water",
    description: "Source, fontaine, point d'eau, refuge, abri…",
    order: 5,
  },
  {
    id: "crowd",
    label: "Fréquentation / usagers",
    shortLabel: "Fréquentation",
    icon: "users",
    color: "#5B6B7A",
    colorVar: "--c-crowd",
    description: "Randonneurs, cavaliers, VTT, véhicules, affluence…",
    order: 6,
  },
];

const ALL: Practice[] = [
  "hiker",
  "trail",
  "rider",
  "mtb",
  "hunter",
  "fisher",
  "shepherd",
  "professional",
  "manager",
  "other",
];
const OUTDOOR: Practice[] = ["hiker", "trail", "rider", "mtb", "fisher"];

function st(
  id: ReportSubtype,
  category: ReportCategory,
  label: string,
  icon: string,
  ttl: { def: number; min: number; max: number },
  opts: Partial<
    Pick<
      SubtypeDef,
      "askDangerLevel" | "askEndTime" | "sensitive" | "recurring" | "relevantFor" | "priority"
    >
  > = {},
): SubtypeDef {
  return {
    id,
    category,
    label,
    icon,
    defaultTtlMin: ttl.def,
    minTtlMin: ttl.min,
    maxTtlMin: ttl.max,
    askDangerLevel: opts.askDangerLevel ?? false,
    askEndTime: opts.askEndTime ?? false,
    sensitive: opts.sensitive ?? false,
    recurring: opts.recurring ?? false,
    relevantFor: opts.relevantFor ?? ALL,
    priority: opts.priority ?? 2,
  };
}

/**
 * Durées de vie (section 5) :
 * - animal sauvage observé : 1 à 3 h
 * - troupeau : quelques heures
 * - chasse : jusqu'à l'heure de fin indiquée
 * - forte fréquentation : 1 à 2 h
 * - arbre tombé : plusieurs jours jusqu'à résolution
 * - éboulement : plusieurs jours ou semaines
 * - source sèche : quelques jours
 * - source active : récurrente, reconfirmée régulièrement
 * - travaux : période renseignée
 * - fermeture officielle : dates de début et de fin
 */
export const SUBTYPES: readonly SubtypeDef[] = [
  // ---- Danger
  st("rockfall", "danger", "Éboulement", "mountain", { def: 14 * D, min: 2 * D, max: 60 * D }, { askDangerLevel: true, priority: 3 }),
  st("fallen_tree", "danger", "Arbre tombé", "tree-pine", { def: 5 * D, min: 1 * D, max: 30 * D }, { askDangerLevel: true, priority: 3 }),
  st("collapsed_path", "danger", "Chemin effondré", "construction", { def: 14 * D, min: 2 * D, max: 90 * D }, { askDangerLevel: true, priority: 3 }),
  st("dangerous_passage", "danger", "Passage dangereux", "alert-octagon", { def: 7 * D, min: 1 * D, max: 60 * D }, { askDangerLevel: true, priority: 3 }),
  st("flood", "danger", "Crue", "waves", { def: 12 * H, min: 2 * H, max: 3 * D }, { askDangerLevel: true, priority: 3 }),
  st("snow", "danger", "Neige / névé", "snowflake", { def: 3 * D, min: 12 * H, max: 30 * D }, { askDangerLevel: true, priority: 2 }),
  st("ice", "danger", "Verglas", "thermometer-snowflake", { def: 1 * D, min: 6 * H, max: 7 * D }, { askDangerLevel: true, priority: 2 }),
  st("fire", "danger", "Incendie / risque incendie", "flame", { def: 12 * H, min: 2 * H, max: 7 * D }, { askDangerLevel: true, priority: 3 }),
  st("other_danger", "danger", "Autre danger", "triangle-alert", { def: 2 * D, min: 2 * H, max: 30 * D }, { askDangerLevel: true, priority: 2 }),

  // ---- Chemin / accessibilité
  st("path_closed", "path", "Chemin fermé", "ban", { def: 7 * D, min: 1 * D, max: 180 * D }, { askEndTime: true, priority: 3 }),
  st("path_impassable", "path", "Chemin impraticable", "octagon-x", { def: 5 * D, min: 12 * H, max: 60 * D }, { askDangerLevel: true, priority: 3 }),
  st("works", "path", "Travaux", "hard-hat", { def: 7 * D, min: 1 * D, max: 180 * D }, { askEndTime: true, priority: 2 }),
  st("path_cluttered", "path", "Sentier encombré", "shrub", { def: 7 * D, min: 1 * D, max: 60 * D }, { priority: 1 }),
  st("signage_issue", "path", "Problème de balisage", "signpost", { def: 30 * D, min: 7 * D, max: 180 * D }, { priority: 1 }),
  st("poor_condition", "path", "Mauvais état du chemin", "footprints", { def: 14 * D, min: 2 * D, max: 90 * D }, { priority: 1 }),
  st("obstacle", "path", "Obstacle", "brick-wall", { def: 5 * D, min: 12 * H, max: 60 * D }, { askDangerLevel: true, priority: 2 }),
  st("access_restriction", "path", "Restriction d'accès", "lock", { def: 14 * D, min: 1 * D, max: 365 * D }, { askEndTime: true, priority: 3 }),
  st("no_signal", "path", "Zone sans réseau", "wifi-off", { def: 90 * D, min: 7 * D, max: 365 * D }, { recurring: true, priority: 1 }),

  // ---- Chasse / activités
  st("hunting", "activity", "Chasse en cours", "crosshair", { def: 6 * H, min: 1 * H, max: 14 * H }, { askEndTime: true, priority: 3, relevantFor: ALL }),
  st("battue", "activity", "Battue", "megaphone", { def: 6 * H, min: 1 * H, max: 14 * H }, { askEndTime: true, priority: 3 }),
  st("zone_occupied", "activity", "Zone temporairement occupée", "map-pin-off", { def: 6 * H, min: 1 * H, max: 3 * D }, { askEndTime: true, priority: 2 }),
  st("forestry_works", "activity", "Travaux forestiers", "axe", { def: 3 * D, min: 4 * H, max: 90 * D }, { askEndTime: true, priority: 2 }),
  st("sport_event", "activity", "Événement sportif", "trophy", { def: 8 * H, min: 2 * H, max: 3 * D }, { askEndTime: true, priority: 2 }),
  st("pastoral_activity", "activity", "Activité pastorale", "tent", { def: 12 * H, min: 2 * H, max: 30 * D }, { priority: 1 }),

  // ---- Animaux
  st("herd", "animals", "Troupeau", "beef", { def: 4 * H, min: 1 * H, max: 24 * H }, { priority: 2 }),
  st("guard_dogs", "animals", "Chiens de protection", "dog", { def: 6 * H, min: 1 * H, max: 3 * D }, { askDangerLevel: true, priority: 3 }),
  st("cattle", "animals", "Bovins", "beef", { def: 4 * H, min: 1 * H, max: 24 * H }, { priority: 1 }),
  st("horses", "animals", "Chevaux", "horse", { def: 3 * H, min: 1 * H, max: 24 * H }, { priority: 1 }),
  st("wildlife", "animals", "Animaux sauvages", "rabbit", { def: 2 * H, min: 1 * H, max: 3 * H }, { sensitive: true, priority: 2 }),
  st("boars", "animals", "Sangliers", "piggy-bank", { def: 2 * H, min: 1 * H, max: 3 * H }, { priority: 2 }),
  st("injured_animal", "animals", "Animal blessé", "bandage", { def: 12 * H, min: 2 * H, max: 3 * D }, { sensitive: true, priority: 2 }),
  st("aggressive_animal", "animals", "Animal agressif", "alert-circle", { def: 4 * H, min: 1 * H, max: 2 * D }, { askDangerLevel: true, priority: 3 }),
  st("other_animal", "animals", "Autre observation animale", "bird", { def: 2 * H, min: 1 * H, max: 3 * H }, { sensitive: true, priority: 1 }),

  // ---- Eau / ressources
  st("spring", "water", "Source", "droplet", { def: 30 * D, min: 7 * D, max: 365 * D }, { recurring: true, priority: 2 }),
  st("fountain", "water", "Fontaine", "glass-water", { def: 90 * D, min: 7 * D, max: 365 * D }, { recurring: true, priority: 2 }),
  st("water_point", "water", "Point d'eau", "droplets", { def: 30 * D, min: 7 * D, max: 365 * D }, { recurring: true, priority: 2 }),
  st("spring_dry", "water", "Source sèche", "cloud-off", { def: 5 * D, min: 1 * D, max: 30 * D }, { priority: 3 }),
  st("spring_active", "water", "Source active", "droplet", { def: 14 * D, min: 2 * D, max: 60 * D }, { recurring: true, priority: 2 }),
  st("refuge", "water", "Refuge", "home", { def: 365 * D, min: 30 * D, max: 365 * D }, { recurring: true, priority: 3 }),
  st("shelter", "water", "Abri", "warehouse", { def: 180 * D, min: 30 * D, max: 365 * D }, { recurring: true, priority: 2 }),

  // ---- Fréquentation / usagers
  st("many_hikers", "crowd", "Forte présence de randonneurs", "users", { def: 90, min: 60, max: 120 }, { priority: 1, relevantFor: OUTDOOR }),
  st("riders", "crowd", "Passage de cavaliers", "horse", { def: 90, min: 60, max: 120 }, { priority: 1 }),
  st("mtb", "crowd", "Passage de VTT", "bike", { def: 90, min: 60, max: 120 }, { priority: 1 }),
  st("vehicles", "crowd", "Véhicules", "car", { def: 90, min: 60, max: 180 }, { priority: 1 }),
  st("busy_area", "crowd", "Zone très fréquentée", "users-round", { def: 120, min: 60, max: 180 }, { priority: 2 }),
  st("quiet_area", "crowd", "Zone peu fréquentée", "user-round", { def: 120, min: 60, max: 180 }, { priority: 1 }),
];

export const SUBTYPE_BY_ID: Record<ReportSubtype, SubtypeDef> = Object.fromEntries(
  SUBTYPES.map((s) => [s.id, s]),
) as Record<ReportSubtype, SubtypeDef>;

export const CATEGORY_BY_ID: Record<ReportCategory, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<ReportCategory, CategoryDef>;

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as ReportCategory[];
export const SUBTYPE_IDS = SUBTYPES.map((s) => s.id) as ReportSubtype[];

export function subtypesOf(category: ReportCategory): SubtypeDef[] {
  return SUBTYPES.filter((s) => s.category === category);
}

export function isSubtype(x: string): x is ReportSubtype {
  return x in SUBTYPE_BY_ID;
}
export function isCategory(x: string): x is ReportCategory {
  return x in CATEGORY_BY_ID;
}

export const DANGER_LEVELS: readonly { id: DangerLevel; label: string; color: string }[] = [
  { id: "low", label: "Faible", color: "#5B6B7A" },
  { id: "moderate", label: "Modéré", color: "#D9822B" },
  { id: "high", label: "Important", color: "#E4572E" },
  { id: "critical", label: "Critique", color: "#C8341F" },
];

export const CONFIRMATION_KINDS: readonly { id: ConfirmationKind; label: string; icon: string }[] = [
  { id: "still_present", label: "Toujours présent", icon: "check" },
  { id: "improved", label: "Situation améliorée", icon: "trending-down" },
  { id: "gone", label: "Plus présent", icon: "circle-check" },
  { id: "disputed", label: "Contester", icon: "flag" },
];

export const CONFIDENCE_LABELS: Record<ConfidenceLabel, { label: string; color: string }> = {
  low: { label: "Faible confiance", color: "#8A949E" },
  probable: { label: "Probable", color: "#D9822B" },
  confirmed: { label: "Confirmé", color: "#2F6B3A" },
  high: { label: "Très fiable", color: "#1F4D28" },
};

export const STATUS_LABELS: Record<ReportStatus, string> = {
  active: "Actif",
  confirmed: "Confirmé",
  probably_resolved: "Probablement résolu",
  resolved: "Résolu",
  expired: "Expiré",
  disputed: "Contesté",
  deleted: "Supprimé",
};

export const SOURCE_LABELS: Record<ReportSource, { label: string; badge: string }> = {
  official: { label: "Source officielle", badge: "Officiel" },
  partner: { label: "Partenaire vérifié", badge: "Partenaire" },
  community: { label: "Signalement communautaire", badge: "Communauté" },
};

export const PRACTICES: readonly { id: Practice; label: string; icon: string }[] = [
  { id: "hiker", label: "Randonnée", icon: "footprints" },
  { id: "trail", label: "Trail", icon: "zap" },
  { id: "rider", label: "Équitation", icon: "horse" },
  { id: "mtb", label: "VTT", icon: "bike" },
  { id: "hunter", label: "Chasse", icon: "crosshair" },
  { id: "fisher", label: "Pêche", icon: "fish" },
  { id: "shepherd", label: "Berger / éleveur", icon: "tent" },
  { id: "professional", label: "Professionnel", icon: "briefcase" },
  { id: "manager", label: "Gestionnaire", icon: "landmark" },
  { id: "other", label: "Autre", icon: "compass" },
];

/** Filtres proposés par défaut selon la pratique (section 11). */
export const DEFAULT_FILTERS_BY_PRACTICE: Record<Practice, ReportCategory[]> = {
  hiker: ["water", "danger", "activity", "path", "animals"],
  trail: ["danger", "path", "activity", "water"],
  rider: ["animals", "activity", "path", "water", "danger"],
  mtb: ["danger", "path", "activity", "crowd"],
  hunter: ["activity", "crowd", "animals", "path"],
  fisher: ["water", "danger", "path", "activity"],
  shepherd: ["animals", "activity", "crowd", "danger"],
  professional: ["danger", "path", "activity", "water", "animals", "crowd"],
  manager: ["danger", "path", "activity", "water", "animals", "crowd"],
  other: ["danger", "path", "activity", "water", "animals", "crowd"],
};

export const FLAG_REASONS: readonly { id: FlagReason; label: string }[] = [
  { id: "false_info", label: "Fausse information" },
  { id: "dangerous_content", label: "Contenu dangereux" },
  { id: "inappropriate_photo", label: "Photo inappropriée" },
  { id: "harassment", label: "Harcèlement" },
  { id: "obsolete", label: "Information obsolète" },
  { id: "spam", label: "Spam" },
];

export const BADGES: Record<BadgeId, { label: string; description: string; icon: string }> = {
  scout: { label: "Éclaireur", description: "Premier signalement publié", icon: "compass" },
  contributor: { label: "Contributeur", description: "10 signalements ou confirmations", icon: "hand-heart" },
  local_expert: { label: "Expert local", description: "25 signalements confirmés dans une même zone", icon: "map" },
  sentinel: { label: "Sentinelle", description: "50 confirmations utiles", icon: "shield-check" },
  verified_partner: { label: "Partenaire vérifié", description: "Compte partenaire validé", icon: "badge-check" },
};

/** Formatage court d'une durée en minutes (ex. « 2 h », « 3 j »). */
export function formatTtl(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < D) return `${Math.round(minutes / H)} h`;
  if (minutes < 30 * D) return `${Math.round(minutes / D)} j`;
  return `${Math.round(minutes / (30 * D))} mois`;
}

/** Options de durée proposées dans le formulaire pour un sous-type. */
export function ttlOptions(subtype: ReportSubtype): { minutes: number; label: string }[] {
  const s = SUBTYPE_BY_ID[subtype];
  const candidates = [30, 60, 120, 180, 6 * H, 12 * H, D, 2 * D, 3 * D, 5 * D, 7 * D, 14 * D, 30 * D, 90 * D, 180 * D, 365 * D];
  const opts = candidates.filter((m) => m >= s.minTtlMin && m <= s.maxTtlMin);
  if (!opts.includes(s.defaultTtlMin)) opts.push(s.defaultTtlMin);
  opts.sort((a, b) => a - b);
  return opts.map((m) => ({ minutes: m, label: formatTtl(m) }));
}
