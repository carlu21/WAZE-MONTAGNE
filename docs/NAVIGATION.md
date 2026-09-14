# Navigation et parcours

## Arbre des routes (`apps/web/src/router.tsx`)

| Route | Écran | Coquille (barre basse) | Accès |
| --- | --- | --- | --- |
| `/` | Splash → redirection | non | libre |
| `/onboarding` | Onboarding (3 écrans, pratiques, localisation, compte) | non | libre |
| `/auth/login`, `/auth/register` | Connexion, création de compte | non | libre |
| `/legal` | Règles de sécurité, confidentialité, attributions | non | libre |
| `/map` | **Carte principale** | oui | libre |
| `/explore`, `/explore/:areaId` | Explorer, fiche de secteur | oui | libre |
| `/around` | Autour de moi | oui | libre (position requise) |
| `/community` | Communauté | oui | libre |
| `/reports/:id` | Fiche d'un signalement | oui | libre (actions : compte) |
| `/profile`, `/profile/preferences`, `/profile/settings` | Profil, préférences, paramètres | oui | compte |
| `/notifications` | Notifications | oui | compte |
| `/offline` | Zones hors connexion | oui | libre |
| `/report`, `/report/:step` | Assistant de signalement (category, subtype, details, done) | non (plein écran) | compte |
| `/flag/:reportId` | Signalement d'un contenu | non | compte |
| `/admin/*` | Back-office (tableau de bord, signalements, litiges, utilisateurs, alertes) | non | moderator, admin |
| `/pro/*` | Tableau de bord professionnel | non | official, partner, admin |

`RequireAuth` redirige vers `/auth/login` en mémorisant la page d'origine (`state.from`) ; `RequireRole` renvoie vers `/map` si le rôle ne convient pas.

## Barre de navigation basse

Cinq entrées, dans l'ordre : **Carte** (`/map`, active aussi sur `/around` et `/reports/*`), **Explorer**, **Signaler** (bouton flottant central « + », orange sécurité, 64 px), **Communauté**, **Profil** (active aussi sur `/notifications` et `/offline`, badge du nombre de notifications non lues). Sur écran ≥ 1024 px, les mêmes entrées forment une barre latérale gauche.

## Parcours idéal de signalement (section 32)

1. L'usager voit un arbre bloquant le chemin : **« + »** (barre basse).
2. **Danger** (tuile) — ou le raccourci « Arbre tombé » proposé en haut de l'écran.
3. **Arbre tombé** (tuile).
4. Détails : la **position GPS est détectée** automatiquement (ajustable en déplaçant la carte) ; **photo** en un geste (caméra arrière) ; **niveau** « Modéré » présélectionné (« Important » en un tap) ; durée par défaut 5 jours.
5. **Publier**.

Cinq gestes, moins de 20 secondes. Hors réseau, le signalement est mis en attente et publié automatiquement plus tard.

## Parcours idéal de consultation (section 33)

1. Ouverture : splash (< 1 s) → carte.
2. La position est connue : la carte se centre (zoom 13).
3. En moins de cinq secondes : les icônes colorées (rouge = danger, brun = animaux, bleu = eau, orange = activité…), les zones d'alerte officielle, le compteur « N signalements dans la vue » et l'estimation de fréquentation.
4. Un tap sur une icône ouvre l'aperçu (feuille basse) : libellé, niveau, source, confiance, « Signalé il y a 35 min », « Confirmé par 8 utilisateurs », boutons « Toujours présent » / « Plus présent », « Voir la fiche ».

## États particuliers

- **Sans compte** : consultation complète ; « Signaler », « Confirmer », « Commenter » redirigent vers la connexion et reviennent à l'écran d'origine.
- **Hors connexion** : bannière « Mode hors connexion » ; carte, fiche et « Autour de moi » lisent le cache local ; les actions sont mises en file d'attente ; « Synchronisation effectuée » au retour du réseau.
- **Compte suspendu** : l'API refuse (403 `suspended`) avec la date de fin ; le message est affiché à la connexion.
- **Rôles** : le profil affiche « Back-office » (modération) et « Tableau de bord professionnel » selon le rôle.
