# Collecte des traces et des données de sentiers existantes

> L'application ne doit pas démarrer avec une carte vide. Avant que la communauté n'enregistre ses propres déplacements, le système constitue une base initiale à partir de ce qui existe déjà — **légalement**.

Le fichier GPX n'est pas l'objet central. L'objet central est **le segment de chemin**. Chaque trace, chaque itinéraire et chaque déplacement enrichit ce qu'on sait d'un segment, jusqu'à obtenir non pas une collection de GPX, mais une base de connaissance du réseau de chemins de montagne.

## La chaîne, dans l'ordre

```
 RECHERCHER
   └─► VÉRIFIER LA SOURCE
         └─► VÉRIFIER LES DROITS D'UTILISATION      ◄── seule étape qui peut tout arrêter
               └─► TÉLÉCHARGER ou INTERROGER UNE API (si autorisé)
                     └─► ANALYSER LE GPX
                           └─► CONTRÔLER SA QUALITÉ
                                 └─► COMPARER AUX AUTRES SOURCES
                                       └─► RATTACHER LA GÉOMÉTRIE AU RÉSEAU
                                             └─► CONSERVER PROVENANCE ET LICENCE
```

## État de cet environnement de développement

**L'accès réseau sortant est fermé par la politique de l'environnement.** Toute tentative vers `data.gouv.fr`, `overpass-api.de`, `openstreetmap.org` ou une instance Geotrek reçoit un `403` du mandataire, au niveau du `CONNECT`. La phase de découverte réelle demandée par la **section 27** n'a donc pas pu être exécutée.

Conformément à la **section 28**, ce qui a été livré est l'infrastructure complète — et **aucune trace GPX n'a été inventée**, aucune licence n'a été déclarée vérifiée.

| Section 28 demande | État |
| --- | --- |
| GPX importer | `apps/api/src/services/gpx-library.ts` + routes d'import fichier et URL |
| GPX parser | `packages/core/src/sources/ingest.ts` (GPX 1.0/1.1, KML, GeoJSON) |
| source registry | table `data_sources` + `apps/api/src/services/sources.ts` |
| license checker | `packages/core/src/sources/licence.ts` |
| validation pipeline | normalisation, `trace-quality.ts`, seuils de rejet |
| map matching | `knowledge.ts` → `resolveItinerary` (l'itinéraire devient une suite de segments) |
| gestion des doublons | empreinte géométrique `traceHash` + `compare.ts` |
| stockage | SQLite aujourd'hui, avec l'emprise indexée ; voir « Vers PostGIS » plus bas |

## Où est le code

| Couche | Emplacement | Rôle |
| --- | --- | --- |
| Contrat | `packages/core/src/sources/types.ts` | tous les types de la collecte ; les modules s'y conforment |
| Licences | `sources/licence.ts` | table des licences, détection, décision de réutilisation, attribution |
| Découverte | `sources/discovery.ts` | requêtes par territoire, classification, **robots.txt**, plan d'ouverture |
| Ingestion | `sources/ingest.ts` | GPX / KML / GeoJSON → forme normalisée, sans perte |
| Qualité | `sources/trace-quality.ts` | `GPX_QUALITY_SCORE`, détection des tracés dessinés à la main |
| Comparaison | `sources/compare.ts` | superposition, corridors, doublons, variantes |
| Connaissance | `sources/knowledge.ts` | itinéraire → segments, confiance, meilleure géométrie, propositions |
| Registre | `apps/api/src/services/sources.ts` | sources, droits dérivés de la licence, vérification humaine |
| Bibliothèque | `apps/api/src/services/gpx-library.ts` | pipeline d'import, versions, attestations |
| Campagnes | `apps/api/src/services/source-discovery.ts` | robots.txt, récupération, territoires |
| Fiche segment | `apps/api/src/services/segment-knowledge.ts` | provenance, confiance, usage |

## 1 à 3. Rechercher sans jamais scraper illégalement

`buildDiscoveryQueries` construit le produit cartésien des dix termes du cahier des charges (« randonnée GPX », « sentier GPX », « trail GPX », « VTT GPX », « randonnée équestre GPX »…) et des désignations du territoire : nom, alias, massif, vallée, sommet, refuge, commune, et chaîne de rattachement. Les requêtes les plus spécifiques passent avant les plus larges, et le module fonctionne pour n'importe quel territoire — la Corse n'est qu'un point de départ.

**Le système n'interroge aucun moteur de recherche généraliste** : leurs conditions d'utilisation l'interdisent généralement. Les requêtes sont produites et affichées ; les URL candidates sont fournies par un catalogue open data, un partenaire, ou un administrateur. L'ordre de préférence de la section 3 est celui du registre : API officielle, open data, export autorisé, flux partenaire, licence explicite, accord direct.

Avant toute récupération, `robotsGate` lit le `robots.txt` de l'hôte et l'applique réellement (groupes `User-agent`, `Allow`/`Disallow`, jokers `*` et `$`, règle la plus spécifique). Un chemin interdit n'est pas téléchargé. Un `robots.txt` injoignable ne vaut pas autorisation : la ressource part en revue.

## 4 à 5. Registre des sources et statuts

Table `data_sources` : identifiant, nom, URL, type, pays, territoire, licence, réutilisation commerciale, redistribution, attribution, API, dernière vérification, fiabilité, notes. Chaque géométrie importée y renvoie : on peut toujours répondre à « d'où vient ce chemin ? ».

Trois statuts, et un seul chemin pour en changer :

- `review_required` — **état initial de toute source**, sans exception ;
- `approved` — une personne a ouvert les conditions, constaté la licence, et sa vérification est enregistrée (date **et** auteur) ;
- `forbidden` — réutilisation explicitement incompatible.

Deux verrous que rien ne contourne :

1. Les colonnes de droits (`commercial_reuse_allowed`, `redistribution_allowed`, `attribution_required`) sont **dérivées de la licence**, jamais saisies : personne ne peut déclarer qu'une licence non commerciale autorise un usage commercial.
2. `canAutoImport` exige un statut approuvé **et** une vérification humaine datée, **et** que cette vérification ne soit pas trop ancienne — les conditions d'utilisation changent. Une source jamais vérifiée voit sa fiabilité plafonnée à `UNVERIFIED_RELIABILITY_CAP`.

## 6. Un itinéraire n'est pas un chemin

Un GPX de randonnée est un **itinéraire** : il emprunte un chemin, puis un autre, puis une route, puis un sentier. `resolveItinerary` le résout en suite de segments :

```
GPX « Randonnée des Pozzi » (12 km)
  → segment 112 (1,4 km, sens direct)
  → segment 113 (0,8 km)
  → segment 245 (3,1 km, sens inverse)
  → segment 983, segment 984
  + 420 m sans chemin connu  ◄── matière première d'un chemin potentiel
```

L'itinéraire est stocké comme une **combinaison de segments** (`trace_segments`), et plusieurs itinéraires peuvent emprunter le même chemin. C'est ainsi que le système comprend la structure du territoire plutôt que d'empiler des fichiers.

## 7 à 8. Importer sans rien perdre, puis normaliser

Le fichier d'origine est conservé tel quel (`imported_trace_files`) : on doit pouvoir rejouer l'analyse et prouver la provenance. L'analyse extrait tout ce que le fichier portait — traces, segments de trace, routes, waypoints, latitude, longitude, altitude, horodatage, nom, description, métadonnées, et la mention de **copyright**, précieux indice de licence.

```
SOURCE GPX/KML/GeoJSON → PARSER → VALIDATION → CLEANING
  → COORDINATE NORMALIZATION → GEOMETRY → MAP MATCHING → TRAIL GRAPH
```

Deux règles de normalisation méritent d'être dites : les **coupures sont préservées** (une trace interrompue n'est jamais recollée par une ligne droite inventée), et **aucune valeur n'est fabriquée** — pas d'altitude si le fichier n'en avait pas, pas d'horodatage non plus.

## 9. Contrôler la qualité

`GPX_QUALITY_SCORE` (0–100) et cinq niveaux : excellente, bonne, moyenne, faible, inutilisable. Analysés : nombre de points, espacement et sa régularité, altitude, horodatage, continuité, sauts, doublons, géométrie aberrante, date, et la cohérence avec le réseau et les autres traces.

Une détection mérite une mention : un **tracé dessiné à la main** sur une carte est une trace *propre* — espacement régulier, aucun bruit — qui n'est pas une observation du terrain. Elle est signalée, pas récompensée.

## 10 à 12. Comparer, fusionner, pondérer

Plusieurs GPX du même parcours ne se départagent pas arbitrairement : on les superpose. `compareTraces` mesure recouvrement, écart médian, écart maximal, sens de parcours et variantes ; `clusterTraces` regroupe ce qui décrit le même passage ; `buildCorridor` en tire une ligne centrale.

**Ce qui fait la confiance, ce sont les sources distinctes** — pas le nombre de fichiers. Dix traces rediffusées par la même plateforme restent une source. C'est pourquoi `uniqueSources` compte les `sourceId` distincts et qu'un faisceau d'une seule source ne franchit jamais `CORRIDOR_MIN_SOURCES`.

La fusion multi-source ne remplace jamais aveuglément une donnée par une autre : les couches coexistent (`OFFICIAL_GEOMETRY`, `OSM_GEOMETRY`, `IMPORTED_GPX_GEOMETRY`, `COMMUNITY_GEOMETRY`, `OBSERVED_GEOMETRY`) et `segmentConfidence` produit un score explicable :

```
Segment 112
  présent dans OpenStreetMap ................. +
  présent dans un GPX officiel ............... +
  présent dans trois GPX indépendants ........ +
  parcouru par 73 utilisateurs ............... + fortement
  dernière observation : hier ................ + fraîcheur
```

Le score ne peut **pas** atteindre son maximum sur la seule foi de sources externes : seul l'usage réel y mène (section 25). Le détail (`reasons`) accompagne toujours le chiffre — un score de confiance qu'on ne peut pas expliquer ne sert à rien.

## 13 à 14. Ce que la comparaison révèle

- **Chemin probablement existant mais absent de la carte** : plusieurs traces indépendantes suivent la même géométrie, aucun chemin ne figure dans la base. `potentialExistingTrails` le propose à la modération avec son score et ses raisons.
- **Erreur cartographique probable** : la géométrie de référence s'écarte **systématiquement** du corridor observé. L'écart retenu est *signé* — un faisceau qui déborde autant à gauche qu'à droite est du bruit, pas un décalage.

Dans les deux cas : une **proposition**, jamais une modification automatique. Et jamais de modification d'une source externe : notre couche interne est corrigée après validation, et un contributeur autorisé peut, lorsque c'est approprié, proposer la correction à la base d'origine.

## 15 à 18. Back-office

- **Bibliothèque GPX** (`/admin` → Traces) : filtres territoire, activité, source, licence, qualité, date, validation ; pour chaque trace nom, source, licence, activité, distance, dénivelé, date, qualité, statut, affichage sur carte ; actions valider, rejeter, comparer, fusionner, voir la source.
- **Recherche par territoire** : France → Corse → Bastelica, puis « Rechercher des données de sentiers disponibles ». Le plan des huit étapes et les requêtes sont affichés **avant** exécution, et le bilan ne compte que ce qui a réellement été constaté.
- **Import manuel** : `.gpx`, `.kml`, `.geojson`. L'analyse affiche distance, D+, D−, nombre de points, zone géographique, chemins correspondants et qualité estimée, puis demande la **provenance** et si le déposant **dispose des droits**. Cette déclaration est enregistrée avec la trace ; elle engage son auteur, elle ne vaut pas vérification : le dépôt part en revue.
- **Import par URL** : `robots.txt` d'abord, droits ensuite, analyse enfin.

## 19 à 20. Partenaires et versions

Le registre prévoit `api_available` / `api_url` pour qu'une collectivité puisse un jour fournir automatiquement ses itinéraires, leurs géométries et leurs mises à jour. Quand un itinéraire change à la source, `addTraceVersion` archive l'ancienne géométrie et mesure l'écart : « Modification de 320 mètres du tracé ». Rien n'est perdu, et la trace repasse en revue — le terrain a peut-être changé.

## 22. Ce que voit l'utilisateur

Les mentions d'attribution exigées par les licences sont portées par la source, agrégées par segment, et servies avec la fiche de provenance (`GET /network/segments/:id/sources`). Une géométrie n'est jamais affichée sans que sa provenance puisse l'être.

## 24. Un GPX est une observation, pas la vérité

Une trace trouvée sur Internet peut être ancienne, mal enregistrée, créée manuellement, approximative, incomplète, issue d'un détour, passer sur une zone désormais interdite, traverser une propriété privée, ou suivre un chemin disparu. Elle **augmente une confiance** ; elle ne décrète rien. C'est pour cela qu'aucune importation ne modifie la carte, et que tout passe par une proposition.

## 25. La carte qui s'améliore

```
JOUR 1        sources officielles + OpenStreetMap + GPX autorisés
1 000 users   + les passages réels commencent à peser
100 000 users la connaissance vient majoritairement du terrain
```

La hiérarchie ne s'inverse pas d'un coup : le poids de l'usage observé croît, et la géométrie communautaire finit par l'emporter sur la géométrie importée lorsqu'elle est solide (`bestGeometry`).

---

# SOURCES À CONNECTER (section 27)

Ce tableau est un **plan de vérification**, pas un constat : l'accès réseau étant fermé, aucune de ces lignes n'a pu être ouverte depuis cet environnement. La colonne « Licence » indique ce que la documentation publique de la plateforme laisse *attendre* ; en base, chaque source est enregistrée avec la licence `unknown` et le statut `review_required` jusqu'à vérification humaine.

| Source | Type | Territoire | Format | API | Licence attendue | Réutilisation | Action recommandée |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OpenStreetMap — réseau de chemins | `osm` | mondial | vectoriel | Overpass | ODbL | à confirmer | **Base principale de géométrie.** Vérifier l'effet du partage à l'identique sur nos dérivés ; héberger notre instance Overpass ou respecter la politique d'usage de l'instance publique. |
| OpenStreetMap — relations d'itinéraires | `osm` | mondial | vectoriel | Overpass | ODbL | à confirmer | Donne les itinéraires balisés (GR, PR). Complète le réseau, ne le remplace pas. |
| data.gouv.fr | `open_data` | France | GPX, GeoJSON, SHP | oui | **variable par jeu** | à vérifier jeu par jeu | Recenser les jeux « sentiers », « PDIPR », « itinéraires de randonnée ». La licence est portée par le jeu de données, jamais par la plateforme. |
| Instances Geotrek | `geotrek` | par gestionnaire | GPX, GeoJSON | API v2 | variable | à vérifier par instance | Geotrek est un logiciel, pas une source : **une instance = une ligne de registre**. Relever l'URL d'API et les conditions de chaque parc, département ou office de tourisme. |
| IGN — géoservices | `institutional` | France | flux, vectoriel | oui | variable | à vérifier par flux | Vérifier les conditions du flux visé pour un usage commercial. |
| Parcs nationaux et PNR | `institutional` | par parc | GPX, GeoJSON | rare | variable | à vérifier par parc | Un **accord direct** est souvent plus simple et plus fiable qu'une collecte automatique. |
| Collectivité de Corse | `institutional` | Corse | à déterminer | à déterminer | variable | à vérifier | Point de départ de l'expérimentation : identifier le portail open data et les jeux « sentiers ». |
| Plateformes de randonnée / trail / VTT / équestre | `platform` | variable | GPX | parfois | **le plus souvent restrictive** | à vérifier une par une | Un bouton « Télécharger GPX » ne vaut pas autorisation. Sans licence claire : `FORBIDDEN_SOURCE`. Privilégier un accord. |
| Clubs, fédérations, associations | `club` | variable | GPX | non | variable | à vérifier | Contact direct. Souvent volontaires pour contribuer si l'attribution est respectée. |

Pour amorcer ce registre en base :

```bash
pnpm --filter @mountain-live/api db:seed-sources
```

La commande crée les territoires pilotes (France → Corse → Bastelica, Corte, GR 20) et les pistes ci-dessus, **toutes en `review_required`, licence `unknown`, jamais vérifiées**. Aucune trace n'est fabriquée.

## Ce qu'il reste à brancher

1. **Un environnement avec accès sortant** — sans lui, la section 27 reste théorique.
2. **Overpass** : réutiliser `overpassQuery` et `overpassRoutesQuery`, déjà écrits et testés (`apps/api/src/services/osm.ts`), pour importer le réseau du territoire — c'est l'étape 1 de l'assistant.
3. **Un catalogue de départ** : la campagne examine des URL candidates ; elles viennent d'un catalogue open data ou d'un administrateur, pas d'un moteur de recherche.
4. **Une décision produit sur le partage à l'identique** : ODbL et CC-BY-SA sont exploitables mais contaminent nos dérivés. Le code les classe en `review_required` plutôt que de trancher à la place de l'équipe (`allowShareAlike` force le passage quand la décision est prise).
5. **Vers PostGIS** : le rattachement au réseau charge aujourd'hui les segments d'une emprise via `segmentsInBBox` (`network-graph.ts`). C'est la seule fonction à remplacer pour passer à une recherche spatiale native ; tout le reste travaille sur des géométries en mémoire.

## Expérimentation corse (section 29)

Secteurs de test : **Bastelica**, **Val d'Ese**, **Monte Renoso**, **Pozzi**, **Corte**, **Restonica**, et le **GR 20**. L'objectif n'est pas d'importer toute la France : c'est de démontrer qu'à partir de données existantes et de traces GPX autorisées, on reconstruit un réseau exploitable **avant** d'avoir une grande communauté.

## Limites connues

- La découverte ne parcourt pas le web : elle prépare des requêtes et examine des URL qu'on lui donne. C'est un choix, pas un manque (section 3).
- Le `robots.txt` est relu à chaque campagne, sans cache : correct, mais bavard sur une grande campagne. À mettre en cache court quand le volume le justifiera.
- La comparaison de traces travaille sur des géométries en mémoire ; au-delà de quelques milliers de traces par territoire, il faudra un index spatial (PostGIS).
- Aucune trace n'est publiée telle quelle : nous stockons le fichier d'origine pour la preuve, nous ne le rediffusons pas.
