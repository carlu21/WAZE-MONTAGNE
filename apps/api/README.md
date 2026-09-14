# @mountain-live/api

API HTTP de Mountain Live : Hono + drizzle-orm + SQLite (better-sqlite3), préfixe `/api/v1`.
Le contrat des routes est documenté dans `packages/core/src/api-contract.ts`, la validation des
entrées dans `packages/core/src/schemas.ts`.

## Lancer

```bash
pnpm --filter @mountain-live/api db:reset   # recrée la base et charge le jeu de démo (Corse)
pnpm --filter @mountain-live/api dev        # http://localhost:8787 (rechargement automatique)
pnpm --filter @mountain-live/api start      # sans rechargement
```

Les migrations SQL (idempotentes) sont jouées automatiquement au démarrage ; `db:migrate`
les applique à la main, `db:seed` recharge le jeu de démonstration sans supprimer le fichier.

Vérifications : `pnpm --filter @mountain-live/api typecheck && pnpm --filter @mountain-live/api test`.
Les tests tournent sur une base SQLite en mémoire et un dossier d'upload temporaire.

## Comptes de démonstration

Mot de passe commun : `demo1234`.

| E-mail                              | Rôle        | Usage                                   |
| ----------------------------------- | ----------- | --------------------------------------- |
| `admin@mountain-live.demo`          | `admin`     | Back-office complet, tableau de bord pro |
| `moderateur@mountain-live.demo`     | `moderator` | Modération (flags, suspensions)          |
| `mairie-corte@mountain-live.demo`   | `official`  | Signalements « Source officielle », pro  |
| `berger-asco@mountain-live.demo`    | `partner`   | Partenaire vérifié (berger)              |
| `guide-bavella@mountain-live.demo`  | `partner`   | Partenaire vérifié (guide)               |
| `rando@mountain-live.demo`          | `user`      | Utilisateur avec notifications          |

Huit autres comptes communautaires (`lisandru@`, `ghjulia@`, `petru@`, `maria@`, `anto@`, `santu@`,
`paulu@`, `francesca@mountain-live.demo`) alimentent les votes et commentaires.

Le jeu de données couvre la Corse : 43 lieux (communes, massifs, sommets, cols, lacs, refuges du GR20),
8 sentiers, 32 points d'eau, 4 alertes officielles, ~70 signalements récents dans toutes les catégories,
avec photos de démonstration générées dans `uploads/demo/`.

## Variables d'environnement

| Variable               | Défaut                              | Rôle                                                   |
| ---------------------- | ----------------------------------- | ------------------------------------------------------ |
| `PORT`                 | `8787`                              | Port HTTP                                              |
| `JWT_SECRET`           | `dev-secret-change-me`              | Clé HS256 des jetons (30 jours) — à changer en prod    |
| `DATABASE_PATH`        | `./data/mountain-live.db`           | Fichier SQLite (`:memory:` pour une base volatile)     |
| `UPLOAD_DIR`           | `./uploads`                         | Photos, servies sous `/uploads/…`                      |
| `CORS_ORIGINS`         | `http://localhost:5173,…`           | Origines autorisées (toutes acceptées hors production) |
| `NODE_ENV`             | `development`                       | `production` active le CORS strict                     |
| `RATE_LIMIT_AUTH_MAX`  | `20`                                | Requêtes / 10 min / IP sur `/auth/*`                   |
| `RATE_LIMIT_REPORTS_MAX` | `20`                              | Créations de signalement / 10 min / IP                 |
| `RATE_LIMIT_DISABLED`  | —                                   | `1` désactive les limites (tests)                      |

## Points d'attention

- **Confidentialité** : les coordonnées exactes d'un signalement sensible (espèces) restent en base ;
  l'API ne sert jamais que `display_lat/lng` (floutage déterministe ≤ 400 m). La présence est stockée
  uniquement par cellule d'environ 1 km et tranche de 5 minutes, sans identifiant, purgée après 30 min.
  Les alertes de proximité s'appuient sur une mémoire volatile (jamais persistée) des cellules des
  utilisateurs authentifiés.
- **Cycle de vie** : une tâche toutes les 60 s passe en « expiré » les signalements dépassés et purge
  les signalements terminés depuis plus de 90 jours. Le fondu (`fade`) est calculé à la lecture.
- **Photos** : multipart champ `photo`, JPEG/PNG/WebP vérifiés par signature binaire, 5 Mo max.
  L'URL renvoyée est relative (`/uploads/<reportId>/<id>.<ext>`) : en développement, le proxy du
  front doit relayer `/uploads` vers l'API en plus de `/api`.
- **Erreurs** : toujours `{ error: { code, message, details? } }` ; `validation_error` (400),
  `unauthorized` (401), `forbidden` / `suspended` (403), `not_found` (404), `own_report` (400),
  `report_closed` (409), `rate_limited` (429), `photo_too_large` (413), `unsupported_media_type` (415).
