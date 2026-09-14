# Contribuer

## Conventions

- **TypeScript strict** partout ; pas de `any` non justifié.
- **Français** pour toutes les chaînes visibles (réutiliser `fr` et la taxonomie de `@mountain-live/core`), commentaires en français ou en anglais mais cohérents par fichier.
- **Contrat d'abord** : toute nouvelle donnée passe par `packages/core` (types, schéma zod, contrat d'API), puis l'API, puis le client. Ne jamais dupliquer une règle métier côté API ou client : elle vit dans `core` et est testée là.
- **Structure web** : un écran = `src/pages/<Nom>Page.tsx` (léger), la logique et les composants dans `src/features/<domaine>/`, les composants réutilisables dans `src/components/ui` (documentés dans `docs/DESIGN_SYSTEM.md`).
- **Données serveur** : TanStack Query avec les clés de `src/lib/queryKeys.ts` ; invalider `qk.reportsRoot` après toute création ou confirmation.
- **Accessibilité extérieure** : cibles ≥ 48 px, contraste AA, `aria-label` sur les boutons d'icône, aucune information portée par la couleur seule, rouge réservé aux alertes importantes.
- **Vie privée** : jamais de position individuelle, jamais d'e-mail exposé, jamais de score de réputation brut.

## Ajouter un sous-type de signalement

1. `packages/core/src/types.ts` : ajouter l'identifiant à `ReportSubtype`.
2. `packages/core/src/taxonomy.ts` : ajouter l'entrée (libellé, icône lucide, durées, options) — le test `CategoryIcon.test.tsx` vérifie que l'icône existe (sinon ajouter un alias dans `apps/web/src/components/ui/icons.ts`).
3. Rien d'autre : formulaires, filtres, marqueurs, alertes et API suivent la taxonomie.

## Vérifier avant de proposer

```bash
pnpm typecheck && pnpm test && pnpm --filter @mountain-live/web build
```

Pour un parcours réel : `pnpm --filter @mountain-live/api db:reset && pnpm dev`, puis tester sur mobile (390 px) le parcours « + → Danger → Arbre tombé → Publier ».

## Git

Branches de fonctionnalité, commits descriptifs en français, une fonctionnalité par demande de fusion, tests ajoutés avec la règle métier.
