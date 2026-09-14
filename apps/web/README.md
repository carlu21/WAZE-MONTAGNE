# @mountain-live/web

Application web / PWA de Mountain Live : Vite + React 19 + TypeScript + Tailwind v4 + react-router v7 +
TanStack Query + zustand + maplibre-gl + Dexie. Le design system est documenté dans
`docs/DESIGN_SYSTEM.md`, le contrat HTTP dans `packages/core/src/api-contract.ts`.

## Lancer

```bash
pnpm --filter @mountain-live/api db:reset   # base + jeu de démo (Corse), comptes demo1234
pnpm --filter @mountain-live/api dev        # API sur http://localhost:8787
pnpm --filter @mountain-live/web dev        # http://localhost:5173
```

Le serveur de développement relaie `/api` et `/uploads` vers l'API (les URL de photos sont relatives).

## Vérifier

```bash
pnpm --filter @mountain-live/web typecheck
pnpm --filter @mountain-live/web test       # vitest + jsdom + Testing Library
pnpm --filter @mountain-live/web build      # tsc + vite build + service worker (dist/sw.js)
```

## Structure

| Dossier | Rôle |
| --- | --- |
| `src/main.tsx`, `src/App.tsx` | Point d'entrée : `QueryClientProvider` → `ToastProvider` → `RouterProvider`. |
| `src/router.tsx` | Toutes les routes ; pages chargées à la demande depuis `src/pages/<Nom>Page.tsx`. |
| `src/components/layout` | `AppShell` (barre basse 5 entrées / barre latérale, bannière hors connexion, veilleur d'alertes), `guards` (`RequireAuth`, `RequireRole`). |
| `src/components/ui` | Design system (`@/components/ui`). |
| `src/components/map` | Marqueurs et couches MapLibre générés depuis la taxonomie. |
| `src/features` | Fonctionnalités transverses (hors connexion, alertes de proximité). |
| `src/lib` | Client HTTP typé (`api.ts`), clés TanStack Query (`queryKeys.ts`), base locale Dexie (`db.ts`), file d'attente hors connexion (`outbox.ts`), thème, toasts, formatage. |
| `src/store` | Session (jeton + utilisateur, persistée) et préférences d'interface. |
| `src/styles` | `tokens.css` (palette, tokens sémantiques, dimensions) et `index.css`. |

## PWA

`vite-plugin-pwa` (mode `generateSW`, mise à jour automatique) précache l'application et ses icônes
(`public/icons`, régénérables avec `node apps/web/scripts/generate-icons.mjs`). Règles d'exécution :
tuiles cartographiques et photos `/uploads/*` en cache-first, API `/api/*` en network-first avec repli
cache ; les navigations vers `/api/*` et `/uploads/*` ne reçoivent jamais `index.html`.
