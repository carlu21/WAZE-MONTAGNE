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
  ActivityMode,
  ContributionStatus,
  PathKind,
  PathSource,
  TrailSource,
  TraversalDirection,
  GeometryLayer,
  GpxQualityLevel,
  LicenceId,
  ReuseStatus,
  SourceStatus,
  SourceType,
  TraceMetadata,
  TraceWaypoint,
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
    /** Provenance (osm, ign, seed, partner…) et état, migration 4. */
    source: text("source").$type<TrailSource>(),
    status: text("status").$type<"open" | "closed" | null>(),
    confidenceScore: real("confidence_score"),
    // --- Qualité de la liaison au réseau (migration 6) ---
    /** Membres attendus dans la relation source. */
    memberWayCount: integer("member_way_count"),
    /** Membres effectivement retrouvés dans `paths`. */
    resolvedWayCount: integer("resolved_way_count"),
    /** `resolvedWayCount / memberWayCount` (0..1). */
    linkCoverage: real("link_coverage"),
    /** Confiance dans la géométrie assemblée (0..1), pénalisée par les ruptures. */
    geometryConfidence: real("geometry_confidence"),
    /** Tronçons non raccordés lors de l'assemblage de la relation. */
    gapCount: integer("gap_count"),
  },
  (t) => [index("trails_bbox_idx").on(t.minLat, t.minLng)],
);

/**
 * Réseau de chemins (module navigation) : un segment = une arête du graphe,
 * nœuds aux extrémités (les intersections sont des extrémités partagées).
 */
export const paths = sqliteTable(
  "paths",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    kind: text("kind").$type<PathKind>().notNull(),
    surface: text("surface"),
    sacScale: text("sac_scale"),
    widthM: real("width_m"),
    foot: integer("foot", { mode: "boolean" }).notNull().default(true),
    bicycle: integer("bicycle", { mode: "boolean" }).notNull().default(true),
    horse: integer("horse", { mode: "boolean" }).notNull().default(true),
    ford: integer("ford", { mode: "boolean" }).notNull().default(false),
    status: text("status").$type<"open" | "closed" | null>(),
    /** `[lng, lat][]` */
    coordinates: text("coordinates", { mode: "json" }).$type<[number, number][]>().notNull(),
    elevations: text("elevations", { mode: "json" }).$type<number[] | null>(),
    lengthM: integer("length_m").notNull(),
    source: text("source").$type<PathSource>().notNull(),
    /** Objet source dont ce segment est issu (`way/891234`), migration 6. */
    sourceFeatureId: text("source_feature_id"),
    minLat: real("min_lat").notNull(),
    minLng: real("min_lng").notNull(),
    maxLat: real("max_lat").notNull(),
    maxLng: real("max_lng").notNull(),
    updatedAt: text("updated_at").notNull(),
    // --- Moteur cartographique collectif (migration 4) ---
    /** Itinéraire auquel ce segment appartient, si connu. */
    trailId: text("trail_id"),
    /** Clés des nœuds du graphe (extrémités) : dénormalisées pour le routage SQL. */
    startNode: text("start_node"),
    endNode: text("end_node"),
    elevationGainM: real("elevation_gain_m"),
    elevationLossM: real("elevation_loss_m"),
    averageSlope: real("average_slope"),
    maxSlope: real("max_slope"),
    difficulty: text("difficulty").$type<"easy" | "moderate" | "hard" | "expert" | null>(),
    /** Fiabilité de la géométrie au regard des passages observés (0..1). */
    communityConfidence: real("community_confidence"),
    /** Synthèse de fréquentation (détail dans segment_statistics). */
    passageCount: integer("passage_count").notNull().default(0),
    lastPassageAt: text("last_passage_at"),
    popularityScore: real("popularity_score").notNull().default(0),
    // --- Collecte des sources existantes (migration 5) ---
    /** Source principale de cette géométrie (registre `data_sources`). */
    sourceId: text("source_id"),
    /** Couche dont provient la géométrie retenue (section 21). */
    geometryLayer: text("geometry_layer").$type<GeometryLayer | null>(),
    /** Confiance 0..100 agrégée de toutes les attestations (section 12). */
    trailConfidence: real("trail_confidence"),
    /** Sources distinctes attestant ce segment. */
    sourceCount: integer("source_count").notNull().default(0),
    /** Traces importées distinctes l'empruntant. */
    traceCount: integer("trace_count").notNull().default(0),
    lastValidatedAt: text("last_validated_at"),
    /** Version de géométrie courante (historique dans segment_versions). */
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("paths_bbox_idx").on(t.minLat, t.minLng),
    index("paths_source_idx").on(t.source),
    index("paths_trail_idx").on(t.trailId),
    index("paths_nodes_idx").on(t.startNode, t.endNode),
    index("paths_source_feature_idx").on(t.sourceFeatureId),
  ],
);

/**
 * CE QUE CETTE RANDONNÉE EMPRUNTE (migration 6).
 *
 * Un itinéraire est composé de segments, et un même segment appartient à
 * plusieurs itinéraires : le GR20, une boucle locale, un parcours équestre et
 * un tracé VTT peuvent emprunter le même sentier. `paths.trail_id` ne pouvait
 * en retenir qu'un seul et écrasait les autres sans rien dire ; il reste
 * uniquement pour les données de démonstration antérieures.
 *
 * `sequence` reconstruit l'ordre de parcours, `direction` le sens dans lequel
 * le tronçon est emprunté — le même sentier se parcourt à l'endroit dans un
 * sens de GR et à l'envers dans l'autre.
 */
export const trailSegments = sqliteTable(
  "trail_segments",
  {
    id: text("id").primaryKey(),
    trailId: text("trail_id").notNull(),
    segmentId: text("segment_id").notNull(),
    /** Rang dans le parcours, à partir de 0. */
    sequence: integer("sequence").notNull(),
    direction: text("direction").$type<"forward" | "backward">().notNull().default("forward"),
    /** `main` aujourd'hui ; `alternative`, `approach`… quand les variantes viendront. */
    role: text("role").notNull().default("main"),
    /** D'où vient l'ASSOCIATION (pas le segment) : import OSM, GPX, saisie manuelle. */
    source: text("source").$type<TrailSource>().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("trail_segments_unique_idx").on(t.trailId, t.segmentId, t.sequence),
    index("trail_segments_trail_idx").on(t.trailId, t.sequence),
    index("trail_segments_segment_idx").on(t.segmentId),
  ],
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
    /** Commune de rattachement (nom), pour distinguer les lieux-dits homonymes. */
    commune: text("commune"),
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
// Moteur cartographique collectif (migration 4)
//
// Chaîne complète : activities → activity_points (trace brute, jamais écrasée)
// → activity_matched_points (trace rattachée) → segment_traversals (passages)
// → segment_statistics (agrégats publiables) → network_candidates
// (apprentissage : géométries, chemins potentiels, comportements).
// Aucune de ces tables ne sert à suivre une personne : les passages portent un
// pseudonyme `user_key` dérivé d'un secret serveur, et les statistiques ne sont
// publiées qu'au-delà d'un seuil d'utilisateurs distincts.
// ---------------------------------------------------------------------------

/** Activité enregistrée par un utilisateur (section 37 : ACTIVITIES). */
export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    /** Détaché (null) lorsque le compte est supprimé : la contribution reste anonyme. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name"),
    activityType: text("activity_type").$type<ActivityMode>().notNull(),
    source: text("source").$type<"recorded" | "gpx">().notNull().default("recorded"),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at").notNull(),
    distanceM: integer("distance_m").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    movingMs: integer("moving_ms").notNull().default(0),
    elevationGainM: integer("elevation_gain_m").notNull().default(0),
    elevationLossM: integer("elevation_loss_m").notNull().default(0),
    maxAltM: integer("max_alt_m"),
    averageSpeedMs: real("average_speed_ms"),
    pointCount: integer("point_count").notNull().default(0),
    /** Qualité moyenne de la trace (0..5) et part de points rattachés (0..1). */
    qualityScore: real("quality_score"),
    matchedRatio: real("matched_ratio"),
    /** Consentement de contribution collective (section 35). */
    contribution: text("contribution").$type<ContributionStatus>().notNull().default("private"),
    contributedAt: text("contributed_at"),
    /** Date du traitement (matching + passages), null tant qu'il reste à faire. */
    processedAt: text("processed_at"),
    /** Date de purge de la trace brute (section 5 : conservation temporaire). */
    rawPurgedAt: text("raw_purged_at"),
    minLat: real("min_lat"),
    minLng: real("min_lng"),
    maxLat: real("max_lat"),
    maxLng: real("max_lng"),
    createdAt: text("created_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("activities_user_idx").on(t.userId, t.startedAt), index("activities_contribution_idx").on(t.contribution, t.processedAt)],
);

/** Trace brute : positions réellement mesurées (section 5), jamais corrigées. */
export const activityPoints = sqliteTable(
  "activity_points",
  {
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    /** Horodatage en millisecondes (epoch). */
    at: integer("at").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    alt: real("alt"),
    accuracy: real("accuracy"),
    speed: real("speed"),
    heading: real("heading"),
    /** Score de qualité 0..5 calculé à l'ingestion (section 6). */
    quality: integer("quality"),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.seq] })],
);

/** Trace rattachée au réseau (section 8) : coexiste avec la trace brute. */
export const activityMatchedPoints = sqliteTable(
  "activity_matched_points",
  {
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    segmentId: text("segment_id"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    along: real("along").notNull().default(0),
    confidence: real("confidence").notNull().default(0),
    deviationM: real("deviation_m"),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.seq] }), index("activity_matched_segment_idx").on(t.segmentId)],
);

/** Passage d'un segment (section 37 : SEGMENT_TRAVERSALS). */
export const segmentTraversals = sqliteTable(
  "segment_traversals",
  {
    id: text("id").primaryKey(),
    segmentId: text("segment_id").notNull(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    /** Pseudonyme stable, dérivé d'un secret serveur : jamais l'identifiant du compte. */
    userKey: text("user_key").notNull(),
    activityType: text("activity_type").$type<ActivityMode>().notNull(),
    direction: text("direction").$type<TraversalDirection>().notNull(),
    enteredAt: integer("entered_at").notNull(),
    exitedAt: integer("exited_at").notNull(),
    durationMs: integer("duration_ms").notNull(),
    distanceM: real("distance_m").notNull().default(0),
    coverage: real("coverage").notNull().default(1),
    averageSpeedMs: real("average_speed_ms"),
    confidence: real("confidence").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("segment_traversals_segment_idx").on(t.segmentId, t.exitedAt),
    index("segment_traversals_activity_idx").on(t.activityId),
    index("segment_traversals_user_idx").on(t.userKey),
  ],
);

/** Statistiques publiables par segment, activité et sens (section 37). */
export const segmentStatistics = sqliteTable(
  "segment_statistics",
  {
    segmentId: text("segment_id").notNull(),
    /** Activité, ou « all » pour l'agrégat. */
    activityType: text("activity_type").notNull(),
    /** Sens, ou « both » pour l'agrégat. */
    direction: text("direction").notNull(),
    passages7: integer("passages_7").notNull().default(0),
    passages30: integer("passages_30").notNull().default(0),
    passages365: integer("passages_365").notNull().default(0),
    passagesTotal: integer("passages_total").notNull().default(0),
    uniqueUsers: integer("unique_users").notNull().default(0),
    uniqueSessions: integer("unique_sessions").notNull().default(0),
    averageMs: integer("average_ms"),
    medianMs: integer("median_ms"),
    p25Ms: integer("p25_ms"),
    p75Ms: integer("p75_ms"),
    spread: real("spread"),
    averageSpeedMs: real("average_speed_ms"),
    firstPassageAt: integer("first_passage_at"),
    lastPassageAt: integer("last_passage_at"),
    popularityScore: real("popularity_score").notNull().default(0),
    frequentation: text("frequentation").notNull().default("unknown"),
    confidence: real("confidence").notNull().default(0),
    insufficientData: integer("insufficient_data", { mode: "boolean" }).notNull().default(true),
    activityMix: text("activity_mix", { mode: "json" }).$type<Record<string, number>>(),
    monthly: text("monthly", { mode: "json" }).$type<Record<string, number>>(),
    hourly: text("hourly", { mode: "json" }).$type<Record<string, number>>(),
    trend: real("trend"),
    possiblyInactive: integer("possibly_inactive", { mode: "boolean" }).notNull().default(false),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.segmentId, t.activityType, t.direction] }), index("segment_statistics_popularity_idx").on(t.popularityScore)],
);

/** Nature d'une candidature issue de l'apprentissage collectif. */
export type CandidateKind = "new_trail" | "geometry" | "variant" | "slow_zone" | "turnaround" | "confusion" | "inactive";
export type CandidateStatus = "open" | "accepted" | "rejected" | "merged";

/** Proposition soumise à modération : jamais appliquée automatiquement (sections 17 à 21, 27 à 30, 46). */
export const networkCandidates = sqliteTable(
  "network_candidates",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<CandidateKind>().notNull(),
    segmentId: text("segment_id"),
    geometry: text("geometry", { mode: "json" }).$type<[number, number][] | null>(),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
    observations: integer("observations").notNull().default(0),
    uniqueUsers: integer("unique_users").notNull().default(0),
    confidence: real("confidence").notNull().default(0),
    status: text("status").$type<CandidateStatus>().notNull().default("open"),
    firstSeenAt: integer("first_seen_at"),
    lastSeenAt: integer("last_seen_at"),
    minLat: real("min_lat"),
    minLng: real("min_lng"),
    maxLat: real("max_lat"),
    maxLng: real("max_lng"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: text("reviewed_at"),
    reviewNote: text("review_note"),
  },
  (t) => [
    index("network_candidates_kind_idx").on(t.kind, t.status),
    index("network_candidates_bbox_idx").on(t.minLat, t.minLng),
    index("network_candidates_segment_idx").on(t.segmentId),
  ],
);

/** Historique des géométries d'un segment (section 47 : rien n'est écrasé). */
export const segmentVersions = sqliteTable(
  "segment_versions",
  {
    id: text("id").primaryKey(),
    segmentId: text("segment_id").notNull(),
    version: integer("version").notNull(),
    coordinates: text("coordinates", { mode: "json" }).$type<[number, number][]>().notNull(),
    source: text("source").notNull(),
    reason: text("reason"),
    confidence: real("confidence"),
    /** Compte d'origine, ou nom du traitement automatique. */
    author: text("author"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("segment_versions_unique").on(t.segmentId, t.version)],
);

/** Allure personnelle observée, facultative (section 24). */
export const userPace = sqliteTable(
  "user_pace",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    activityType: text("activity_type").$type<ActivityMode>().notNull(),
    /** Rapport au temps médian de la communauté (1 = allure médiane). */
    factor: real("factor").notNull().default(1),
    samples: integer("samples").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.activityType] })],
);

/** Zone dont les traces ne doivent jamais servir aux statistiques (section 36). */
export const privacyZones = sqliteTable(
  "privacy_zones",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    radiusM: integer("radius_m").notNull().default(250),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("privacy_zones_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
/* ------------------------------------------------------------------ */
/* Collecte des traces GPX existantes (migration 5)                     */
/* ------------------------------------------------------------------ */

/**
 * Registre des sources de données (section 4 du cahier des charges GPX).
 * Chaque géométrie importée pointe ici : on doit toujours pouvoir répondre à
 * « d'où vient ce chemin ? ». `lastCheckedAt` à null signifie « conditions
 * jamais vérifiées par un humain » — et bloque l'importation automatique.
 */
export const dataSources = sqliteTable(
  "data_sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    type: text("type").$type<SourceType>().notNull(),
    country: text("country").notNull().default("FR"),
    territory: text("territory"),
    licence: text("licence").$type<LicenceId>().notNull().default("unknown"),
    licenceUrl: text("licence_url"),
    commercialReuseAllowed: integer("commercial_reuse_allowed", { mode: "boolean" }),
    redistributionAllowed: integer("redistribution_allowed", { mode: "boolean" }),
    attributionRequired: integer("attribution_required", { mode: "boolean" }),
    attributionText: text("attribution_text"),
    apiAvailable: integer("api_available", { mode: "boolean" }).notNull().default(false),
    apiUrl: text("api_url"),
    lastCheckedAt: text("last_checked_at"),
    checkedBy: text("checked_by"),
    reliabilityScore: real("reliability_score").notNull().default(0),
    status: text("status").$type<SourceStatus>().notNull().default("review_required"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("data_sources_status_idx").on(t.status), index("data_sources_territory_idx").on(t.territory)],
);

/** Territoires de déploiement, du pays à la commune (section 16). */
export const territories = sqliteTable(
  "territories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    country: text("country").notNull().default("FR"),
    parentId: text("parent_id"),
    aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default([]),
    minLat: real("min_lat"),
    minLng: real("min_lng"),
    maxLat: real("max_lat"),
    maxLng: real("max_lng"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("territories_parent_idx").on(t.parentId)],
);

/** Ressource repérée par la découverte, avant toute décision (section 5). */
export const sourceDiscoveries = sqliteTable(
  "source_discoveries",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    title: text("title"),
    sourceId: text("source_id"),
    territory: text("territory"),
    activity: text("activity").notNull().default("all"),
    format: text("format").$type<"gpx" | "kml" | "geojson" | "api" | "unknown">().notNull().default("unknown"),
    hasGpxFile: integer("has_gpx_file", { mode: "boolean" }).notNull().default(false),
    licence: text("licence").$type<LicenceId>().notNull().default("unknown"),
    status: text("status").$type<ReuseStatus>().notNull().default("review_required"),
    reason: text("reason"),
    query: text("query"),
    discoveredAt: text("discovered_at").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    notes: text("notes"),
  },
  (t) => [index("source_discoveries_status_idx").on(t.status), index("source_discoveries_territory_idx").on(t.territory)],
);

/** Comment une trace est entrée dans la bibliothèque. */
export type TraceOrigin = "manual_upload" | "url_import" | "api_import" | "discovery";
export type TraceStatus = "review_required" | "approved" | "rejected" | "merged";

/** Bibliothèque des traces importées (sections 7, 15, 20). */
export const importedTraces = sqliteTable(
  "imported_traces",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    description: text("description"),
    sourceId: text("source_id"),
    discoveryId: text("discovery_id"),
    origin: text("origin").$type<TraceOrigin>().notNull(),
    originUrl: text("origin_url"),
    fileName: text("file_name"),
    format: text("format").$type<"gpx" | "kml" | "geojson">().notNull(),
    licence: text("licence").$type<LicenceId>().notNull().default("unknown"),
    attribution: text("attribution"),
    territory: text("territory"),
    activity: text("activity").notNull().default("all"),
    coordinates: text("coordinates", { mode: "json" }).$type<[number, number][]>().notNull(),
    elevations: text("elevations", { mode: "json" }).$type<number[] | null>(),
    times: text("times", { mode: "json" }).$type<number[] | null>(),
    breaks: text("breaks", { mode: "json" }).$type<number[]>().notNull().default([]),
    waypoints: text("waypoints", { mode: "json" }).$type<TraceWaypoint[]>().notNull().default([]),
    metadata: text("metadata", { mode: "json" }).$type<TraceMetadata | Record<string, never>>().notNull().default({}),
    lengthM: integer("length_m").notNull().default(0),
    elevationGainM: real("elevation_gain_m"),
    elevationLossM: real("elevation_loss_m"),
    minLat: real("min_lat").notNull(),
    minLng: real("min_lng").notNull(),
    maxLat: real("max_lat").notNull(),
    maxLng: real("max_lng").notNull(),
    qualityScore: real("quality_score"),
    qualityLevel: text("quality_level").$type<GpxQualityLevel | null>(),
    qualityFlags: text("quality_flags", { mode: "json" }).$type<string[]>().notNull().default([]),
    /** Part de la trace rattachée au réseau connu (section 6). */
    matchedRatio: real("matched_ratio"),
    /** Empreinte géométrique : repère la même trace récupérée deux fois. */
    geometryHash: text("geometry_hash"),
    duplicateOf: text("duplicate_of"),
    status: text("status").$type<TraceStatus>().notNull().default("review_required"),
    version: integer("version").notNull().default(1),
    recordedAt: text("recorded_at"),
    importedAt: text("imported_at").notNull(),
    importedBy: text("imported_by"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    reviewNote: text("review_note"),
  },
  (t) => [
    index("imported_traces_status_idx").on(t.status),
    index("imported_traces_bbox_idx").on(t.minLat, t.minLng),
    index("imported_traces_hash_idx").on(t.geometryHash),
    index("imported_traces_source_idx").on(t.sourceId),
  ],
);

/**
 * Fichier d'origine conservé tel quel (section 7 : ORIGINAL_GPX_FILE).
 * On ne republie jamais un fichier dont la licence l'interdit ; on le garde
 * pour pouvoir rejouer l'analyse et prouver la provenance.
 */
export const importedTraceFiles = sqliteTable(
  "imported_trace_files",
  {
    traceId: text("trace_id").notNull(),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    byteSize: integer("byte_size").notNull(),
    checksum: text("checksum").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.traceId, t.version] })],
);

/** Versions successives d'une trace officielle qui change à la source (section 20). */
export const traceVersions = sqliteTable(
  "trace_versions",
  {
    id: text("id").primaryKey(),
    traceId: text("trace_id").notNull(),
    version: integer("version").notNull(),
    coordinates: text("coordinates", { mode: "json" }).$type<[number, number][]>().notNull(),
    lengthM: integer("length_m").notNull().default(0),
    qualityScore: real("quality_score"),
    /** Ampleur de la modification par rapport à la version précédente (m). */
    changedM: real("changed_m"),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("trace_versions_trace_idx").on(t.traceId, t.version)],
);

/** Segments empruntés par une trace importée (section 6). */
export const traceSegments = sqliteTable(
  "trace_segments",
  {
    traceId: text("trace_id").notNull(),
    seq: integer("seq").notNull(),
    segmentId: text("segment_id").notNull(),
    reversed: integer("reversed", { mode: "boolean" }).notNull().default(false),
    distanceM: real("distance_m").notNull().default(0),
    coverage: real("coverage").notNull().default(0),
    deviationM: real("deviation_m"),
  },
  (t) => [primaryKey({ columns: [t.traceId, t.seq] }), index("trace_segments_segment_idx").on(t.segmentId)],
);

/** Qui atteste qu'un segment existe, et depuis quelle couche (sections 11, 12). */
export const segmentAttestations = sqliteTable(
  "segment_attestations",
  {
    id: text("id").primaryKey(),
    segmentId: text("segment_id").notNull(),
    layer: text("layer").$type<GeometryLayer>().notNull(),
    sourceId: text("source_id"),
    traceId: text("trace_id"),
    deviationM: real("deviation_m"),
    observedAt: text("observed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("segment_attestations_segment_idx").on(t.segmentId)],
);

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
export type PathRow = typeof paths.$inferSelect;
export type TrailSegmentRow = typeof trailSegments.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;
export type ActivityPointRow = typeof activityPoints.$inferSelect;
export type MatchedPointRow = typeof activityMatchedPoints.$inferSelect;
export type TraversalRow = typeof segmentTraversals.$inferSelect;
export type SegmentStatisticsRow = typeof segmentStatistics.$inferSelect;
export type NetworkCandidateRow = typeof networkCandidates.$inferSelect;
export type SegmentVersionRow = typeof segmentVersions.$inferSelect;
export type UserPaceRow = typeof userPace.$inferSelect;
export type PrivacyZoneRow = typeof privacyZones.$inferSelect;
export type WaterPointRow = typeof waterPoints.$inferSelect;
export type AreaRow = typeof areas.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type FlagRow = typeof moderationReports.$inferSelect;
export type PartnerRow = typeof partners.$inferSelect;
export type DataSourceRow = typeof dataSources.$inferSelect;
export type TerritoryRow = typeof territories.$inferSelect;
export type SourceDiscoveryRow = typeof sourceDiscoveries.$inferSelect;
export type ImportedTraceRow = typeof importedTraces.$inferSelect;
export type ImportedTraceFileRow = typeof importedTraceFiles.$inferSelect;
export type TraceVersionRow = typeof traceVersions.$inferSelect;
export type TraceSegmentRow = typeof traceSegments.$inferSelect;
export type SegmentAttestationRow = typeof segmentAttestations.$inferSelect;
