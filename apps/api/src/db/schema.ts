import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  BadgeId,
  BBox,
  ConfirmationKind,
  ConfidenceLabel,
  DangerLevel,
  FlagReason,
  FlagStatus,
  GeoJsonGeometry,
  NotificationType,
  Practice,
  ReportCategory,
  ReportSource,
  ReportStatus,
  ReportSubtype,
  UserPreferences,
  UserRole,
  AreaType,
} from "@mountain-live/core";

/**
 * Schéma drizzle (SQLite). Les migrations SQL correspondantes sont écrites à la main
 * dans ./migrate.ts (idempotentes, exécutées au démarrage) : toute modification ici
 * doit y être répercutée. Les dates sont stockées en ISO 8601 (texte, triable).
 */

// ---------------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    pseudo: text("pseudo").notNull(),
    avatarUrl: text("avatar_url"),
    practices: text("practices", { mode: "json" }).$type<Practice[]>().notNull(),
    region: text("region"),
    role: text("role").$type<UserRole>().notNull(),
    reputationScore: integer("reputation_score").notNull().default(0),
    reliabilityLevel: integer("reliability_level").notNull().default(1),
    reportsCount: integer("reports_count").notNull().default(0),
    confirmationsCount: integer("confirmations_count").notNull().default(0),
    badges: text("badges", { mode: "json" }).$type<BadgeId[]>().notNull(),
    consentGivenAt: text("consent_given_at"),
    suspendedUntil: text("suspended_until"),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    // Unicité du pseudo uniquement pour les comptes vivants : les comptes anonymisés
    // partagent le pseudo « Utilisateur supprimé ».
    uniqueIndex("users_pseudo_unique").on(t.pseudo).where(sql`deleted_at IS NULL`),
    index("users_role_idx").on(t.role),
  ],
);

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: text("data", { mode: "json" }).$type<UserPreferences>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Fiche partenaire / organisation rattachée à un compte partner ou official. */
export const partners = sqliteTable("partners", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  organisation: text("organisation").notNull(),
  kind: text("kind")
    .$type<"guide" | "shepherd" | "hunting_society" | "association" | "trail_manager" | "commune" | "public_service" | "other">()
    .notNull(),
  description: text("description"),
  website: text("website"),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Signalements
// ---------------------------------------------------------------------------

export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    category: text("category").$type<ReportCategory>().notNull(),
    subtype: text("subtype").$type<ReportSubtype>().notNull(),
    /** Position exacte : jamais exposée si `blurred`. */
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    /** Position servie aux clients (identique à lat/lng sauf floutage). */
    displayLat: real("display_lat").notNull(),
    displayLng: real("display_lng").notNull(),
    blurred: integer("blurred", { mode: "boolean" }).notNull().default(false),
    dangerLevel: text("danger_level").$type<DangerLevel>(),
    description: text("description"),
    zone: text("zone"),
    source: text("source").$type<ReportSource>().notNull(),
    status: text("status").$type<ReportStatus>().notNull(),
    /** Importance d'affichage (taxonomie), dénormalisée pour le tri SQL. */
    priority: integer("priority").notNull().default(2),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    confirmationsCount: integer("confirmations_count").notNull().default(0),
    disputesCount: integer("disputes_count").notNull().default(0),
    resolvedVotesCount: integer("resolved_votes_count").notNull().default(0),
    improvedVotesCount: integer("improved_votes_count").notNull().default(0),
    lastConfirmationAt: text("last_confirmation_at"),
    confidenceScore: integer("confidence_score").notNull().default(0),
    confidenceLabel: text("confidence_label").$type<ConfidenceLabel>().notNull().default("low"),
    resolvedAt: text("resolved_at"),
    deletedAt: text("deleted_at"),
    /** Identifiant local (hors connexion) pour dédoublonner la synchronisation. */
    clientId: text("client_id"),
  },
  (t) => [
    index("reports_position_idx").on(t.displayLat, t.displayLng),
    index("reports_status_idx").on(t.status),
    index("reports_expires_idx").on(t.expiresAt),
    index("reports_category_idx").on(t.category),
    index("reports_user_idx").on(t.userId),
    index("reports_created_idx").on(t.createdAt),
    uniqueIndex("reports_client_unique").on(t.userId, t.clientId).where(sql`client_id IS NOT NULL`),
  ],
);

export const reportConfirmations = sqliteTable(
  "report_confirmations",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ConfirmationKind>().notNull(),
    comment: text("comment"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("report_confirmations_unique").on(t.reportId, t.userId),
    index("report_confirmations_user_idx").on(t.userId),
  ],
);

export const reportComments = sqliteTable(
  "report_comments",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("report_comments_report_idx").on(t.reportId)],
);

export const photos = sqliteTable(
  "photos",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** URL relative servie au client (« /uploads/… »). */
    url: text("url").notNull(),
    /** Chemin relatif au dossier d'upload. */
    storagePath: text("storage_path").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("photos_report_idx").on(t.reportId)],
);

// ---------------------------------------------------------------------------
// Données de référence et officielles
// ---------------------------------------------------------------------------

export const officialAlerts = sqliteTable(
  "official_alerts",
  {
    id: text("id").primaryKey(),
    organisation: text("organisation").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").$type<ReportCategory>().notNull(),
    severity: text("severity").$type<DangerLevel>().notNull(),
    geometry: text("geometry", { mode: "json" }).$type<GeoJsonGeometry>().notNull(),
    centroidLat: real("centroid_lat").notNull(),
    centroidLng: real("centroid_lng").notNull(),
    minLat: real("min_lat").notNull(),
    minLng: real("min_lng").notNull(),
    maxLat: real("max_lat").notNull(),
    maxLng: real("max_lng").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at"),
    url: text("url"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("official_alerts_bbox_idx").on(t.minLat, t.minLng), index("official_alerts_ends_idx").on(t.endsAt)],
);

export const trails = sqliteTable(
  "trails",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").$type<"hiking" | "trail" | "mtb" | "equestrian" | "mixed">().notNull(),
    difficulty: text("difficulty").$type<"easy" | "moderate" | "hard" | "expert">().notNull(),
    distanceKm: real("distance_km").notNull(),
    elevationGainM: integer("elevation_gain_m").notNull(),
    geometry: text("geometry", { mode: "json" }).$type<GeoJsonGeometry>().notNull(),
    minLat: real("min_lat").notNull(),
    minLng: real("min_lng").notNull(),
    maxLat: real("max_lat").notNull(),
    maxLng: real("max_lng").notNull(),
    description: text("description"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("trails_bbox_idx").on(t.minLat, t.minLng)],
);

export const waterPoints = sqliteTable(
  "water_points",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").$type<"spring" | "fountain" | "stream" | "lake" | "refuge" | "shelter">().notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    lastState: text("last_state").$type<"active" | "dry" | "unknown">().notNull().default("unknown"),
    lastStateAt: text("last_state_at"),
    elevation: integer("elevation"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("water_points_position_idx").on(t.lat, t.lng)],
);

export const areas = sqliteTable(
  "areas",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Nom normalisé (minuscules, sans accents) pour la recherche. */
    nameNormalized: text("name_normalized").notNull(),
    type: text("type").$type<AreaType>().notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    bbox: text("bbox", { mode: "json" }).$type<BBox | null>(),
    elevation: integer("elevation"),
    description: text("description"),
  },
  (t) => [index("areas_name_idx").on(t.nameNormalized), index("areas_type_idx").on(t.type)],
);

/** Zones téléchargées hors connexion par un utilisateur (pour la synchronisation). */
export const offlineZones = sqliteTable(
  "offline_zones",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    bbox: text("bbox", { mode: "json" }).$type<BBox>().notNull(),
    reportsCount: integer("reports_count").notNull().default(0),
    generatedAt: text("generated_at").notNull(),
  },
  (t) => [index("offline_zones_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Notifications, réputation, modération, présence
// ---------------------------------------------------------------------------

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<NotificationType>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    reportId: text("report_id").references(() => reports.id, { onDelete: "set null" }),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export type ReputationEventType =
  | "report_created"
  | "report_confirmed"
  | "report_disputed"
  | "confirmation_given"
  | "confirmation_useful"
  | "flag_upheld"
  | "manual";

/** Journal interne de réputation (section 16) : jamais exposé tel quel. */
export const userReputationEvents = sqliteTable(
  "user_reputation_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<ReputationEventType>().notNull(),
    delta: integer("delta").notNull(),
    reportId: text("report_id").references(() => reports.id, { onDelete: "set null" }),
    /** Utilisateur à l'origine de l'événement (votant, modérateur…). */
    actorId: text("actor_id"),
    /** Référence libre (id de flag, etc.) pour l'idempotence. */
    refId: text("ref_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("user_reputation_events_user_idx").on(t.userId)],
);

/** Signalements de contenu (= ContentFlag côté API). */
export const moderationReports = sqliteTable(
  "moderation_reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportId: text("report_id").references(() => reports.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => reportComments.id, { onDelete: "cascade" }),
    photoId: text("photo_id").references(() => photos.id, { onDelete: "cascade" }),
    reason: text("reason").$type<FlagReason>().notNull(),
    details: text("details"),
    status: text("status").$type<FlagStatus>().notNull().default("open"),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolutionNote: text("resolution_note"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (t) => [index("moderation_reports_status_idx").on(t.status), index("moderation_reports_report_idx").on(t.reportId)],
);

/**
 * Présence agrégée (section 8) : uniquement une cellule ~1 km et une tranche de 5 min.
 * Aucun identifiant utilisateur, aucune position précise. Purgé après 30 min.
 */
export const presencePings = sqliteTable(
  "presence_pings",
  {
    cell: text("cell").notNull(),
    bucketStart: text("bucket_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.cell, t.bucketStart] }), index("presence_pings_bucket_idx").on(t.bucketStart)],
);

export const schemaMigrations = sqliteTable("schema_migrations", {
  version: integer("version").primaryKey(),
  appliedAt: text("applied_at").notNull(),
});

// ---------------------------------------------------------------------------
// Types de lignes
// ---------------------------------------------------------------------------

export type UserRow = typeof users.$inferSelect;
export type ReportRow = typeof reports.$inferSelect;
export type ConfirmationRow = typeof reportConfirmations.$inferSelect;
export type CommentRow = typeof reportComments.$inferSelect;
export type PhotoRow = typeof photos.$inferSelect;
export type OfficialAlertRow = typeof officialAlerts.$inferSelect;
export type TrailRow = typeof trails.$inferSelect;
export type WaterPointRow = typeof waterPoints.$inferSelect;
export type AreaRow = typeof areas.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type FlagRow = typeof moderationReports.$inferSelect;
export type PartnerRow = typeof partners.$inferSelect;
