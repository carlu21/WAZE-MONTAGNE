import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { config } from "./config";

const app = createApp();
serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[api] Mountain Live API démarrée sur http://localhost:${info.port}`);
});
