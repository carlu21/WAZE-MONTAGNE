import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { config } from "./config";
import { startExpirationJob } from "./jobs/expire";

const app = createApp();
const stopJob = startExpirationJob();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[api] Mountain Live API démarrée sur http://localhost:${info.port}${config.env === "production" ? "" : " (développement)"}`);
  console.log(`[api] Base SQLite : ${config.databasePath} — photos : ${config.uploadDir}`);
});

function shutdown(signal: string) {
  console.log(`[api] Arrêt (${signal})…`);
  stopJob();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
