# Mountain Live — la couche d'information temps réel de la montagne

> « Waze indique ce qui se passe sur la route. Mountain Live indique ce qui se passe en montagne. »

Application **mobile-first et web**, collaborative, dédiée aux espaces naturels : une carte dynamique qui montre, quasiment en temps réel, les **dangers**, les **activités en cours** (chasse, battue, travaux, événements), les **animaux** (troupeaux, chiens de protection, faune), l'état des **chemins**, les **points d'eau et refuges** et la **fréquentation**. Les usagers signalent, confirment, contestent et déclarent résolu ; les collectivités, gestionnaires et partenaires publient des informations officielles.

Nom de projet temporaire (le nom définitif sera choisi ultérieurement). Territoire pilote : la **Corse**.

Les applications classiques répondent à « Où puis-je aller ? ». Mountain Live répond à **« Que se passe-t-il là-bas maintenant ? »** — voir [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md).

## Démarrage rapide

**Sur Mac, sans ligne de commande** : double-cliquez sur `Lancer Mountain Live.command` dans le Finder. Le Terminal s'ouvre, installe ce qu'il faut au premier lancement (Node.js 20+ doit être installé : [nodejs.org](https://nodejs.org/fr/download)), démarre l'application (HTTPS) et ouvre le navigateur : l'application, conçue pour smartphone, s'y affiche dans un cadre d'iPhone avec un QR code pour l'ouvrir sur votre vrai téléphone (même Wi-Fi ; voir [docs/MOBILE.md](docs/MOBILE.md)). `Reinitialiser les donnees.command` remet le jeu de données de démonstration à zéro ; `Importer les lieux-dits (GeoNames).command` et `Importer les sentiers (OpenStreetMap).command` enrichissent la base (lieux-dits, réseau de sentiers). Si macOS refuse d'ouvrir le fichier, clic droit → Ouvrir, ou dans le Terminal : `chmod +x *.command`.

Prérequis en ligne de commande : Node.js ≥ 20 et pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm --filter @mountain-live/api db:reset   # crée la base SQLite et charge le jeu de données corse
pnpm dev                                    # API sur http://localhost:8787, web sur http://localhost:5173
```

Ouvrez http://localhost:5173 (idéalement en mode « appareil mobile » des outils de développement, ou depuis un téléphone sur le même réseau grâce à `--host`).

### Comptes de démonstration (mot de passe `demo1234`)

| Compte | Rôle |
| --- | --- |
| `rando@mountain-live.demo` | utilisateur |
| `berger-asco@mountain-live.demo` | partenaire vérifié (berger) |
| `guide-bavella@mountain-live.demo` | partenaire vérifié (guide) |
| `mairie-corte@mountain-live.demo` | source officielle (commune) |
| `moderateur@mountain-live.demo` | modération (back-office) |
| `admin@mountain-live.demo` | administration (back-office + tableau de bord pro) |

Le jeu de données comprend une soixantaine de signalements visibles autour du GR20, de la Restonica, de Bavella, du Cinto…, 4 alertes officielles, 43 lieux, 8 sentiers, 32 points d'eau, des notifications et deux litiges ouverts.

## Référentiel des lieux (lieux-dits, sommets, cols, sources…)

La recherche (barre de la carte, page Explorer) combine trois sources :

1. le jeu de démonstration (44 lieux corses) ;
2. le **référentiel GeoNames** importé dans la base : lieux-dits, hameaux, communes, sommets, cols, refuges, lacs, sources, sentiers (licence CC BY 4.0). Import de la Corse en une commande, ou par double-clic sur `Importer les lieux-dits (GeoNames).command` :

   ```bash
   pnpm --filter @mountain-live/api geo:import                         # Corse (2A, 2B)
   pnpm --filter @mountain-live/api geo:import -- --departements 04,05  # autres départements
   pnpm --filter @mountain-live/api geo:import -- --all                 # toute la France (~400 000 lieux)
   pnpm --filter @mountain-live/api geo:import -- --file ~/FR.zip       # archive déjà téléchargée
   ```

3. le **géocodeur en ligne de l'IGN** (Géoplateforme, index « poi » et communes) en repli quand la base répond peu : tout lieu-dit de France devient trouvable dès qu'il y a du réseau, et les résultats sont mémorisés en base (identifiants `g_…`) pour les fiches et les recherches suivantes. Désactivable avec `GEOCODER_DISABLED=1`, service remplaçable avec `GEOCODER_URL`.


## Navigation GPS sur les sentiers

L'application s'ouvre sur **« Démarrer un itinéraire »**. Le module de navigation (« Waze de la montagne ») suit la position GPS, la **rattache au chemin le plus probable** (map matching sur le réseau de sentiers), guide pas à pas sur un itinéraire (sentier de la base, trace GPX importée ou trace enregistrée), détecte les sorties de parcours, enregistre un fil d'Ariane et annonce les **signalements situés devant vous** par paliers de distance. Écran `/navigate` (bouton « Navigation » sur la carte, entrée dans Explorer, « Démarrer » sur un sentier d'une fiche de secteur).

- Sur ordinateur, activez « Simuler ce parcours (démo) » à la préparation, ou ouvrez directement `http://localhost:5173/navigate?trail=t_restonica_melo&simulate=1&autostart=1`.
- **Vrais sentiers et itinéraires** : au lancement par `Lancer Mountain Live.command`, s'ils ne sont pas encore en base et que la connexion le permet, le réseau de chemins et les itinéraires balisés de Corse (GR 20, Mare a Mare, Mare e Monti, boucles locales…) sont importés d'OpenStreetMap en arrière-plan (licence ODbL, quelques minutes, journal `apps/api/data/osm/import.log`). À la main :

   ```bash
   pnpm --filter @mountain-live/api geo:import-osm                              # Corse (Overpass)
   pnpm --filter @mountain-live/api geo:import-osm -- --bbox 8.9,42.1,9.2,42.4  # une zone
   pnpm --filter @mountain-live/api geo:import-osm -- --file export.geojson     # fichier (Overpass Turbo, QGIS…)
   pnpm --filter @mountain-live/api geo:import-osm -- --routes-only            # itinéraires balisés seulement
   ```

   ou double-cliquez sur `Importer les sentiers (OpenStreetMap).command`.

Détails (algorithme, seuils, données, Bluetooth) : [docs/NAVIGATION_GPS.md](docs/NAVIGATION_GPS.md).

## Ne pas démarrer avec une carte vide

Avant que la communauté n'enregistre ses propres déplacements, l'application constitue une base de départ à partir de ce qui existe déjà : réseau vectoriel OpenStreetMap, données ouvertes, itinéraires de gestionnaires d'espaces naturels, traces GPX **dont la licence autorise la réutilisation**.

Le fichier GPX n'est pas l'objet : c'est une observation qui enrichit un **segment de chemin**. Une trace importée est analysée, notée, comparée aux autres sources, puis résolue en suite de segments — « cet itinéraire emprunte les chemins 112, 113, 245 ». Chaque segment sait alors qui l'atteste, avec quelle confiance, et pour quelles raisons.

Rien n'entre sans droits vérifiés : une source naît « à vérifier », ses droits sont dérivés de sa licence, le `robots.txt` des sites est respecté, et une licence inconnue envoie la trace en revue au lieu de l'intégrer. Détails et sources à connecter : [docs/SOURCES_GPX.md](docs/SOURCES_GPX.md).

```bash
pnpm --filter @mountain-live/api db:seed-sources   # territoires pilotes et pistes de sources à vérifier
```

## Le réseau vivant

Les activités enregistrées, lorsque leur auteur choisit de contribuer, apprennent à l'application **comment la montagne est réellement parcourue** : fréquentation de chaque chemin, temps réellement observés par activité et par sens, tracés à corriger, chemins absents des cartes, ralentissements, demi-tours, intersections où l'on se trompe. De là viennent la carte de fréquentation, la fiche d'un chemin, et les itinéraires proposés entre deux points (le plus rapide, le plus court, le plus emprunté, le plus facile).

Rien ne part sans un choix explicite, les traces sont pseudonymisées, les abords du départ et de l'arrivée sont écartés, et aucune statistique n'est publiée sous trois utilisateurs distincts. Détails : [docs/MOTEUR_CARTOGRAPHIQUE.md](docs/MOTEUR_CARTOGRAPHIQUE.md).

```bash
pnpm --filter @mountain-live/api db:seed-activities   # peuple la démonstration (36 contributeurs simulés, ≈ 280 sorties)
```

## Ce que fait le MVP

| Section du cahier des charges | Réalisé |
| --- | --- |
| Carte principale (3, 10) | 4 fonds (topographique, satellite, classique, relief avec ombrage), clusters, zoom intelligent, icônes par sous-type, estompage des signalements anciens, alertes officielles (points et zones), carte thermique de présence anonymisée, position, recherche de lieu, légende |
| Signalement en < 20 s (4, 32) | Bouton « + » central → catégorie → sous-type → détails (position GPS ajustable, photo, niveau, durée ou heure de fin, commentaire) → Publier ; raccourcis vers les signalements fréquents ; file d'attente hors connexion |
| Durée de vie et expiration (5) | Durées par sous-type (`packages/core/src/taxonomy.ts`), expiration automatique, icône qui s'estompe, archivage |
| Confirmation communautaire et confiance (6, 7) | Toujours présent / Situation améliorée / Plus présent / Contester ; score de confiance (récence, réputation, contradictions, source) ; badges Officiel / Partenaire vérifié / Communauté |
| Protection des usagers (8) | Aucune position individuelle : présence agrégée par cellule d'≈1 km, floutage des espèces sensibles, aucune fonction de localisation d'agents |
| Hors connexion (9) | Téléchargement d'une zone (tuiles + sentiers + points d'eau + refuges + signalements), synchronisation automatique, bannières « Mode hors connexion » / « Synchronisation effectuée » |
| Filtres (11) et alertes de proximité (12) | Filtres par catégorie et « informations officielles », préférences par pratique ; alertes « Attention : Battue à 600 m. », regroupement troupeau + chiens de protection |
| Fiche de signalement (14) | Distance, lieu, date, photos, description, niveau, confirmations, dernière confirmation, source ; Confirmer / Plus présent / Ajouter une photo / Commenter / Partager / Signaler un problème |
| Profil, réputation, badges (15, 16) | Niveau de fiabilité 1–5 (jamais de score négatif public), badges Éclaireur, Contributeur, Expert local, Sentinelle, Partenaire vérifié |
| Modération (17) | Signalement de contenu (6 motifs), back-office : statistiques, signalements, litiges, utilisateurs, alertes officielles |
| Tableau de bord professionnel (18) | Indicateurs, répartition, chronologie, zones à incidents (carte thermique), points d'eau secs, conflits d'usage, export CSV |
| Onboarding (21), Explorer (22), notifications (23), Autour de moi (24) | Réalisés |
| Sécurité et RGPD (27, 28) | Règles de sécurité affichées, politique de confidentialité, suppression de compte, rétention limitée |

Hors périmètre du MVP, conformément à la section 29 : réseau social, messagerie, marketplace, réservations. Les itinéraires (section 13) sont préparés dans l'architecture (sentiers en base, calcul de distance à un tracé dans `core`) mais pas exposés.

## Structure du dépôt

```
packages/core   Contrat partagé : types, taxonomie, schémas zod, contrat d'API, cycle de vie,
                confiance, géographie, réputation, chaînes FR — 104 tests
apps/api        API Hono + SQLite (drizzle-orm) : auth, signalements, confirmations, photos,
                lieux, présence agrégée, notifications, hors connexion, modération, pro — 41 tests
apps/web        PWA React 19 + MapLibre : écrans, design system, hors connexion, alertes — 82 tests
docs/           Cahier des charges, architecture, navigation, modèle de données, sécurité,
                design system, mobile, feuille de route
```

## Scripts

| Commande | Effet |
| --- | --- |
| `pnpm dev` | API + web en développement |
| `pnpm build` | typecheck + build de la PWA (`apps/web/dist`, service worker inclus) |
| `pnpm typecheck` / `pnpm test` | vérification TypeScript et tests de tous les paquets |
| `pnpm --filter @mountain-live/api db:reset` | recrée la base et le jeu de données |
| `pnpm --filter @mountain-live/web preview` | sert le build de production |

Variables d'environnement de l'API (voir `apps/api/.env.example`) : `PORT`, `JWT_SECRET` (obligatoire en production), `DATABASE_PATH`, `UPLOAD_DIR`, `CORS_ORIGINS`, `TRUST_PROXY`, `GEOCODER_URL`, `GEOCODER_DISABLED`.

## Documentation

- [Cahier des charges](docs/CAHIER_DES_CHARGES.md)
- [Architecture](docs/ARCHITECTURE.md) · [Navigation et parcours](docs/NAVIGATION.md) · [Modèle de données](docs/DATA_MODEL.md)
- [Collecte des traces existantes](docs/SOURCES_GPX.md) · [Sécurité et vie privée](docs/SECURITY_PRIVACY.md) · [Design system](docs/DESIGN_SYSTEM.md) · [Mobile et Capacitor](docs/MOBILE.md)
- [Feuille de route](docs/ROADMAP.md) · [Contribuer](CONTRIBUTING.md)
