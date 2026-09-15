# Moteur cartographique collectif

> La carte initiale fournit le réseau ; l'usage réel améliore continuellement la connaissance de ce réseau.

L'application ne se contente pas de connaître « les chemins présents sur une carte ». Elle apprend **comment la montagne est réellement parcourue** : où passent les gens, combien de temps ils mettent, quelles variantes ils empruntent, où ils ralentissent, où ils se trompent, et quels chemins existent sans figurer sur aucune carte.

## Chaîne complète

```
 cartographie existante (OSM, IGN, partenaires, GPX)
        │
        ▼
 réseau de chemins ──► graphe (nœuds = intersections, arêtes = segments)
        │
        │        trace brute GPS de l'utilisateur (jamais modifiée)
        │                 │
        │                 ▼
        │        qualité des points ──► map matching ──► trace rattachée
        │                                                   │
        └───────────────────────────────────────────────────┤
                                                            ▼
                                          passages par segment (sens, durée)
                                                            │
        ┌───────────────────────────────┬───────────────────┼───────────────────────┐
        ▼                               ▼                   ▼                       ▼
  statistiques                    temps observés      apprentissage            coûts de routage
 (fréquentation,                 (médiane, quartiles,  (géométrie, chemins    (distance, temps,
  saisonnalité,                   par activité,         potentiels, variantes, difficulté,
  popularité)                     par sens)             ralentissements,      popularité)
                                                        demi-tours, confusion)      │
                                                            │                       ▼
                                                            ▼             itinéraires multicritères
                                                   candidatures à modérer
```

## Où est le code

| Couche | Emplacement | Rôle |
| --- | --- | --- |
| Contrat | `packages/core/src/network/types.ts` | tous les types du moteur ; les modules s'y conforment |
| Qualité des points | `network/quality.ts` | score 0–5, détection des aberrations GPS (sections 4 et 6) |
| Passages | `network/traversals.ts` | map matching différé, découpage en passages, portions hors réseau (7, 8, 9, 13, 15) |
| Statistiques | `network/statistics.ts` | fenêtres, percentiles, popularité, saisonnalité, tendance (9 à 16, 30 à 32, 42, 43) |
| Temps | `network/timing.ts` | théorique → observé → prédit, confiance, allure personnelle (13, 14, 16, 24 à 26) |
| Routage | `network/routing.ts` | graphe orienté, coûts par activité, A\*, alternatives (22, 23, 39 à 41) |
| Apprentissage géométrique | `network/learning-geometry.ts` | ligne centrale communautaire, chemins potentiels, variantes (17 à 21) |
| Apprentissage comportemental | `network/learning-behaviour.ts` | ralentissements, demi-tours, intersections confuses (27 à 29) |
| Vie privée | `network/privacy.ts` | masquage, k-anonymat, neutralisation des statistiques (34 à 36) |
| Ingestion | `apps/api/src/services/activities.ts` | trace brute, traitement, contribution, purge |
| Agrégation | `apps/api/src/services/network-stats.ts` | recalcul incrémental, carte de fréquentation |
| Candidatures | `apps/api/src/services/network-learning.ts` | détecteurs → `network_candidates` |
| Interface | `apps/web/src/features/network/*` | fréquentation, fiche de chemin, planificateur, tableau de bord |

Le moteur est **pur** : aucune fonction de `packages/core/src/network` ne connaît la base de données, le réseau ou le navigateur. Elles sont testables une à une et réutilisables dans une application native.

## 1 à 2. Base initiale et graphe

Aucun chemin n'est dessiné à la main. Le réseau vient de sources existantes, fusionnées dans une même table `paths` (un segment = une arête du graphe) : OpenStreetMap (`highway=path|footway|track|bridleway|cycleway|steps|via_ferrata`, avec `surface`, `sac_scale`, `smoothness`, `access`, `foot`, `bicycle`, `horse`, `width`, `ford`, `name`, `ref`), IGN, open data, traces GPX, données de partenaires. Chaque source garde son identifiant (`osm_<way>`, `d_<démo>`, …) : rien n'est écrasé, et aucune source n'est présumée parfaite.

Les lignes sont **découpées à chaque nœud partagé** : une intersection est une extrémité de segment, jamais un point au milieu. Chaque segment porte sa géométrie, son profil (distance, D+, D−, pentes), ses pratiques autorisées, son statut, sa version, et la synthèse de sa fréquentation.

## 3 à 6. Enregistrer sans mentir sur la précision

L'enregistrement démarre sur un geste explicite (« Démarrer »), avec le choix de l'activité : randonnée, trail, VTT, équitation, autre. La **cadence est adaptative** (`shouldEmitFix`) : un virage marqué ou une rupture de vitesse déclenchent un relevé immédiat, l'immobilité espace les relevés, le reste suit le mode de suivi choisi. Objectif : reconstruire fidèlement le trajet sans vider la batterie.

Chaque point porte sa **précision annoncée** : un téléphone ne connaît pas sa position au millimètre, et l'application ne le prétend jamais. Le module `quality.ts` attribue un score 0–5 en croisant précision, vitesse plausible pour l'activité, accélération, cohérence de cap, doublons et immobilité. Le cas d'école du cahier des charges — un marcheur à 5 km/h dont un relevé saute à 120 m puis revient — est détecté comme « téléport » et écarté, sans dégrader ses voisins.

## 7 à 8. Map matching, et deux traces conservées

Le rattachement réutilise le moteur de navigation (hypothèses multiples : distance, cap, continuité, activité, hystérésis aux intersections) rejoué en différé sur la trace entière. Résultat : une **trace rattachée** qui coexiste avec la **trace brute**. La trace brute n'est jamais écrasée — c'est elle qui permettra demain de rejouer un meilleur algorithme, et c'est elle (et non la trace rattachée, déjà collée au tracé existant) qui révèle qu'une géométrie est fausse.

## 9 à 16. Ce que les passages apprennent

Un passage = une série de points consécutifs sur un même segment, dans un même sens, avec entrée et sortie **interpolées** aux extrémités réellement franchies. Un aller-retour produit deux passages, un par sens : monter 420 m et les redescendre n'a rien de comparable.

Un passage est retenu s'il couvre au moins la moitié du segment **ou** au moins 500 m de terrain. Le réseau réel est fait d'arêtes très inégales : une piste découpée tous les 300 m, et une section de GR que nulle intersection ne coupe sur 40 km. Exiger « la moitié » sur la seconde effacerait tous ses passages, et un chemin très emprunté passerait pour désert (section 43). La couverture reste portée par le passage, et c'est la couche statistique qui décide, elle, si la **durée** est comparable.

Les statistiques sont calculées par (segment, activité, sens), plus les agrégats :

- comptages 7 / 30 / 365 jours et total, utilisateurs distincts, sessions distinctes (un aller-retour dans la même sortie ne compte pas pour deux personnes) ;
- durées : **médiane** privilégiée, plus p25/p75 et dispersion ; un passage partiel est extrapolé avant d'entrer dans la statistique ;
- répartition par activité, par mois, par heure ;
- popularité 0–100 pondérée par la **fraîcheur** (demi-vie de 180 jours) : 50 passages récents pèsent plus que 100 passages d'il y a cinq ans ;
- tendance sur douze mois et signalement `possiblyInactive` — un signalement, jamais une conclusion.

## 17 à 21. Apprendre la géométrie

Quand un faisceau de traces passe **systématiquement** à côté du tracé, le moteur calcule une ligne centrale statistique : recalage sur une abscisse commune, médiane latérale pondérée par la précision, traces trop imprécises écartées. Si le décalage médian dépasse quelques mètres avec assez de passages et d'utilisateurs distincts, une **candidature** est créée — la carte officielle n'est jamais modifiée d'office.

Même logique pour les **chemins potentiels** : des portions hors réseau regroupées en corridor, retenues seulement si plusieurs utilisateurs distincts les empruntent, sur une durée suffisante. Une personne qui se perd ne crée jamais un chemin (section 20). Les **variantes** entre deux mêmes points sont conservées avec leur part d'usage : deux façons d'aller au refuge sont deux informations, pas une erreur.

## 22 à 26, 39 à 42. Itinéraires et temps

Le graphe orienté porte cinq coûts par segment et par sens — distance, temps, difficulté, popularité, dénivelé — et une praticabilité par activité (un escalier n'est pas un itinéraire à cheval). Un A\* à heuristique admissible produit un itinéraire par critère : le plus rapide, le plus court, le plus emprunté, le plus facile, le moins fréquenté, recommandé ; les doublons trop recouvrants sont écartés.

Les durées suivent la section 25 : au début le modèle théorique (distance, dénivelé, pente, terrain, `sac_scale`), puis un poids croissant aux passages réellement observés (50 % dès 5 passages, 91 % à 50). Le résultat indique toujours sur quoi il repose, et la confiance affichée tient compte du nombre d'observations **et** de leur dispersion. L'estimation personnelle (section 24) reste facultative.

## 27 à 29. Ce que les corps disent du terrain

- **Ralentissements** : vitesses regroupées par tranches de 25 m, comparées à la médiane du segment après normalisation par activité. Une suite de tranches sous la moitié de la vitesse habituelle devient une zone à examiner (passage technique, gué, éboulis). La vitesse n'est pas mesurée entre deux relevés consécutifs mais sur une **base de mesure** d'au moins 3 m, quitte à agréger plusieurs relevés : à 0,35 m/s avec un relevé toutes les 6 secondes, un pas ne vaut que 2 m — écarter ces couples-là, c'est écarter exactement les échantillons qu'on cherche et ne garder que le bruit.
- **Demi-tours** : même segment parcouru dans un sens puis dans l'autre au même endroit, anormalement souvent.
- **Intersections confuses** : engagement sur un segment, retour sur ses pas, départ par un autre. « 17 % des passages se trompent ici » est une information précieuse pour les usagers comme pour les gestionnaires.

## 34 à 36. Vie privée : ce que le système ne fait pas

| Règle | Mise en œuvre |
| --- | --- |
| Rien ne part sans un choix explicite | Contribution demandée à la fin de chaque activité ; préférence « toujours contribuer » désactivée par défaut |
| Aucune position personnelle publiée | Les sorties collectives sont des agrégats (`43 passages cette semaine`), jamais des traces individuelles |
| Pas d'identification par les statistiques | Une statistique n'est publiée qu'à partir de **3 utilisateurs distincts** ; en dessous, `redactStatistics` neutralise durées, dates et comptages |
| Pas de domicile déductible | 250 m écartés au départ et à l'arrivée de chaque trace contribuée, plus les **zones privées** déclarées par l'utilisateur ; une trace trop courte après masquage ne contribue pas du tout |
| Pas de suivi d'une personne | Les passages portent un pseudonyme HMAC-SHA256 dérivé d'un secret serveur, jamais l'identifiant du compte |
| Réversibilité | Retirer une contribution efface les passages correspondants ; supprimer une activité efface tout ; supprimer son compte détache les activités |
| Conservation limitée | Les traces brutes sont purgées après 90 jours (réglable) ; les statistiques agrégées, elles, restent |

## 37 à 38. Base de données

`activities` · `activity_points` (trace brute) · `activity_matched_points` (trace rattachée) · `segment_traversals` (passages) · `segment_statistics` (agrégats) · `network_candidates` (propositions) · `segment_versions` (historique des géométries) · `user_pace` · `privacy_zones`, en plus de `paths` (les segments) et `trails` (les itinéraires). Détail des colonnes dans [DATA_MODEL.md](DATA_MODEL.md).

L'implémentation actuelle est sur SQLite, sans index spatial : les requêtes filtrent sur les emprises (`min/max lat/lng`, indexées) et le travail géométrique se fait en mémoire, dans le graphe de `packages/core`. Le passage à PostgreSQL + PostGIS ne concernera qu'une seule fonction (`services/network-graph.ts`) et les requêtes d'emprise : tout le moteur travaille sur des types de domaine, jamais sur du SQL.

## 43 à 47. Honnêteté, tableau de bord, modération

Absence de données n'est jamais absence de chemin : sous le seuil d'observations, l'application affiche « Données communautaires insuffisantes », et la couverture du réseau est indiquée sur la carte de fréquentation.

Le tableau de bord professionnel donne passages, contributeurs, distance, pratiques, saisonnalité, heures de pointe, chemins les plus fréquentés et propositions en attente. Le back-office (`/admin/network`) présente chaque candidature avec ce sur quoi elle repose et la tranche en deux gestes. Une correction de tracé acceptée **archive l'ancienne géométrie** dans `segment_versions` (date, source, raison, confiance, auteur) avant de la remplacer et d'incrémenter la version du segment.

## Faire vivre la démonstration

```bash
pnpm --filter @mountain-live/api db:seed-activities          # simule des sorties et peuple le réseau vivant
pnpm --filter @mountain-live/api db:seed-activities -- --reset   # repart de zéro
```

Le générateur simule 36 contributeurs distincts sur les sentiers de démonstration (≈ 280 sorties, ≈ 520 passages), avec saisonnalité, heures de pointe, allures personnelles, pauses et bruit GPS, plus quatre anomalies volontaires : un tracé décalé de 9 m, un raccourci hors réseau, un passage où tout le monde ralentit, et un belvédère où une sortie sur deux fait demi-tour. Chacune produit la candidature correspondante — correction de tracé, chemin potentiel, zone de ralentissement, demi-tour.

Ces anomalies sont portées par des sentiers **courts, parcourus en entier** : un long itinéraire n'est simulé que sur une portion, dont l'abscisse relative change d'une sortie à l'autre — l'anomalie ne retomberait jamais deux fois au même endroit et le moteur aurait raison de ne rien conclure. Tout passe par la chaîne d'ingestion réelle : ce que montre la démonstration est ce que produira le terrain.

## Limites connues

- Le réseau n'a pas de modèle numérique de terrain : les dénivelés viennent des altitudes GPS ou des données importées. Les pentes des segments sans altitude valent zéro, et le disent.
- La détection des candidatures travaille sur une fenêtre glissante de 180 jours (au-delà, les traces brutes sont purgées) ; les candidatures déjà créées, elles, persistent avec leurs compteurs.
- Le routage porte sur le réseau connu : hors zone importée, aucun itinéraire n'est proposé plutôt qu'un itinéraire faux.
- Les statistiques d'un territoire peu fréquenté par l'application restent silencieuses tant que le seuil d'anonymat n'est pas atteint. C'est voulu.
