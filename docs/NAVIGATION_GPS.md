# Navigation temps réel sur les sentiers (« Waze de la montagne »)

Module de suivi GPS et de guidage sur chemins, sentiers, pistes forestières et itinéraires de montagne. Le cœur technologique est **GPS/GNSS + cartographie des chemins + map matching + données collaboratives** ; le Bluetooth n'est qu'un complément prévu par l'architecture (voir plus bas).

## Où est le code

| Couche | Fichiers | Rôle |
| --- | --- | --- |
| Moteur (pur, testé, sans navigateur) | `packages/core/src/navigation/*` | graphe de chemins, map matching, itinéraire et sortie de parcours, instructions, événements et paliers d'alerte, trace, GPX, ETA, boucle `navigationStep` |
| Données | `apps/api/src/services/paths.ts`, `osm.ts`, `db/demo-network.ts`, `db/import-osm.ts` | table `paths`, découpage aux intersections, import OpenStreetMap, réseau de démonstration |
| Client | `apps/web/src/features/navigation/*`, `pages/NavigationPage.tsx` | sources de position, chargement du réseau par cellules, moteur temps réel, écran plein écran, couches carte, préparation, résumé |

Écran : `/navigate` (plein écran, sans barre de navigation). Entrées : bouton « Navigation » sur la carte, entrée « Navigation » dans Explorer, bouton « Démarrer » sur chaque sentier d'une fiche de secteur, préférences (activité, précision, voix) dans Profil → Préférences.

Paramètres d'URL : `?trail=<id>` (itinéraire présélectionné), `?mode=free`, `?simulate=1` (GPS simulé), `?autostart=1`, `?speed=<m/s>`, `?detour=1` (tests).

## 1. Principe (section 1)

À chaque relevé GPS, `navigationStep(état, contexte, relevé)` enchaîne :

1. **map matching** → position rattachée au chemin le plus probable, sens de parcours, confiance ;
2. **progression** sur l'itinéraire actif (fenêtre autour de la progression précédente : boucles et allers-retours sont gérés) ;
3. **sortie d'itinéraire** (seuil adaptatif, plusieurs relevés consécutifs, hystérésis) ;
4. **instruction courante** (manœuvres précalculées) ;
5. **alertes devant soi** (événements projetés sur l'itinéraire, paliers de distance) ;
6. **trace** (fil d'Ariane, statistiques).

Le réducteur est pur : il ne dépend ni du DOM ni de MapLibre, ce qui permet de le tester (`navigation.test.ts`, 34 tests) et de le réutiliser tel quel dans une application native.

## 2. Suivi de position (section 2)

`GeolocationSource` utilise `navigator.geolocation.watchPosition` (position, précision, altitude, cap et vitesse fournis par le récepteur GNSS). Trois profils (`TRACKING_PROFILES`) :

| Mode | Intervalle | Haute précision | Usage |
| --- | --- | --- | --- |
| Économie | 15 s | non | longues randonnées, autonomie |
| Normal | 5 s | oui | défaut |
| Précision élevée | chaque relevé (≈ 1 s) | oui | trail, VTT, passages techniques |

La boussole (`compass.ts`, `deviceorientationabsolute` ou `webkitCompassHeading` après autorisation iOS) oriente le marqueur à l'arrêt et départage les chemins quand le déplacement est trop faible pour déduire un cap. L'altitude GPS alimente la trace et l'affichage ; le baromètre n'est pas exposé par les navigateurs (prévu côté natif, voir MOBILE.md).

## 3. Map matching (section 3)

`matcher.ts` — filtre à hypothèses multiples (forme simplifiée d'un modèle de Markov caché). Pour chaque segment candidat dans un rayon `2,5 × précision` (25 à 80 m) :

| Terme | Calcul |
| --- | --- |
| distance | gaussienne, σ = max(8 m, 0,7 × précision) ; σ ≥ 25 m si signal faible |
| cap | écart entre le cap de déplacement lissé et l'axe du segment (parcourable dans les deux sens), pondéré ×2 (×1 si signal faible), ignoré à l'arrêt |
| continuité | même segment : la distance parcourue le long du chemin doit ressembler au déplacement observé ; segment connecté par un nœud : −0,4 ; saut sans connexion : −2,5 (< 40 m, chaînon manquant probable) ou −4 |
| activité | chemin impraticable pour l'activité (escalier en VTT, chemin fermé…) : −1,5, sans exclure |
| itinéraire | segment longeant l'itinéraire actif (≤ 25 m) : +0,8 |

Les scores sont cumulés avec un amortissement (mémoire ≈ 4 relevés) ; les 4 meilleures hypothèses survivent. Exemple de la section 3 (position à 8 m d'un sentier parallèle au déplacement) : rattachée avec une confiance > 0,6 (test « rattache une position décalée de 8 m »). Une position à plus de `30 + 0,5 × précision` m (max 60 m, +15 m si signal faible) de tout chemin n'est pas rattachée : le point brut est affiché.

## 4. Intersections (section 4)

- Les intersections sont des **nœuds partagés** du graphe (`graph.ts`) : l'import OSM et le réseau de démonstration découpent les lignes à chaque nœud partagé (`splitAtSharedNodes`).
- **Hystérésis** : on ne bascule sur un autre chemin que si son score dépasse celui du chemin en cours de plus de 0,6 ; sinon on reste (test « garde le sentier suivi quand l'utilisateur continue tout droit », « bascule sur l'embranchement quand l'utilisateur tourne » : basculement en ≤ 3 relevés après le virage).
- Avec un itinéraire actif, le bon chemin reçoit un bonus et les manœuvres sont annoncées avant l'intersection : « Tournez à gauche dans 80 m » puis « Prenez le sentier à gauche » ; « Continuez tout droit à l'intersection » quand l'itinéraire traverse un embranchement.

## 5. Suivi d'itinéraire (section 5)

`route.ts` : itinéraire depuis un sentier de la base (`routeFromTrail`), un GPX (`routeFromGpx`) ou une trace (`trackToRoute`, `backtrackRoute`). Progression : abscisse, distance parcourue / restante, fraction, dénivelés faits / restants (altitudes du GPX ou dénivelé déclaré du sentier), cap de l'itinéraire. Affichage : portion faite en gris, restante en bleu ; barre basse « Restant · Altitude · Vitesse · Arrivée » (ETA : vitesse observée en mouvement mélangée à la vitesse type de l'activité, majoration Naismith par le dénivelé restant — `eta.ts`).

## 6. Navigation pas à pas (section 6)

`instructions.ts` : manœuvres aux changements de cap (mesurés sur 15 m avant / après chaque sommet) et aux intersections du graphe (rayon 12 m) ; fusion des manœuvres à moins de 20 m. Formulations (`fr.navigation.instructions`) : « Continuez sur ce sentier pendant 600 m », « Tournez à droite dans 80 m », « Prenez le sentier à droite », « Le sentier tourne à gauche », « Faites demi-tour », « Arrivée dans 150 m », « Vous êtes arrivé. ». Les événements sont annoncés par `events.ts` : « Traversée de rivière dans 150 m » (segment `ford`), « Forte pente dans 300 m » (pente ≥ 25 % sur 100 m quand les altitudes sont connues), « Chemin fermé », « Attention : Battue dans 800 m », « Source dans 300 m ». Guidage vocal (`speech.ts`, synthèse vocale fr-FR) désactivable.

## 7. Sortie de sentier (section 7)

Seuil `offRouteThresholdM` : 30 m + 0,5 × (précision − 10 m) (max +20) + largeur du chemin / 2 + 10 m si ≥ 4 chemins à moins de 100 m + 15 m si signal faible, borné à 30–90 m. Alerte seulement après **3 relevés consécutifs** au-delà du seuil **pendant au moins 12 s** ; retour acquis après 2 relevés sous 70 % du seuil. L'application propose « Revenir au parcours » (ligne rouge vers le point le plus proche, « Rejoignez le parcours : 120 m vers le sud ») ou « Continuer en mode libre ». Retour : « Vous êtes sur le bon itinéraire. »

## 8 et 9. Mode libre et fil d'Ariane (sections 8, 9)

Sans itinéraire, la carte suit la position, identifie le chemin (« Sur : Sentier de Grotelle »), enregistre la trace (ligne orange en pointillé derrière le marqueur), calcule distance / durée / altitude / dénivelés, et affiche les signalements dans le cône de déplacement. « Revenir sur mes pas » construit un itinéraire à partir de la trace inversée (simplifiée à 3 m) et bascule en guidage.

## 10. Hors connexion (section 10)

Le GPS ne dépend pas du réseau. Le réseau de chemins est chargé par **cellules de 0,05°** (~5 km) autour de la position et le long de l'itinéraire (`network.ts`), mises en cache dans IndexedDB (`pathCells`, 7 jours) ; les zones téléchargées (Profil → Hors connexion) embarquent désormais `paths` dans le bundle. Les événements viennent de l'API quand le réseau est là, sinon du cache des signalements et des zones. La trace en cours est sauvegardée toutes les 20 positions (`tracks/__current__`) ; les traces enregistrées restent sur l'appareil (jamais envoyées au serveur). Le moteur tourne dans `NavigationEngineHost` (monté dans `App`) : quitter l'écran pour signaler n'interrompt pas le suivi.

## 11 à 13. Événements devant soi et paliers (sections 11, 12, 13)

- **Itinéraire** : signalements projetés sur le tracé dans un couloir de 40 m (450 m pour une position floutée, marquée « position approximative »), alertes officielles (entrée du tracé dans le polygone), points d'eau (60 m), gués et fermetures (30 m), fortes pentes. Un événement **derrière** (abscisse < position − 20 m) n'est jamais annoncé.
- **Mode libre** : cône de ±60° autour du cap dans un rayon de 1 km ; à moins de 50 m, tout est « devant » ; sans cap, seule la proximité (150 m) compte.
- **Paliers** (`ESCALATION`) : gravité forte 1000 / 500 / 200 / 50 m (info discrète, alerte, alerte renforcée, immédiate) ; moyenne 500 / 200 / 50 ; faible 300 (discret, jamais sonore). Battue, chasse et alerte officielle grave : 1500 / 800 / 300 / 100. Chaque palier n'est annoncé qu'une fois par événement (vibration et voix à partir du deuxième).

## 14. Bluetooth (section 14)

Le suivi principal reste GPS/GNSS. `sources.ts` définit l'interface `PositionSource` ; `ExternalPositionSource.push(fix)` permet à un pont Web Bluetooth (montre GPS, récepteur GNSS externe, balise de secours) d'injecter des relevés sans toucher au moteur. Les balises BLE de proximité (refuge, intersection difficile, point de secours) pourront produire des événements `RouteEvent` (« Refuge à 200 m ») — non implémentées dans le prototype.

## 15. Données cartographiques (section 15)

Table `paths` (`apps/api/src/db/schema.ts`) : géométrie, `kind` (path, track, footway, bridleway, cycleway, steps, road, via_ferrata), `name`, `surface`, `sac_scale`, `width_m`, `foot` / `bicycle` / `horse`, `ford`, `status` (fermeture temporaire), `elevations`, `source` (osm, ign, seed, gpx, local). Sources compatibles :

- **OpenStreetMap** : `pnpm --filter @mountain-live/api geo:import-osm` (Overpass, Corse par dalles de 0,25°, cache `apps/api/data/osm/`), `-- --bbox`, `-- --file export.geojson|overpass.json`, ou double-clic sur `Importer les sentiers (OpenStreetMap).command`.
- **Traces GPX** : import à la préparation (référence de navigation), export en fin d'activité.
- **IGN / bases locales / partenaires** : même table, `source` dédié ; l'API `GET /paths?bbox` et le bundle hors connexion ne changent pas.

Sans import, le jeu de démonstration installe un réseau densifié (sentiers de Corse + embranchements à Restonica, Vizzavona, Bavella, Vergio, Corte) suffisant pour essayer la navigation.

## 16 et 17. GPX (sections 16, 17)

`gpx.ts` (sans dépendance DOM) : analyse tolérante de `trk` / `rte` / `wpt` avec `ele` et `time`, export GPX 1.1 avec altitude et horodatage. Fin d'activité : distance, temps, D+, D−, altitude maximale, vitesse moyenne, enregistrement local (« Mes traces », réutilisables comme itinéraire) et « Exporter en GPX » (partage natif sur mobile, téléchargement sinon).

## 18. Activité (section 18)

`ActivityMode` (randonnée, trail, VTT, équitation) : praticabilité des chemins dans le map matching (`isSegmentAllowed`), vitesse type et majoration de dénivelé pour l'ETA, nom des traces.

## 19 à 22. Interface, marqueur, précision, reprise (sections 19 à 22)

- Écran réduit à l'essentiel : carte, instruction, prochain événement, chips « Précision ±8 m » / « Sur : … », barre de statistiques, boutons Recentrer, Signaler (« + »), Revenir sur mes pas, Pause, Terminer.
- Marqueur : flèche tournée selon le cap (point sans cap), halo, cercle d'incertitude au-delà de 12 m ; position **interpolée sur 600 ms** entre deux relevés (pas de saut).
- Qualité : bonne ≤ 15 m, moyenne ≤ 35 m, faible au-delà, perdue après 30 s sans relevé (« Signal GPS faible / perdu », marqueur estompé, estimation à l'estime le long du chemin à la vitesse observée — `deadReckon`).

## 24. Scénario de démonstration

`/navigate?trail=t_restonica_melo&simulate=1&autostart=1` rejoue la Restonica avec un GPS simulé (bruit ± 6 m) : instruction, « Sur : Restonica », prochain événement (source signalée sèche), alertes par palier, arrivée, résumé. `&detour=1` provoque une sortie de parcours de 80 m entre 400 et 900 m. Le parcours de bout en bout (Chromium) vérifie préparation, suivi, arrivée, résumé, sortie / retour d'itinéraire, mode libre avec la géolocalisation du navigateur et les points d'entrée.

## Limites du prototype

- Les altitudes des sentiers de la base ne sont pas connues (pas de MNT) : « Forte pente » et dénivelés restants exacts n'existent que pour les GPX avec altitudes ; l'altitude affichée est celle du GPS.
- Les chemins OSM sans `name` sont décrits par leur nature (« Sur un sentier »).
- Pas d'itinéraire calculé départ → arrivée sur le graphe (routage) : on suit un sentier existant, un GPX ou sa propre trace.
- Le suivi en arrière-plan sur mobile dépend du navigateur (écran allumé recommandé) ; l'application native (Capacitor) lèvera cette limite.
