import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const env = process.env.NODE_ENV ?? "development";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Configuration de l'API. Tout est surchargeable par variable d'environnement
 * (voir .env.example et README.md). Les valeurs sont lues une seule fois au démarrage.
 */
export const config = {
  port: intEnv("PORT", 8787),
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  /** Durée de validité des jetons (secondes) : 30 jours. */
  jwtTtlSec: 30 * 24 * 3600,
  /** Chemin SQLite ; ":memory:" pour une base volatile (tests). */
  databasePath: process.env.DATABASE_PATH ?? path.join(root, "data", "mountain-live.db"),
  uploadDir: process.env.UPLOAD_DIR ?? path.join(root, "uploads"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** Durée de rétention des pings de présence (minutes). */
  presenceRetentionMin: 30,
  /** Largeur d'une tranche de présence (minutes). */
  presenceBucketMin: 5,
  /** Durée de rétention des signalements expirés / supprimés avant purge (jours). */
  expiredRetentionDays: 90,
  /** Taille maximale d'une photo (octets) : 5 Mo. */
  maxPhotoBytes: 5 * 1024 * 1024,
  /** Rayon de floutage des espèces sensibles (mètres). */
  blurRadiusM: 400,
  /** Distance maximale pour déduire la zone (nom d'un lieu proche), en mètres. */
  zoneMaxDistanceM: 8000,
  /** Rayon de notification de proximité (mètres). */
  proximityNotifyRadiusM: 2000,
  /** Limites de débit en mémoire (par adresse IP). RATE_LIMIT_DISABLED=1 les désactive (tests). */
  rateLimit: {
    enabled: process.env.RATE_LIMIT_DISABLED !== "1" && env !== "test",
    auth: { max: intEnv("RATE_LIMIT_AUTH_MAX", 20), windowMs: 10 * 60 * 1000 },
    createReport: { max: intEnv("RATE_LIMIT_REPORTS_MAX", 20), windowMs: 10 * 60 * 1000 },
    presence: { max: 60, windowMs: 10 * 60 * 1000 },
  },
  env,
};
