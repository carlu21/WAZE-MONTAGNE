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
const DEV_JWT_SECRET = "dev-secret-change-me";
function resolveJwtSecret(): string {
  const raw = process.env.JWT_SECRET;
  if (env === "production") {
    // Jamais de secret par défaut en production : refus de démarrer (jetons admin forgeables sinon).
    if (!raw || raw === DEV_JWT_SECRET || raw.length < 32) {
      throw new Error("JWT_SECRET doit être défini en production (32 caractères minimum, différent de la valeur de développement).");
    }
    return raw;
  }
  return raw && raw.length > 0 ? raw : DEV_JWT_SECRET;
}

export const config = {
  port: intEnv("PORT", 8787),
  jwtSecret: resolveJwtSecret(),
  /** Adresses des reverse-proxies de confiance (X-Forwarded-For honoré uniquement derrière eux). */
  trustProxy: (process.env.TRUST_PROXY ?? "").split(",").map((s) => s.trim()).filter(Boolean),
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
  /**
   * Secret de pseudonymisation des contributions (moteur cartographique).
   * Dérivé du secret de jetons s'il n'est pas fourni. Le changer réinitialise
   * le comptage d'utilisateurs distincts : à ne faire qu'en connaissance de cause.
   */
  pseudonymSecret: process.env.PSEUDONYM_SECRET ?? `pseudonyme:${resolveJwtSecret()}`,
  /** Conservation des traces brutes avant purge (jours) : section 5 du moteur collectif. */
  rawTraceRetentionDays: intEnv("RAW_TRACE_RETENTION_DAYS", 90),
  /** Nombre maximal de points acceptés pour une activité envoyée. */
  maxActivityPoints: intEnv("MAX_ACTIVITY_POINTS", 50_000),
  /** Taille maximale d'une photo (octets) : 5 Mo. */
  maxPhotoBytes: 5 * 1024 * 1024,
  /** Rayon de floutage des espèces sensibles (mètres). */
  blurRadiusM: 400,
  /** Distance maximale pour déduire la zone (nom d'un lieu proche), en mètres. */
  zoneMaxDistanceM: 8000,
  /** Rayon de notification de proximité (mètres). */
  proximityNotifyRadiusM: 2000,
  /**
   * Géocodeur en ligne (repli quand un lieu n'est pas dans la base) : API de géocodage de la
   * Géoplateforme IGN (index « poi » : lieux-dits, sommets, cols, sources… et « address » :
   * communes). GEOCODER_DISABLED=1 le désactive ; GEOCODER_URL permet un autre service compatible.
   */
  geocoder: {
    enabled: process.env.GEOCODER_DISABLED !== "1" && env !== "test",
    url: process.env.GEOCODER_URL ?? "https://data.geopf.fr/geocodage/search",
    timeoutMs: intEnv("GEOCODER_TIMEOUT_MS", 4000),
  },
  /** Limites de débit en mémoire (par adresse IP). RATE_LIMIT_DISABLED=1 les désactive (tests). */
  rateLimit: {
    enabled: process.env.RATE_LIMIT_DISABLED !== "1" && env !== "test",
    auth: { max: intEnv("RATE_LIMIT_AUTH_MAX", 20), windowMs: 10 * 60 * 1000 },
    createReport: { max: intEnv("RATE_LIMIT_REPORTS_MAX", 20), windowMs: 10 * 60 * 1000 },
    presence: { max: 60, windowMs: 10 * 60 * 1000 },
  },
  env,
};
