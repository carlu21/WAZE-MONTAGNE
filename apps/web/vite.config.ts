import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "node:path";

/**
 * HTTPS en développement (certificat auto-signé) : indispensable pour ouvrir
 * l'application sur un téléphone du même réseau — géolocalisation, boussole et
 * caméra exigent un contexte sécurisé hors localhost. MOUNTAIN_LIVE_HTTP=1
 * revient au HTTP simple (tests automatisés, dépannage).
 */
const useHttps = process.env.MOUNTAIN_LIVE_HTTP !== "1";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(useHttps ? [basicSsl({ name: "mountain-live", domains: ["localhost", "127.0.0.1", "*.local"] })] : []),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.svg", "icons/*.png"],
      manifest: {
        name: "Mountain Live — La montagne en temps réel",
        short_name: "Mountain Live",
        description:
          "Carte collaborative des dangers, activités, animaux, points d'eau et conditions en montagne, en temps réel.",
        lang: "fr",
        start_url: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#F4F1EA",
        theme_color: "#1F4D28",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        // Une navigation directe vers l'API ou une photo ne doit jamais recevoir index.html.
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//],
        runtimeCaching: [
          {
            // Tuiles cartographiques : cache-first, longue durée (mode hors connexion basique)
            urlPattern: ({ url }) =>
              /tile\.opentopomap\.org|demotiles\.maplibre\.org|tile\.openstreetmap\.org|server\.arcgisonline\.com|data\.geopf\.fr\/wmts|s3\.amazonaws\.com\/elevation-tiles-prod/.test(
                url.host + url.pathname,
              ),
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Photos des signalements : immuables côté API, cache-first
            urlPattern: ({ url }) => url.pathname.startsWith("/uploads/"),
            handler: "CacheFirst",
            options: {
              cacheName: "photos",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // API : network-first avec repli cache
            // Données publiques uniquement : jamais de réponse personnelle (session, notifications, admin…) ni de sonde /health.
            urlPattern: ({ url, request }) =>
              request.method === "GET" && url.pathname.startsWith("/api/") && !/^\/api\/v1\/(auth|users|notifications|admin|pro|health|flags)(\/|$)/.test(url.pathname),
            handler: "NetworkFirst",
            options: {
              cacheName: "api",
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // API et photos (photoUrl / photos[].url sont des chemins relatifs « /uploads/… » servis par l'API).
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/uploads": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
