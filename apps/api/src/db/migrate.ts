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
