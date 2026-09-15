# Navigation et parcours

## Arbre des routes (`apps/web/src/router.tsx`)

| Route | Écran | Coquille (barre basse) | Accès |
| --- | --- | --- | --- |
| `/` | Splash → redirection (onboarding au premier lancement, sinon `/navigate`) | non | libre |
| `/onboarding` | Onboarding (3 écrans, pratiques, localisation, compte) | non | libre |
| `/auth/login`, `/auth/register` | Connexion, création de compte | non | libre |
| `/legal` | Règles de sécurité, confidentialité, attributions | non | libre |
| `/navigate` | **Accueil : « Démarrer un itinéraire »** (itinéraires à proximité, GPX, traces, réglages) puis suivi GPS plein écran et résumé — voir [NAVIGATION_GPS.md](NAVIGATION_GPS.md) | oui (accueil) ; non pendant l'activité | libre |
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

Cinq entrées, dans l'ordre : **Itinéraire** (`/navigate`, l'accueil : démarrer une navigation), **Carte** (`/map`, active aussi sur `/around` et `/reports/*`), **Signaler** (bouton flottant central « + », orange sécurité, 64 px), **Explorer** (active aussi sur `/community`), **Profil** (active aussi sur `/notifications` et `/offline`, badge du nombre de notifications non lues). La communauté est accessible depuis Explorer et Profil. Sur écran ≥ 1024 px, les mêmes entrées forment une barre latérale gauche.

## Parcours idéal de signalement (section 32)

1. L'usager voit un arbre bloquant le chemin : **« + »** (barre basse).
2. **Danger** (tuile) — ou le raccourci « Arbre tombé » proposé en haut de l'écran.
3. **Arbre tombé** (tuile).
4. Détails : la **position GPS est détectée** automatiquement (ajustable en déplaçant la carte) ; **photo** en un geste (caméra arrière) ; **niveau** « Modéré » présélectionné (« Important » en un tap) ; durée par défaut 5 jours.
5. **Publier**.

Cinq gestes, moins de 20 secondes. Hors réseau, le signalement est mis en attente et publié automatiquement plus tard.

## Parcours idéal de consultation (section 33)

1. Ouverture : splash (< 1 s) → accueil « Démarrer un itinéraire » ; onglet Carte pour la consultation.
2. La position est connue : la carte se centre (zoom 13).
3. En moins de cinq secondes : les icônes colorées (rouge = danger, brun = animaux, bleu = eau, orange = activité…), les zones d'alerte officielle, le compteur « N signalements dans la vue » et l'estimation de fréquentation.
4. Un tap sur une icône ouvre l'aperçu (feuille basse) : libellé, niveau, source, confiance, « Signalé il y a 35 min », « Confirmé par 8 utilisateurs », boutons « Toujours présent » / « Plus présent », « Voir la fiche ».

## Parcours de navigation (module GPS)

1. Ouverture de l'application → accueil « Démarrer un itinéraire » (aussi : onglet Itinéraire, bouton « Navigation » de la carte, « Démarrer » sur un sentier d'une fiche de secteur).
2. Choisir un itinéraire (liste des plus proches, recherche par nom, GPX importé, trace enregistrée) puis « Démarrer », ou « Explorer librement » ; réglages repliés (activité, précision, voix, simulation).
3. Suivi : la carte se centre et suit ; le marqueur est rattaché au chemin ; instruction en haut (« Continuez sur ce sentier pendant 1,2 km », « Prenez le sentier à droite »), alertes devant soi par palier (« Attention : Battue dans 800 m »), barre de statistiques en bas ; « + » pour signaler sans interrompre le suivi ; « Revenir sur mes pas ».
4. Sortie d'itinéraire : « Vous semblez avoir quitté l'itinéraire. » → « Revenir au parcours » (ligne et consigne vers le point le plus proche) ou « Continuer en mode libre ».
5. Terminer → résumé (distance, durée, dénivelés, altitude max, vitesse) → enregistrer la trace / exporter en GPX.

## États particuliers

- **Sans compte** : consultation complète ; « Signaler », « Confirmer », « Commenter » redirigent vers la connexion et reviennent à l'écran d'origine.
- **Hors connexion** : bannière « Mode hors connexion » ; carte, fiche et « Autour de moi » lisent le cache local ; les actions sont mises en file d'attente ; « Synchronisation effectuée » au retour du réseau.
- **Compte suspendu** : l'API refuse (403 `suspended`) avec la date de fin ; le message est affiché à la connexion.
- **Rôles** : le profil affiche « Back-office » (modération) et « Tableau de bord professionnel » selon le rôle.
