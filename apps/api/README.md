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

## Routes principales

Préfixe `/api/v1`, corps et réponses JSON, dates ISO 8601 (UTC), authentification `Authorization: Bearer <jwt>`.
Paramètres et formes de réponse détaillés : `packages/core/src/api-contract.ts` (types) et
`packages/core/src/schemas.ts` (validation zod, partagée avec le front).

| Méthode | Route | Auth | Rôle |
| --- | --- | --- | --- |
| GET | `/health`, `/taxonomy` | — | Santé ; catégories et sous-types (libellés, durées, icônes) |
| POST | `/auth/register`, `/auth/login` | — | Création de compte, connexion → `{ token, user }` |
| GET | `/auth/me` | oui | Profil complet, préférences incluses |
| PATCH / PUT / DELETE | `/users/me`, `/users/me/preferences`, `/users/me` | oui | Profil, préférences, suppression RGPD (204) |
| GET | `/users/:id` | — | Profil public (jamais l'e-mail ni le score brut) |
| GET | `/reports?bbox&categories&source&since&lat&lng&limit` | facultative | Signalements visibles + alertes officielles ; `distanceM` si `lat`/`lng`, `myConfirmation` si connecté ; `includeInactive=1` réservé aux modérateurs |
| POST | `/reports` | oui | Création (201 ; 200 si le `clientId` est déjà connu) |
| GET | `/reports/:id?lat&lng` | facultative | Fiche : signalement, commentaires, votes, auteur public |
| PATCH | `/reports/:id` | auteur ou modérateur | Description, niveau, fin, sous-type, `status` (`active` / `resolved`) |
| POST | `/reports/:id/confirm` | oui | Vote `still_present` / `improved` / `gone` / `disputed` (un par utilisateur, modifiable) |
| GET / POST | `/reports/:id/comments` | facultative / oui | Commentaires |
| POST | `/reports/:id/photos` | oui | Multipart, champ `photo` (JPEG, PNG, WebP ; 5 Mo) |
| POST | `/flags` | oui | Signaler un contenu (signalement, commentaire ou photo) |
| GET | `/around?lat&lng&radius&categories` | facultative | Autour de moi : signalements et points d'eau triés par distance |
| GET | `/areas/search?q`, `/areas/:id` | — / facultative | Recherche de lieux (accents et casse ignorés), fiche de lieu |
| GET | `/trails?bbox`, `/water-points?bbox`, `/alerts/official?bbox` | — | Sentiers, points d'eau, alertes officielles |
| POST / GET | `/presence` | facultative / — | Ping anonyme `{ lat, lng }` (204) ; cellules agrégées d'une bbox |
| GET / POST | `/notifications`, `/notifications/:id/read`, `/notifications/read-all` | oui | Notifications de l'utilisateur |
| GET | `/offline/bundle?bbox` | facultative | Paquet hors connexion (signalements, alertes, sentiers, eau, lieux) |
| GET | `/community/activity` | facultative | Derniers signalements, meilleurs contributeurs, partenaires |
| GET / PATCH / DELETE | `/admin/stats`, `/admin/reports`, `/admin/flags`, `/admin/users`, `/admin/users/:id/suspend`, `/admin/alerts` | moderator / admin | Back-office de modération (pages de 20, `total` renvoyé) |
| GET | `/pro/dashboard?areaId&from&to` | official / partner / admin | Tableau de bord professionnel (30 derniers jours par défaut) |

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
