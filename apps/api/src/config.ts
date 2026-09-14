import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

export const config = {
  port: Number(process.env.PORT ?? 8787),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  databasePath: process.env.DATABASE_PATH ?? path.join(root, "data", "mountain-live.db"),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(root, "uploads"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Durée de rétention des pings de présence (minutes). */
  presenceRetentionMin: 30,
  /** Durée de rétention des signalements expirés avant purge (jours). */
  expiredRetentionDays: 90,
  env: process.env.NODE_ENV ?? "development",
};
