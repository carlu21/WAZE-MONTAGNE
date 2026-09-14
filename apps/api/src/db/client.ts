import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { config } from "../config";
import * as schema from "./schema";

/**
 * Connexion SQLite unique du processus. `DATABASE_PATH=":memory:"` ouvre une base volatile
 * (utilisée par les tests). Le mode WAL et les clés étrangères sont activés systématiquement.
 */
function openDatabase(): Database.Database {
  if (config.databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  }
  const sqlite = new Database(config.databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return sqlite;
}

export const sqlite: Database.Database = openDatabase();
export const db: BetterSQLite3Database<typeof schema> = drizzle({ client: sqlite, schema });
export type Db = typeof db;
