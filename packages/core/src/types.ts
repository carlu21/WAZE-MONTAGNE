/**
 * Types de domaine partagés entre l'API et le client.
 * Ce fichier est LE contrat : toute évolution ici doit être répercutée
 * côté API (schéma / routes) et côté web (client / UI).
 */

/** Catégories principales de signalement (section 4 du cahier des charges). */
export type ReportCategory =
  | "danger"
  | "path"
  | "activity"
  | "animals"
  | "water"
  | "crowd";

/** Sous-types de signalement. L'union complète est dérivée de la taxonomie. */
export type ReportSubtype =
  // Danger
  | "rockfall"
  | "fallen_tree"
  | "collapsed_path"
  | "dangerous_passage"
  | "flood"
  | "snow"
  | "ice"
  | "fire"
  | "other_danger"
  // Chemin / accessibilité
  | "path_closed"
  | "path_impassable"
  | "works"
  | "path_cluttered"
  | "signage_issue"
  | "poor_condition"
  | "obstacle"
  | "access_restriction"
  | "no_signal"
  // Chasse / activités
  | "hunting"
  | "battue"
  | "zone_occupied"
  | "forestry_works"
  | "sport_event"
  | "pastoral_activity"
  // Animaux
  | "herd"
  | "guard_dogs"
  | "cattle"
  | "horses"
  | "wildlife"
  | "boars"
  | "injured_animal"
  | "aggressive_animal"
  | "other_animal"
  // Eau / ressources
  | "spring"
  | "fountain"
  | "water_point"
  | "spring_dry"
  | "spring_active"
  | "refuge"
  | "shelter"
  // Fréquentation / usagers
  | "many_hikers"
  | "riders"
  | "mtb"
  | "vehicles"
  | "busy_area"
  | "quiet_area";

export type DangerLevel = "low" | "moderate" | "high" | "critical";

export type ReportStatus =
  | "active"
  | "confirmed"
  | "probably_resolved"
  | "resolved"
  | "expired"
  | "disputed"
  | "deleted";

/** Niveau de fiabilité de la source (section 7). */
export type ReportSource = "official" | "partner" | "community";

/** Libellé de confiance affiché (section 6). */
export type ConfidenceLabel = "low" | "probable" | "confirmed" | "high";

/** Type de vote communautaire sur un signalement (section 6). */
export type ConfirmationKind =
  | "still_present" // Toujours présent
  | "improved" // Situation améliorée
  | "gone" // Plus présent
  | "disputed"; // Contesté / faux

/** Pratiques (section 15 et onboarding). */
export type Practice =
  | "hiker"
  | "trail"
  | "rider"
  | "mtb"
  | "hunter"
  | "fisher"
  | "shepherd"
  | "professional"
  | "manager"
  | "other";

export type UserRole = "user" | "partner" | "official" | "moderator" | "admin";

export type BadgeId =
  | "scout" // Éclaireur
  | "contributor" // Contributeur
  | "local_expert" // Expert local
  | "sentinel" // Sentinelle
  | "verified_partner"; // Partenaire vérifié

export type FlagReason =
  | "false_info"
  | "dangerous_content"
  | "inappropriate_photo"
  | "harassment"
  | "obsolete"
  | "spam";

export type FlagStatus = "open" | "reviewing" | "resolved" | "rejected";

export type NotificationType =
  | "new_danger_on_route"
  | "new_battue_nearby"
  | "trail_closed"
  | "report_updated"
  | "report_confirmed"
  | "report_resolved"
  | "official_alert"
  | "system";

export type AreaType =
  | "commune"
  | "massif"
  | "trail"
  | "summit"
  | "pass"
  | "place"
  | "refuge"
  | "lake"
  /** Lieu-dit, hameau, écart (référentiels toponymiques). */
  | "hamlet"
  /** Source, fontaine, résurgence. */
  | "spring";

export type Basemap = "topo" | "satellite" | "classic" | "relief" | "ortho";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Signalement tel qu'exposé par l'API (déjà filtré / flouté si nécessaire). */
export interface Report {
  id: string;
  userId: string | null;
  /** Pseudo public du contributeur (jamais l'e-mail). */
  authorPseudo: string | null;
  category: ReportCategory;
  subtype: ReportSubtype;
  /** Position affichée. Peut être floutée (voir `blurred`). */
  lat: number;
  lng: number;
  blurred: boolean;
  dangerLevel: DangerLevel | null;
  description: string | null;
  /** URL relative de la photo principale (première photo) ou null. */
  photoUrl: string | null;
  photos: Photo[];
  source: ReportSource;
  status: ReportStatus;
  /** Nom de zone (commune / massif) déduit ou saisi. */
  zone: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  expiresAt: string; // ISO
  /** Pour chasse / travaux / événements : début et fin renseignés. */
  startsAt: string | null;
  endsAt: string | null;
  confirmationsCount: number;
  disputesCount: number;
  resolvedVotesCount: number;
  lastConfirmationAt: string | null;
  confidenceScore: number; // 0..100
  confidenceLabel: ConfidenceLabel;
  /** Opacité d'affichage 0..1 calculée côté serveur (section 5). */
  fade: number;
  /** Distance en mètres depuis la position fournie dans la requête (si connue). */
  distanceM?: number | null;
  /** Vote de l'utilisateur courant sur ce signalement (si authentifié). */
  myConfirmation?: ConfirmationKind | null;
}

export interface Photo {
  id: string;
  reportId: string;
  url: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface ReportComment {
  id: string;
  reportId: string;
  userId: string;
  authorPseudo: string;
  body: string;
  createdAt: string;
}

export interface Confirmation {
  id: string;
  reportId: string;
  userId: string;
  kind: ConfirmationKind;
  comment: string | null;
  createdAt: string;
}

export interface UserPublic {
  id: string;
  pseudo: string;
  avatarUrl: string | null;
  practices: Practice[];
  region: string | null;
  role: UserRole;
  reportsCount: number;
  confirmationsCount: number;
  /** Niveau 1..5 uniquement, jamais de score négatif public (section 16). */
  reliabilityLevel: number;
  badges: BadgeId[];
  createdAt: string;
}

export interface UserPreferences {
  /** Catégories affichées sur la carte. Vide = tout afficher. */
  filters: ReportCategory[];
  showOfficialOnly: boolean;
  basemap: Basemap;
  theme: "light" | "dark" | "system";
  alerts: {
    enabled: boolean;
    radiusM: number; // 200..2000
    categories: ReportCategory[];
  };
  notifications: Record<NotificationType, boolean>;
  /** Rayon par défaut de la vue « Autour de moi » (mètres). */
  aroundRadiusM: number;
}

export interface UserMe extends UserPublic {
  email: string;
  preferences: UserPreferences;
  consentGivenAt: string | null;
  suspendedUntil: string | null;
}

export interface OfficialAlert {
  id: string;
  organisation: string;
  title: string;
  body: string;
  category: ReportCategory;
  severity: DangerLevel;
  /** GeoJSON geometry (Point ou Polygon). */
  geometry: GeoJsonGeometry;
  centroidLat: number;
  centroidLng: number;
  startsAt: string;
  endsAt: string | null;
  url: string | null;
  createdAt: string;
}

export type GeoJsonGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] }
  | { type: "LineString"; coordinates: [number, number][] };

export interface Area {
  id: string;
  name: string;
  type: AreaType;
  lat: number;
  lng: number;
  bbox: BBox | null;
  /** Altitude (m) pour sommets / cols / refuges. */
  elevation: number | null;
  description: string | null;
  /** Commune de rattachement (distingue les lieux-dits homonymes). */
  commune?: string | null;
}

export interface AreaSummary {
  area: Area;
  reports: Report[];
  officialAlerts: OfficialAlert[];
  waterPoints: WaterPoint[];
  trails: Trail[];
  crowdLevel: "low" | "medium" | "high";
  activeUsersEstimate: number;
  activities: Report[];
  restrictions: Report[];
}

export interface Trail {
  id: string;
  name: string;
  type: "hiking" | "trail" | "mtb" | "equestrian" | "mixed";
  difficulty: "easy" | "moderate" | "hard" | "expert";
  distanceKm: number;
  elevationGainM: number;
  geometry: GeoJsonGeometry; // LineString
  description: string | null;
}

export interface WaterPoint {
  id: string;
  name: string;
  type: "spring" | "fountain" | "stream" | "lake" | "refuge" | "shelter";
  lat: number;
  lng: number;
  /** Dernier état connu (source active / sèche) et date. */
  lastState: "active" | "dry" | "unknown";
  lastStateAt: string | null;
  elevation: number | null;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  reportId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ContentFlag {
  id: string;
  reporterId: string;
  reportId: string | null;
  commentId: string | null;
  photoId: string | null;
  reason: FlagReason;
  details: string | null;
  status: FlagStatus;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Agrégat de présence anonymisé (section 8) : jamais de position individuelle. */
export interface PresenceCell {
  /** Identifiant de cellule (~1 km). */
  cell: string;
  lat: number;
  lng: number;
  count: number;
}

export interface OfflineBundle {
  bbox: BBox;
  generatedAt: string;
  reports: Report[];
  officialAlerts: OfficialAlert[];
  trails: Trail[];
  waterPoints: WaterPoint[];
  areas: Area[];
}

export interface AdminStats {
  reportsTotal: number;
  reportsActive: number;
  reportsLast24h: number;
  reportsByCategory: Record<ReportCategory, number>;
  usersTotal: number;
  flagsOpen: number;
  avgResolutionHours: number | null;
}

export interface ProDashboard {
  areaName: string | null;
  period: { from: string; to: string };
  reportsTotal: number;
  reportsResolved: number;
  avgResolutionHours: number | null;
  byCategory: Record<ReportCategory, number>;
  topSubtypes: { subtype: ReportSubtype; count: number }[];
  hotspots: { lat: number; lng: number; count: number }[];
  recurringWaterIssues: { waterPointId: string; name: string; dryCount: number }[];
  estimatedVisitors: number;
  conflictZones: { lat: number; lng: number; count: number; categories: ReportCategory[] }[];
  timeline: { date: string; count: number }[];
}
