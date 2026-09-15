import { pathToFileURL } from "node:url";
import type Database from "better-sqlite3";

/**
 * Migrations SQL idempotentes, exécutées au démarrage de l'API et par `pnpm db:migrate`.
 * Aucun outil externe à l'exécution : chaque version est une liste d'instructions
 * `CREATE … IF NOT EXISTS` ; la table `schema_migrations` mémorise les versions appliquées
 * afin que les futures migrations (ALTER TABLE…) ne soient jouées qu'une fois.
 *
 * Le schéma doit rester strictement aligné sur ./schema.ts.
 */
interface Migration {
  version: number;
  name: string;
  statements: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "schema initial",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        pseudo TEXT NOT NULL COLLATE NOCASE,
        avatar_url TEXT,
        practices TEXT NOT NULL DEFAULT '[]',
        region TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        reputation_score INTEGER NOT NULL DEFAULT 0,
        reliability_level INTEGER NOT NULL DEFAULT 1,
        reports_count INTEGER NOT NULL DEFAULT 0,
        confirmations_count INTEGER NOT NULL DEFAULT 0,
        badges TEXT NOT NULL DEFAULT '[]',
        consent_given_at TEXT,
        suspended_until TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_pseudo_unique ON users(pseudo) WHERE deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS users_role_idx ON users(role)`,

      `CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS partners (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organisation TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'other',
        description TEXT,
        website TEXT,
        verified_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS partners_user_idx ON partners(user_id)`,

      `CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        category TEXT NOT NULL,
        subtype TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        display_lat REAL NOT NULL,
        display_lng REAL NOT NULL,
        blurred INTEGER NOT NULL DEFAULT 0,
        danger_level TEXT,
        description TEXT,
        zone TEXT,
        source TEXT NOT NULL DEFAULT 'community',
        status TEXT NOT NULL DEFAULT 'active',
        priority INTEGER NOT NULL DEFAULT 2,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        starts_at TEXT,
        ends_at TEXT,
        confirmations_count INTEGER NOT NULL DEFAULT 0,
        disputes_count INTEGER NOT NULL DEFAULT 0,
        resolved_votes_count INTEGER NOT NULL DEFAULT 0,
        improved_votes_count INTEGER NOT NULL DEFAULT 0,
        last_confirmation_at TEXT,
        confidence_score INTEGER NOT NULL DEFAULT 0,
        confidence_label TEXT NOT NULL DEFAULT 'low',
        resolved_at TEXT,
        deleted_at TEXT,
        client_id TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS reports_position_idx ON reports(display_lat, display_lng)`,
      `CREATE INDEX IF NOT EXISTS reports_status_idx ON reports(status)`,
      `CREATE INDEX IF NOT EXISTS reports_expires_idx ON reports(expires_at)`,
      `CREATE INDEX IF NOT EXISTS reports_category_idx ON reports(category)`,
      `CREATE INDEX IF NOT EXISTS reports_user_idx ON reports(user_id)`,
      `CREATE INDEX IF NOT EXISTS reports_created_idx ON reports(created_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS reports_client_unique ON reports(user_id, client_id) WHERE client_id IS NOT NULL`,

      `CREATE TABLE IF NOT EXISTS report_confirmations (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS report_confirmations_unique ON report_confirmations(report_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS report_confirmations_user_idx ON report_confirmations(user_id)`,

      `CREATE TABLE IF NOT EXISTS report_comments (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS report_comments_report_idx ON report_comments(report_id)`,

      `CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        url TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        width INTEGER,
        height INTEGER,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS photos_report_idx ON photos(report_id)`,

      `CREATE TABLE IF NOT EXISTS official_alerts (
        id TEXT PRIMARY KEY,
        organisation TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        geometry TEXT NOT NULL,
        centroid_lat REAL NOT NULL,
        centroid_lng REAL NOT NULL,
        min_lat REAL NOT NULL,
        min_lng REAL NOT NULL,
        max_lat REAL NOT NULL,
        max_lng REAL NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT,
        url TEXT,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS official_alerts_bbox_idx ON official_alerts(min_lat, min_lng)`,
      `CREATE INDEX IF NOT EXISTS official_alerts_ends_idx ON official_alerts(ends_at)`,

      `CREATE TABLE IF NOT EXISTS trails (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        distance_km REAL NOT NULL,
        elevation_gain_m INTEGER NOT NULL,
        geometry TEXT NOT NULL,
        min_lat REAL NOT NULL,
        min_lng REAL NOT NULL,
        max_lat REAL NOT NULL,
        max_lng REAL NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS trails_bbox_idx ON trails(min_lat, min_lng)`,

      `CREATE TABLE IF NOT EXISTS water_points (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        last_state TEXT NOT NULL DEFAULT 'unknown',
        last_state_at TEXT,
        elevation INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS water_points_position_idx ON water_points(lat, lng)`,

      `CREATE TABLE IF NOT EXISTS areas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_normalized TEXT NOT NULL,
        type TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        bbox TEXT,
        elevation INTEGER,
        description TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS areas_name_idx ON areas(name_normalized)`,
      `CREATE INDEX IF NOT EXISTS areas_type_idx ON areas(type)`,

      `CREATE TABLE IF NOT EXISTS offline_zones (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT,
        bbox TEXT NOT NULL,
        reports_count INTEGER NOT NULL DEFAULT 0,
        generated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS offline_zones_user_idx ON offline_zones(user_id)`,

      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
        read_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at)`,

      `CREATE TABLE IF NOT EXISTS user_reputation_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        delta INTEGER NOT NULL,
        report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
        actor_id TEXT,
        ref_id TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS user_reputation_events_user_idx ON user_reputation_events(user_id)`,

      `CREATE TABLE IF NOT EXISTS moderation_reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_id TEXT REFERENCES reports(id) ON DELETE CASCADE,
        comment_id TEXT REFERENCES report_comments(id) ON DELETE CASCADE,
        photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        details TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        resolution_note TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS moderation_reports_status_idx ON moderation_reports(status)`,
      `CREATE INDEX IF NOT EXISTS moderation_reports_report_idx ON moderation_reports(report_id)`,

      `CREATE TABLE IF NOT EXISTS presence_pings (
        cell TEXT NOT NULL,
        bucket_start TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (cell, bucket_start)
      )`,
      `CREATE INDEX IF NOT EXISTS presence_pings_bucket_idx ON presence_pings(bucket_start)`,
    ],
  },
  {
    version: 2,
    name: "commune de rattachement des lieux",
    statements: [`ALTER TABLE areas ADD COLUMN commune TEXT`],
  },
  {
    version: 3,
    name: "réseau de chemins (navigation)",
    statements: [
      `CREATE TABLE IF NOT EXISTS paths (
        id TEXT PRIMARY KEY,
        name TEXT,
        kind TEXT NOT NULL DEFAULT 'path',
        surface TEXT,
        sac_scale TEXT,
        width_m REAL,
        foot INTEGER NOT NULL DEFAULT 1,
        bicycle INTEGER NOT NULL DEFAULT 1,
        horse INTEGER NOT NULL DEFAULT 1,
        ford INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        coordinates TEXT NOT NULL,
        elevations TEXT,
        length_m INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'local',
        min_lat REAL NOT NULL,
        min_lng REAL NOT NULL,
        max_lat REAL NOT NULL,
        max_lng REAL NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS paths_bbox_idx ON paths(min_lat, min_lng)`,
      `CREATE INDEX IF NOT EXISTS paths_source_idx ON paths(source)`,
    ],
  },
  {
    version: 4,
    name: "moteur cartographique collectif (activités, passages, statistiques, candidatures)",
    statements: [
      // --- Segments : métadonnées de graphe, profil et synthèse de fréquentation ---
      `ALTER TABLE paths ADD COLUMN trail_id TEXT`,
      `ALTER TABLE paths ADD COLUMN start_node TEXT`,
      `ALTER TABLE paths ADD COLUMN end_node TEXT`,
      `ALTER TABLE paths ADD COLUMN elevation_gain_m REAL`,
      `ALTER TABLE paths ADD COLUMN elevation_loss_m REAL`,
      `ALTER TABLE paths ADD COLUMN average_slope REAL`,
      `ALTER TABLE paths ADD COLUMN max_slope REAL`,
      `ALTER TABLE paths ADD COLUMN difficulty TEXT`,
      `ALTER TABLE paths ADD COLUMN community_confidence REAL`,
      `ALTER TABLE paths ADD COLUMN passage_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE paths ADD COLUMN last_passage_at TEXT`,
      `ALTER TABLE paths ADD COLUMN popularity_score REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE paths ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
      `CREATE INDEX IF NOT EXISTS paths_trail_idx ON paths(trail_id)`,
      `CREATE INDEX IF NOT EXISTS paths_nodes_idx ON paths(start_node, end_node)`,

      // --- Itinéraires : provenance et fiabilité ---
      `ALTER TABLE trails ADD COLUMN source TEXT`,
      `ALTER TABLE trails ADD COLUMN status TEXT`,
      `ALTER TABLE trails ADD COLUMN confidence_score REAL`,

      // --- Activités enregistrées (section 37 : ACTIVITIES) ---
      `CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        name TEXT,
        activity_type TEXT NOT NULL DEFAULT 'hiking',
        source TEXT NOT NULL DEFAULT 'recorded',
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        distance_m INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        moving_ms INTEGER NOT NULL DEFAULT 0,
        elevation_gain_m INTEGER NOT NULL DEFAULT 0,
        elevation_loss_m INTEGER NOT NULL DEFAULT 0,
        max_alt_m INTEGER,
        average_speed_ms REAL,
        point_count INTEGER NOT NULL DEFAULT 0,
        quality_score REAL,
        matched_ratio REAL,
        contribution TEXT NOT NULL DEFAULT 'private',
        contributed_at TEXT,
        processed_at TEXT,
        raw_purged_at TEXT,
        min_lat REAL,
        min_lng REAL,
        max_lat REAL,
        max_lng REAL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS activities_user_idx ON activities(user_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS activities_contribution_idx ON activities(contribution, processed_at)`,

      // --- Trace brute, jamais écrasée (section 5 et 8 : GPS_POINTS) ---
      `CREATE TABLE IF NOT EXISTS activity_points (
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        at INTEGER NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        alt REAL,
        accuracy REAL,
        speed REAL,
        heading REAL,
        quality INTEGER,
        PRIMARY KEY (activity_id, seq)
      )`,

      // --- Trace rattachée au réseau (section 8 : MATCHED_POINTS) ---
      `CREATE TABLE IF NOT EXISTS activity_matched_points (
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        segment_id TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        along REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        deviation_m REAL,
        PRIMARY KEY (activity_id, seq)
      )`,
      `CREATE INDEX IF NOT EXISTS activity_matched_segment_idx ON activity_matched_points(segment_id)`,

      // --- Passages (section 37 : SEGMENT_TRAVERSALS) ---
      `CREATE TABLE IF NOT EXISTS segment_traversals (
        id TEXT PRIMARY KEY,
        segment_id TEXT NOT NULL,
        activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
        user_key TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        entered_at INTEGER NOT NULL,
        exited_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        distance_m REAL NOT NULL DEFAULT 0,
        coverage REAL NOT NULL DEFAULT 1,
        average_speed_ms REAL,
        confidence REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS segment_traversals_segment_idx ON segment_traversals(segment_id, exited_at)`,
      `CREATE INDEX IF NOT EXISTS segment_traversals_activity_idx ON segment_traversals(activity_id)`,
      `CREATE INDEX IF NOT EXISTS segment_traversals_user_idx ON segment_traversals(user_key)`,

      // --- Statistiques agrégées (section 37 : SEGMENT_STATISTICS) ---
      `CREATE TABLE IF NOT EXISTS segment_statistics (
        segment_id TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        passages_7 INTEGER NOT NULL DEFAULT 0,
        passages_30 INTEGER NOT NULL DEFAULT 0,
        passages_365 INTEGER NOT NULL DEFAULT 0,
        passages_total INTEGER NOT NULL DEFAULT 0,
        unique_users INTEGER NOT NULL DEFAULT 0,
        unique_sessions INTEGER NOT NULL DEFAULT 0,
        average_ms INTEGER,
        median_ms INTEGER,
        p25_ms INTEGER,
        p75_ms INTEGER,
        spread REAL,
        average_speed_ms REAL,
        first_passage_at INTEGER,
        last_passage_at INTEGER,
        popularity_score REAL NOT NULL DEFAULT 0,
        frequentation TEXT NOT NULL DEFAULT 'unknown',
        confidence REAL NOT NULL DEFAULT 0,
        insufficient_data INTEGER NOT NULL DEFAULT 1,
        activity_mix TEXT,
        monthly TEXT,
        hourly TEXT,
        trend REAL,
        possibly_inactive INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (segment_id, activity_type, direction)
      )`,
      `CREATE INDEX IF NOT EXISTS segment_statistics_popularity_idx ON segment_statistics(popularity_score)`,

      // --- Candidatures issues de l'apprentissage (sections 17 à 21, 27 à 30, 46) ---
      `CREATE TABLE IF NOT EXISTS network_candidates (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        segment_id TEXT,
        geometry TEXT,
        detail TEXT,
        observations INTEGER NOT NULL DEFAULT 0,
        unique_users INTEGER NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        first_seen_at INTEGER,
        last_seen_at INTEGER,
        min_lat REAL,
        min_lng REAL,
        max_lat REAL,
        max_lng REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TEXT,
        review_note TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS network_candidates_kind_idx ON network_candidates(kind, status)`,
      `CREATE INDEX IF NOT EXISTS network_candidates_bbox_idx ON network_candidates(min_lat, min_lng)`,
      `CREATE INDEX IF NOT EXISTS network_candidates_segment_idx ON network_candidates(segment_id)`,

      // --- Versions de géométrie : rien n'est jamais écrasé (section 47) ---
      `CREATE TABLE IF NOT EXISTS segment_versions (
        id TEXT PRIMARY KEY,
        segment_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        coordinates TEXT NOT NULL,
        source TEXT NOT NULL,
        reason TEXT,
        confidence REAL,
        author TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS segment_versions_unique ON segment_versions(segment_id, version)`,

      // --- Allure personnelle, facultative (section 24) ---
      `CREATE TABLE IF NOT EXISTS user_pace (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        activity_type TEXT NOT NULL,
        factor REAL NOT NULL DEFAULT 1,
        samples INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, activity_type)
      )`,

      // --- Zones privées déclarées par l'utilisateur (section 36) ---
      `CREATE TABLE IF NOT EXISTS privacy_zones (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        radius_m INTEGER NOT NULL DEFAULT 250,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS privacy_zones_user_idx ON privacy_zones(user_id)`,
    ],
  },
  {
    version: 5,
    name: "collecte des traces GPX existantes (sources, découvertes, bibliothèque, attestations)",
    statements: [
      // --- Registre des sources (section 4) : d'où vient chaque chemin ---
      `CREATE TABLE IF NOT EXISTS data_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        type TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT 'FR',
        territory TEXT,
        licence TEXT NOT NULL DEFAULT 'unknown',
        licence_url TEXT,
        commercial_reuse_allowed INTEGER,
        redistribution_allowed INTEGER,
        attribution_required INTEGER,
        attribution_text TEXT,
        api_available INTEGER NOT NULL DEFAULT 0,
        api_url TEXT,
        last_checked_at TEXT,
        checked_by TEXT,
        reliability_score REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'review_required',
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS data_sources_status_idx ON data_sources(status)`,
      `CREATE INDEX IF NOT EXISTS data_sources_territory_idx ON data_sources(territory)`,

      // --- Territoires de déploiement (section 16) ---
      `CREATE TABLE IF NOT EXISTS territories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT 'FR',
        parent_id TEXT,
        aliases TEXT NOT NULL DEFAULT '[]',
        min_lat REAL,
        min_lng REAL,
        max_lat REAL,
        max_lng REAL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS territories_parent_idx ON territories(parent_id)`,

      // --- Ressources repérées par la découverte, avant toute décision (section 5) ---
      `CREATE TABLE IF NOT EXISTS source_discoveries (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT,
        source_id TEXT,
        territory TEXT,
        activity TEXT NOT NULL DEFAULT 'all',
        format TEXT NOT NULL DEFAULT 'unknown',
        has_gpx_file INTEGER NOT NULL DEFAULT 0,
        licence TEXT NOT NULL DEFAULT 'unknown',
        status TEXT NOT NULL DEFAULT 'review_required',
        reason TEXT,
        query TEXT,
        discovered_at TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        notes TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS source_discoveries_status_idx ON source_discoveries(status)`,
      `CREATE INDEX IF NOT EXISTS source_discoveries_territory_idx ON source_discoveries(territory)`,

      // --- Bibliothèque des traces importées (sections 7, 15, 20) ---
      `CREATE TABLE IF NOT EXISTS imported_traces (
        id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        source_id TEXT,
        discovery_id TEXT,
        origin TEXT NOT NULL,
        origin_url TEXT,
        file_name TEXT,
        format TEXT NOT NULL,
        licence TEXT NOT NULL DEFAULT 'unknown',
        attribution TEXT,
        territory TEXT,
        activity TEXT NOT NULL DEFAULT 'all',
        coordinates TEXT NOT NULL,
        elevations TEXT,
        times TEXT,
        breaks TEXT NOT NULL DEFAULT '[]',
        waypoints TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        length_m INTEGER NOT NULL DEFAULT 0,
        elevation_gain_m REAL,
        elevation_loss_m REAL,
        min_lat REAL NOT NULL,
        min_lng REAL NOT NULL,
        max_lat REAL NOT NULL,
        max_lng REAL NOT NULL,
        quality_score REAL,
        quality_level TEXT,
        quality_flags TEXT NOT NULL DEFAULT '[]',
        matched_ratio REAL,
        geometry_hash TEXT,
        duplicate_of TEXT,
        status TEXT NOT NULL DEFAULT 'review_required',
        version INTEGER NOT NULL DEFAULT 1,
        recorded_at TEXT,
        imported_at TEXT NOT NULL,
        imported_by TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        review_note TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS imported_traces_status_idx ON imported_traces(status)`,
      `CREATE INDEX IF NOT EXISTS imported_traces_bbox_idx ON imported_traces(min_lat, min_lng)`,
      `CREATE INDEX IF NOT EXISTS imported_traces_hash_idx ON imported_traces(geometry_hash)`,
      `CREATE INDEX IF NOT EXISTS imported_traces_source_idx ON imported_traces(source_id)`,

      // --- Fichier d'origine conservé tel quel (section 7 : ORIGINAL_GPX_FILE) ---
      `CREATE TABLE IF NOT EXISTS imported_trace_files (
        trace_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (trace_id, version)
      )`,

      // --- Versions successives d'une trace (section 20) ---
      `CREATE TABLE IF NOT EXISTS trace_versions (
        id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        coordinates TEXT NOT NULL,
        length_m INTEGER NOT NULL DEFAULT 0,
        quality_score REAL,
        changed_m REAL,
        reason TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS trace_versions_trace_idx ON trace_versions(trace_id, version)`,

      // --- Rattachement d'un itinéraire importé au réseau (section 6) ---
      `CREATE TABLE IF NOT EXISTS trace_segments (
        trace_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        segment_id TEXT NOT NULL,
        reversed INTEGER NOT NULL DEFAULT 0,
        distance_m REAL NOT NULL DEFAULT 0,
        coverage REAL NOT NULL DEFAULT 0,
        deviation_m REAL,
        PRIMARY KEY (trace_id, seq)
      )`,
      `CREATE INDEX IF NOT EXISTS trace_segments_segment_idx ON trace_segments(segment_id)`,

      // --- Qui atteste qu'un segment existe, et avec quel poids (sections 11, 12) ---
      `CREATE TABLE IF NOT EXISTS segment_attestations (
        id TEXT PRIMARY KEY,
        segment_id TEXT NOT NULL,
        layer TEXT NOT NULL,
        source_id TEXT,
        trace_id TEXT,
        deviation_m REAL,
        observed_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS segment_attestations_unique_idx
         ON segment_attestations(segment_id, layer, COALESCE(source_id, ''), COALESCE(trace_id, ''))`,
      `CREATE INDEX IF NOT EXISTS segment_attestations_segment_idx ON segment_attestations(segment_id)`,

      // --- Confiance et provenance portées par le segment (sections 12, 21, 30) ---
      `ALTER TABLE paths ADD COLUMN source_id TEXT`,
      `ALTER TABLE paths ADD COLUMN geometry_layer TEXT`,
      `ALTER TABLE paths ADD COLUMN trail_confidence REAL`,
      `ALTER TABLE paths ADD COLUMN source_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE paths ADD COLUMN trace_count INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE paths ADD COLUMN last_validated_at TEXT`,
      `CREATE INDEX IF NOT EXISTS paths_source_idx ON paths(source_id)`,
    ],
  },
];

/** Applique toutes les migrations manquantes. Sans effet si la base est à jour. */
export function runMigrations(sqlite: Database.Database): { applied: number[] } {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const done = new Set(
    (sqlite.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  const applied: number[] = [];
  const insert = sqlite.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    const tx = sqlite.transaction(() => {
      for (const statement of m.statements) sqlite.exec(statement);
      insert.run(m.version, new Date().toISOString());
    });
    tx();
    applied.push(m.version);
  }
  return { applied };
}

let ensured = false;
/** Migre la connexion partagée une seule fois par processus (appelé par createApp). */
export async function ensureDatabase(): Promise<void> {
  if (ensured) return;
  ensured = true;
  const { sqlite } = await import("./client");
  runMigrations(sqlite);
}

// Exécution directe : `pnpm --filter @mountain-live/api db:migrate`
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { sqlite } = await import("./client");
  const { config } = await import("../config");
  const { applied } = runMigrations(sqlite);
  console.log(
    applied.length
      ? `[db] Migrations appliquées : ${applied.join(", ")} (${config.databasePath})`
      : `[db] Base déjà à jour (${config.databasePath})`,
  );
  sqlite.close();
}
