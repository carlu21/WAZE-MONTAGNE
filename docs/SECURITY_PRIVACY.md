# Sécurité et vie privée

## Principes (sections 8, 16, 27, 28)

- **Aucune position individuelle publiée.** Les usagers n'apparaissent jamais sur la carte : seule une estimation agrégée (« Environ 12 utilisateurs actifs dans cette zone ») et une carte thermique par cellule d'≈1 km sont affichées.
- **Présence sans identifiant.** `POST /presence` n'enregistre que la cellule (arrondi 0,01°) et une tranche de 5 minutes ; aucune position précise, aucun identifiant utilisateur en base ; purge après 30 minutes. Pour les alertes de proximité, la cellule d'un utilisateur connecté est gardée **en mémoire** 30 minutes, jamais persistée. Le partage de présence se désactive dans les paramètres.
- **Aucun historique de déplacement**, ni côté serveur ni côté client (la position n'est pas persistée dans le stockage local ; seules la dernière vue de la carte et les préférences le sont).
- **Espèces sensibles floutées** : animaux sauvages, animal blessé, autre observation → coordonnées servies sur une grille de 0,005° dans un rayon ≤ 400 m (`blurLocation`, déterministe) ; les coordonnées exactes restent en base mais ne sont jamais renvoyées (sérialiseurs, bundle hors connexion, exports).
- **Chasseurs** : ce sont des zones de chasse / battue qui sont affichées, jamais des positions individuelles.
- **Agents publics** : aucune catégorie, aucun champ, aucune fonction ne permet de localiser des gardes, agents de l'OFB ou autres agents chargés de contrôles.
- **Réputation** : le score interne n'est jamais exposé ; seul un niveau 1..5 est public.

## Authentification et sessions

- Mots de passe hachés avec **scrypt** (`node:crypto`), sel aléatoire, comparaison en temps constant.
- Jetons **JWT HS256** (`hono/jwt`), 30 jours ; secret via `JWT_SECRET`. En production (`NODE_ENV=production`), l'API **refuse de démarrer** si le secret est absent, trop court (< 32 caractères) ou égal à la valeur de développement.
- Un compte supprimé ou suspendu est refusé à chaque requête (401 / 403 `suspended`).
- Le client purge sa session locale sur 401.

## Permissions par route

| Route | Anonyme | Utilisateur | Partenaire / officiel | Modérateur | Admin |
| --- | --- | --- | --- | --- | --- |
| GET carte, fiche, lieux, sentiers, points d'eau, alertes, présence, communauté, bundle | ✔ | ✔ | ✔ | ✔ | ✔ |
| POST signalement, vote, commentaire, photo, flag, présence | | ✔ | ✔ (source partner / official) | ✔ | ✔ |
| PATCH signalement | | auteur | auteur | ✔ | ✔ |
| Profil, préférences, notifications, suppression de compte | | ✔ | ✔ | ✔ | ✔ |
| `/admin/*` | | | | ✔ | ✔ |
| `/admin/users/:id/suspend` d'un admin | | | | ✗ | ✔ |
| `/pro/dashboard` | | | ✔ | | ✔ |

## Validation, limites et robustesse

- Toutes les entrées sont validées par les schémas zod de `packages/core` (mêmes règles côté client) ; erreurs `400 validation_error` avec le chemin du champ.
- Limites de débit en mémoire par adresse IP : `/auth/register` et `/auth/login` 20 requêtes / 10 min (la restauration de session `/auth/me` n'est pas comptée), `POST /reports` 20 / 10 min, `POST /presence` 60 / 10 min (429 + `Retry-After`). L'en-tête `X-Forwarded-For` n'est honoré que derrière un proxy listé dans `TRUST_PROXY` (dernière adresse ajoutée par le proxy), jamais sur la seule foi du client.
- Photos : multipart, JPEG/PNG/WebP, 5 Mo maximum, type MIME vérifié, nom de fichier généré côté serveur, service statique sans traversée de répertoire.
- Les descriptions et commentaires sont rendus en texte (jamais en HTML) côté client ; les liens d'alertes officielles n'acceptent que `http(s)`.
- La fiche publique d'un signalement ne révèle ni l'identité des votants ni leurs commentaires de contestation (réservés aux modérateurs).
- Le service worker ne met jamais en cache les réponses personnelles (`/auth`, `/users`, `/notifications`, `/admin`, `/pro`) ; les caches de requêtes sont purgés à la connexion et à la déconnexion.
- CORS restreint aux origines de `CORS_ORIGINS` en production.
- Un signalement visé par ≥ 3 signalements de contenu distincts passe automatiquement en `disputed`.

## RGPD

- **Consentement** explicite à l'inscription (case obligatoire, horodatée dans `consent_given_at`) avec lien vers la politique.
- **Droit d'accès et de rectification** : profil et préférences modifiables ; l'e-mail n'est jamais montré aux autres.
- **Droit à l'effacement** : `DELETE /users/me` anonymise irréversiblement (e-mail et hash effacés, pseudo « Utilisateur supprimé », pratiques/région/avatar supprimés), détache les contributions (conservées anonymisées pour la cohérence de la carte), efface les commentaires libres des votes et les précisions des signalements de contenu, supprime préférences, notifications, zones hors connexion, fiche partenaire et journal de réputation ; le jeton devient invalide. Côté appareil, « Effacer les données locales » vide IndexedDB et les caches.
- **Minimisation** : présence agrégée uniquement, floutage, pas d'historique de déplacement, purge des signalements terminés après 90 jours.
- **Transparence** : page `/legal` (règles de sécurité, données collectées, finalités, durées, droits, sources cartographiques).

## Règles de sécurité affichées (section 27)

Encart `SafetyNotice` (fiche de signalement, page légale) : les informations communautaires peuvent être incomplètes ; l'absence de signalement ne signifie pas absence de danger ; l'application ne remplace pas les consignes officielles ; respect des réglementations locales ; décisions sous la responsabilité de l'usager. **Les alertes officielles ont toujours priorité** : affichées en premier, non contestables, en tête des alertes de proximité et de « Autour de moi ».

## Avant une mise en production

- Définir `JWT_SECRET`, `CORS_ORIGINS`, `DATABASE_PATH`, `UPLOAD_DIR` ; servir en HTTPS (obligatoire pour la géolocalisation, la caméra et le service worker).
- Sauvegardes de la base et du dossier des photos ; journalisation sans données personnelles.
- Passer les limites de débit et la présence en mémoire vers un stockage partagé (Redis) si plusieurs instances.
- Revoir les conditions d'utilisation des tuiles (OpenTopoMap, Esri) pour le volume attendu, ou héberger ses propres tuiles.
