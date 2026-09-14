# @mountain-live/web — PWA Mountain Live

## Lancer

```bash
pnpm --filter @mountain-live/api db:reset   # données de démonstration (Corse)
pnpm dev                                    # ou : pnpm --filter @mountain-live/web dev
```

Le serveur Vite (port 5173) relaie `/api` et `/uploads` vers l'API (port 8787). En production, définir `VITE_API_URL` si l'API n'est pas servie sur la même origine.

`pnpm --filter @mountain-live/web build` génère `dist/` avec le service worker (`sw.js`) et le manifeste ; `preview` sert ce build.

## Structure de `src/`

| Dossier | Contenu |
| --- | --- |
| `pages/` | un composant par route (`router.tsx`) |
| `features/map` | carte principale : chargement des signalements (`useReports`), couches (signalements, alertes officielles, présence), géolocalisation, recherche, filtres, aperçu, légende |
| `features/report` | assistant de signalement : état du brouillon, position, photo, étapes, publication / file d'attente |
| `features/report-detail` | fiche : données, votes, commentaires, partage, carte statique |
| `features/account`, `features/notifications` | onboarding, pratiques, authentification, profil, préférences |
| `features/explore`, `features/around`, `features/community` | recherche de secteur, mini-carte, fusion « autour de moi » |
| `features/offline` | réseau, synchronisation, bannière, tuiles, zones, sélecteur de zone |
| `features/alerts` | moteur d'alertes de proximité, veilleur, présence agrégée |
| `features/admin`, `features/pro` | graphiques SVG, CSV, saisie de géométrie |
| `components/ui` | design system (voir `docs/DESIGN_SYSTEM.md`) |
| `components/map` | `MapView` MapLibre, fonds de carte, couches, images de marqueurs |
| `lib/` | client API typé, clés de requête, Dexie, file d'attente, formats, thème, toasts, service worker |
| `store/` | zustand : session (jeton, utilisateur, onboarding) et interface (filtres, fond, thème, vue, position, réseau) |

## Ajouter un écran

1. Créer `src/pages/<Nom>Page.tsx` (export par défaut) et la logique dans `src/features/<domaine>/`.
2. Déclarer la route dans `src/router.tsx` (dans la coquille pour avoir la barre basse, hors coquille pour un écran plein).
3. Utiliser les composants de `@/components/ui`, le client `@/lib/api` et les clés `@/lib/queryKeys`.

## Ajouter un sous-type de signalement

Voir `CONTRIBUTING.md` : tout part de `packages/core/src/taxonomy.ts` ; les tests vérifient que l'icône lucide existe.

## Tests

`pnpm --filter @mountain-live/web test` (vitest + testing-library, jsdom).
