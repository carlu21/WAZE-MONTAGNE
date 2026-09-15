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

## Écran d'accueil : la carte d'abord

> L'application s'ouvre sur la carte. Pas de tableau de bord, pas de liste de randonnées avant elle.

L'architecture d'usage est celle d'une application de navigation grand public, transposée à la montagne : carte dominante, position au centre, quelques boutons flottants, un panneau qui remonte du bas, et des suggestions immédiatement accessibles sous la barre de recherche.

```
┌──────────────────────────────┐
│ [couches]                    │  discret, en haut à gauche
│                              │
│            CARTE             │  ~60 % de la hauteur au repos
│          ▲ position          │  marqueur directionnel : position ET cap
│      🥾 départs proposés     │
│ [recentrer]      (SIGNALER)  │  deux actions, grandes, atteignables au pouce
├──────────────────────────────┤
│ ══  « Où va-t-on ? »         │  palier d'aperçu
│ Randonnées autour de vous    │  ← remplace « Domicile / Travail »
│ [carte][carte][carte] →      │  défilement horizontal
└──────────────────────────────┘
```

Trois paliers pour le panneau : aperçu (`PEEK_HEIGHT`, calibré pour laisser ~60 % de carte), moitié, plein écran. Développé, il ajoute les classements (plus proches, plus populaires, plus faciles, plus courtes, moins fréquentées) et les filtres rapides (durée, activité).

### Les deux distances

C'est la confusion qui rendrait l'écran trompeur, et elle est traitée comme telle :

| | Champ | Formulation | Place dans la carte |
| --- | --- | --- | --- |
| De vous au départ | `approachM` | « À 4,2 km de vous » | sa propre ligne, en vert, avec une épingle |
| Longueur du parcours | `lengthM` | « 9,4 km » | ligne des chiffres du parcours |

Les deux formulations sont produites par des fonctions distinctes (`approachLabel`, `lengthLabel`), volontairement dissemblables, et un test vérifie qu'elles ne coïncident jamais — même pour une valeur identique.

### Ce qui vient à l'utilisateur

`GET /trails/nearby?lat&lng&activity&sort&limit` cherche dans un rayon **adaptatif** : 10 km, puis 25, puis 50 tant que les résultats sont trop rares (`selectRadius`). La réponse dit quel rayon a été retenu et s'il a fallu l'élargir — l'interface l'affiche plutôt que de laisser croire à un secteur pauvre.

Chaque randonnée porte, en plus des deux distances : durée (observée ou estimée, marquée d'un `≈` quand elle n'est qu'estimée), dénivelé, difficulté, forme (boucle, aller-retour, linéaire), fréquentation et **signalements actifs**. Ce dernier point est ce qui sépare cette application d'une application de randonnée ordinaire : « Battue signalée » s'affiche sur la carte de la randonnée, avant qu'on parte.

Une fréquentation inconnue n'est jamais présentée comme un chemin calme : elle n'est pas affichée du tout.

### Sélectionner une randonnée

Sélectionner ne change pas de page (c'est le point d'ergonomie essentiel) : la carte se recentre, le tracé complet apparaît, et une fiche monte depuis le bas. L'action principale dépend de la distance au départ — on ne propose pas de « démarrer » une randonnée dont le départ est à 7 km, on propose d'y aller (`AT_TRAILHEAD_M`).

## Ce que l'application a le droit d'afficher

> **NE JAMAIS RELIER DEUX POSITIONS GPS PAR UNE SIMPLE LIGNE DROITE POUR
> REPRÉSENTER UN ITINÉRAIRE.**

Une ligne droite entre deux points GPS ne peut être qu'une **direction
indicative** — une flèche de boussole, courte et bornée. Jamais un chemin à
suivre. Un itinéraire suit le réseau réel de chemins, ou il n'existe pas.

Le module `packages/core/src/navigation/truth.ts` répond aux questions que le
reste du code doit poser **avant** d'afficher quoi que ce soit. Il ne dessine
rien : il autorise, ou il refuse.

### Trois objets, jamais confondus

| | Objet | D'où il vient | Comment il se dessine |
| --- | --- | --- | --- |
| **A** | La position | Le dernier relevé GPS | Marqueur orienté (disque si le cap est inconnu) + cercle d'incertitude |
| **B** | La trace parcourue | Les relevés enregistrés, dans l'ordre | Trait orange **découpé** aux sauts invraisemblables (`splitTrace`) |
| **C** | L'itinéraire à suivre | Le réseau réel de chemins | Trait bleu, portion faite / restante — **et rien du tout** s'il ne passe pas `routeVerdict` |

### 1. Cette géométrie est-elle un chemin, ou un schéma ? — `geometryFidelity`

Une polyligne qui avance de plus de `SCHEMATIC_MEAN_SPACING_M` (150 m) en
moyenne ne décrit pas le terrain : elle relie des points de passage. Un seul
bond de plus de `SCHEMATIC_MAX_GAP_M` (600 m) suffit aussi à la disqualifier,
tout comme une longueur inférieure à 70 % de la longueur annoncée par la source
(la ligne coupe au plus court). Verdict : `detailed` ou `schematic`.

### 2. Ai-je le droit de tracer cet itinéraire ? — `routeVerdict`

Deux conditions cumulatives : géométrie **relevée** (`osm`, `ign`, `gpx` — pas
`seed` ni `local`) **et** `detailed`. Sinon, cinq refus nommés, chacun avec sa
phrase :

| Refus | Phrase affichée |
| --- | --- |
| `no_geometry` | « Le tracé de cet itinéraire n'est pas encore disponible. » |
| `schematic_geometry` | « Le tracé connu relie des points de passage, pas le chemin réel… » |
| `not_surveyed` | « Ce tracé vient du jeu de démonstration… » |
| `no_network` | « Aucun chemin connu dans ce secteur… » |
| `unreachable` | « Aucun chemin connu ne relie ces deux points. » |

En tête de tout refus : **« Aucun itinéraire pédestre fiable disponible entre
ces deux points. »**, puis « Afficher les chemins à proximité » — qui montre les
segments réels du secteur, ceux issus du jeu de démonstration en pointillé pâle.

La densification (`densify`) du réseau de démonstration interpole des sommets
**sur une ligne droite** : elle rend la ligne jolie, elle ne la rend pas vraie.
C'est précisément pourquoi la provenance prime sur la finesse apparente.

### 3. Le calcul d'itinéraire passe par le réseau

« Me guider vers le départ » appelle `POST /network/routes` :
`buildRoutingGraph` construit un graphe (nœuds = intersections, arêtes =
portions de chemin réelles), `planRoutes` fait un A* par critère. La réponse
porte désormais `sources` — les provenances des segments empruntés. Côté client,
`interpretPlan` (`features/navigation/planner.ts`) retient la **moins fiable**
d'entre elles : un parcours n'est relevé que si tous ses maillons le sont.

Une panne réseau est un refus, pas une ligne droite.

### 4. Cette position est-elle fiable ? — `positionTrust`

| État | Quand | Ce qui est permis |
| --- | --- | --- |
| `unavailable` | Aucun relevé | Rien : « Acquisition GPS… », pas de marqueur |
| `acquiring` | Signal perdu, recherché, ou précision > 60 m | Rien non plus |
| `coarse` | Position réelle mais précision > 25 m, ou moins de 3 relevés | Afficher la position et sa marge |
| `reliable` | Précision ≤ 25 m, qualité bonne, ≥ 3 relevés | Juger du sentier |

Une précision inconnue n'est pas une bonne précision. Un premier relevé précis
**est** une position — on l'affiche avec sa marge ; ce qui lui manque n'est pas
la précision mais l'historique.

### 5. Ai-je le droit de dire « Hors sentier » ? — `trailVerdict`

Trois conditions préalables (`canJudgeTrail`) : position `reliable`, réseau
chargé, map matching effectué. **Plus** plusieurs relevés successifs au-delà de
la tolérance (`TRAIL_MIN_CONSECUTIVE`). Tant que ce n'est pas réuni, la phrase
est « Position en cours d'acquisition » — jamais une accusation. Quelques mètres
d'écart, une fois la position fiable, n'affichent rien du tout.

La même porte ferme l'alerte de sortie d'itinéraire : le moteur peut basculer,
l'utilisateur n'a pas à lire « vous avez quitté l'itinéraire » sur un doute.

### 6. Ces deux relevés se suivent-ils ? — `splitTrace`

La trace est découpée là où deux relevés ne peuvent pas être consécutifs :
plus de 400 m d'écart, plus de 3 minutes de silence, ou une vitesse supérieure à
12 m/s. Le trait est alors **interrompu** plutôt que rafistolé — un tunnel, une
reprise de signal ou une mise en veille ne sont pas un déplacement.

### Un seul indicateur GPS

`GpsStatus` remplace les trois messages redondants (bandeau, puce, encart) par
un composant unique qui **disparaît de lui-même** : « ● Acquisition GPS… » tant
que le signal se cherche, puis simplement « GPS ± 8 m ». `GpsWaiting` n'apparaît
que lorsqu'aucun relevé n'est encore arrivé.

## Navigation de l'application : quatre onglets

**L'ACCUEIL EST LA CARTE.** Il n'y a donc pas d'onglet « Carte » à côté : deux
entrées pour la même expérience sont une hésitation, pas une navigation.

```
┌──────────┬──────────┬───────────┬────────┐
│ Accueil  │ Explorer │ Activités │ Profil │
│    ▲     │    ✦     │    👣     │   ◍    │
└──────────┴──────────┴───────────┴────────┘
```

| Onglet | Rôle | Icône, et pourquoi |
| --- | --- | --- |
| **Accueil** | La carte : position, chemins, signalements, « Où va-t-on ? », randonnées alentour, recentrer, **+ Signaler** | Flèche de position — l'accueil n'est pas un salon, c'est le terrain (pas de maison) |
| **Explorer** | Découverte : recherche, filtres (à proximité, durée, difficulté, activité), randonnées et secteurs. **Pas de carte principale** | Boussole — on cherche où aller |
| **Activités** | Les sorties enregistrées, groupées par jour, avec distance, durée, D+ et trace | Empreintes — ce qu'on a réellement parcouru |
| **Profil** | Compte, préférences, contributions, signalements, réglages, hors connexion, vie privée | Silhouette |

**« Signaler » n'est pas un onglet** : c'est une ACTION. Elle vit en bouton
flottant orange sur la carte de l'Accueil et pendant l'activité — là où on la
déclenche vraiment.

## MODE EXPLORATION et MODE ACTIVITÉ

Deux modes, jamais mélangés. Dès qu'une activité démarre, la barre à quatre
onglets **disparaît** (elle n'est pas seulement recouverte) et l'écran devient :

```
┌─────────────────────────────┐
│ instruction / état          │  UN indicateur GPS, qui s'efface
│                             │
│           CARTE             │  plein écran
│                             │
│ [Couches] (SIGNALER) [Recentrer]
├─────────────────────────────┤
│ DISTANCE DURÉE VITESSE  D+  │
│   ⏸ Pause      ■ Terminer   │
└─────────────────────────────┘
```

**« ■ Terminer »** est écrit en toutes lettres : un carré rouge n'explique rien
et se presse par erreur. Une confirmation (« Terminer l'activité ? » / Annuler /
Terminer) est demandée avant d'arrêter une sortie de six heures.
