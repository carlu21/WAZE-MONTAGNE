# Du terrain à l'écran : la chaîne de données réelles

Mountain Live ne doit plus fonctionner principalement avec des données de
démonstration. Ce document décrit la chaîne qui va d'OpenStreetMap jusqu'au
bouton « Démarrer », et les endroits où elle refuse d'avancer.

```
OPENSTREETMAP                     (Overpass, hors ligne de commande)
      ↓  geo:import-osm
PATHS            segments découpés aux intersections, source_feature_id conservé
      ↓
TRAIL_SEGMENTS   quels segments composent quelle randonnée (N ↔ N)
      ↓
NOTRE BASE       SQLite locale — l'application ne parle JAMAIS à Overpass
      ↓
MOUNTAIN LIVE    affichage, routage, map matching, statistiques
```

L'import est une opération d'administration. Le démarrage de l'application n'en
dépend pas : elle lit sa propre base, ce qui la rend rapide, prévisible et
utilisable hors connexion.

## 1. La provenance est une donnée, pas une déduction

`trails.source` et `paths.source` sont **écrits à l'import** et mis à jour à
chaque réimport. Auparavant, une randonnée OpenStreetMap était reconnue à ce que
son identifiant commençait par `osm_rel_` — une déduction qui se cassait dès
qu'une convention de nommage changeait, et qui faisait passer de vraies données
pour des inconnues.

| Valeur | Sens | Relevé ? |
| --- | --- | --- |
| `osm` | Relation ou way OpenStreetMap | oui |
| `ign` | Donnée IGN | oui |
| `gpx` | Trace GPX importée | oui |
| `official` | Collectivité, parc, office de tourisme | oui |
| `partner` | Guide, berger, accompagnateur | oui |
| `seed` | Jeu de démonstration | **non** |
| `local` | Brouillon, saisie de travail | **non** |

`isSurveyed()` sépare les deux dernières des autres. Un itinéraire non relevé
n'est jamais dessiné comme un chemin réel.

## 2. Un way OSM donne plusieurs segments

Le réseau découpe chaque way à ses intersections : le way `891234` devient
`osm_891234_0`, `_1`, `_2`. Tous portent le même `source_feature_id` —
`way/891234`. C'est par cette colonne, et **uniquement** par elle, qu'une
relation retrouve ses segments : `segmentRowsByFeatureIds()` est le seul endroit
du code qui fasse cette correspondance.

## 3. Un segment appartient à plusieurs randonnées

`paths.trail_id` ne pouvait en retenir qu'une et écrasait les autres en silence.
Or le même sentier peut être emprunté par le GR20, une boucle locale, un
itinéraire équestre et un parcours VTT.

```sql
trail_segments (
  trail_id, segment_id, sequence, direction, role, source
)
UNIQUE (trail_id, segment_id, sequence)
```

`sequence` reconstruit l'ordre de parcours ; `direction` dit dans quel sens le
tronçon est emprunté — le même sentier se parcourt à l'endroit dans un sens de GR
et à l'envers dans l'autre. `paths.trail_id` subsiste pour les données
antérieures, mais n'est plus l'architecture.

L'ordre n'est pas celui des membres de la relation OSM, qui n'est pas garanti :
chaque segment est placé par la projection de son milieu sur le tracé assemblé.

## 4. Affichage et navigation ne lisent pas la même géométrie

| Usage | Géométrie |
| --- | --- |
| Aperçu, vignette | `trails.geometry` — le tracé assemblé par la source |
| **Navigation, routage, map matching, statistiques** | **les segments de `trail_segments`** |

`trailGeometry()` reconstruit la géométrie depuis les segments dès qu'ils
existent (`geometryFrom: "segments"`) et le dit dans sa réponse. Les ruptures ne
sont jamais comblées : deux segments séparés par un vrai trou restent séparés,
et c'est le plus long morceau continu qui est servi.

Sur le jeu de démonstration, la Restonica passe ainsi de **7 sommets** stockés à
**112** issus du réseau.

## 5. Ce qui manque est compté

| Champ | Sens |
| --- | --- |
| `member_way_count` | Membres attendus dans la relation |
| `resolved_way_count` | Membres effectivement retrouvés dans `paths` |
| `link_coverage` | Le rapport des deux, 0..1 |
| `geometry_confidence` | Couverture amputée de 10 % par tronçon non raccordé |

« 120 membres sur 127 » et « 127 sur 127 » ne sont pas la même donnée. L'import
affiche la couverture de chaque itinéraire incomplet, et la moyenne à la fin.

## 6. Affichable ≠ navigable

`trailUsability()` répond à deux questions distinctes :

- **drawable** — la géométrie est relevée et assez fine pour décrire un chemin.
- **navigable** — en plus, elle est rattachée au réseau à au moins
  `NAVIGABLE_MIN_COVERAGE` (80 %).

Entre les deux, le tracé est affiché avec sa réserve — « Tracé partiellement
vérifié » — et « Démarrer » reste fermé. Le seuil n'est pas 100 % : quelques
membres manquants au bord d'une emprise d'import ne rendent pas un GR
impraticable, et exiger la perfection reviendrait à ne jamais rien proposer.

La liste « Randonnées autour de vous » classe les données par confiance avant
d'appliquer le tri demandé : une randonnée de démonstration n'est jamais « la
plus proche » devant une vraie.

## 7. Commandes

```bash
# Où en est la base ? (ne modifie rien, sort en code 1 si pas de réseau réel)
pnpm --filter @mountain-live/api network:doctor

# Import d'une petite zone de test
pnpm --filter @mountain-live/api geo:import-osm -- --preset bastelica
# presets : bastelica · corte · restonica · bavella · vizzavona · porto-vecchio

# Emprise explicite
pnpm --filter @mountain-live/api geo:import-osm -- --bbox 9.02,41.93,9.18,42.06

# Corse entière (long : ~70 dalles)
pnpm --filter @mountain-live/api geo:import-osm

# Ré-associer les randonnées au réseau sans rien retélécharger
pnpm --filter @mountain-live/api geo:relink
```

L'import est **reprenable** : chaque dalle téléchargée est mise en cache dans
`apps/api/data/osm/`, et relancer la commande repart de là où elle s'était
arrêtée. Trois instances Overpass sont essayées dans l'ordre, jamais en
parallèle — ce sont des services bénévoles.

## 8. Attribution

Données © les contributeurs OpenStreetMap, licence ODbL
(https://www.openstreetmap.org/copyright). La provenance est conservée segment
par segment ; l'import l'affiche, et le back-office la rappelle.
