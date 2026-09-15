/**
 * « Randonnées autour de vous » : l'assemblage serveur de l'écran d'accueil.
 *
 * L'utilisateur ouvre l'application, se voit sur la carte, et trouve sous la
 * barre « Où va-t-on ? » les randonnées les plus proches de lui. Ce service
 * fabrique cette liste : il interroge la base, le module pur
 * `@mountain-live/core` (`packages/core/src/nearby/nearby.ts`) décide de la
 * forme des tracés, du rayon, de l'ordre et des phrases. Aucune règle de
 * produit n'est réécrite ici.
 *
 * Sections du cahier des charges couvertes :
 *
 *  - **13. Classer la liste.** Le tri est délégué à `rankNearby` : les cinq
 *    critères et leur départage n'existent qu'en un seul exemplaire.
 *  - **18. Rayon adaptatif.** `selectRadius` conduit la recherche ; la
 *    fonction de comptage qu'il reçoit fait **une seule requête par rayon
 *    essayé** (emprise `bboxFromCenter`), puis filtre finement sur la distance
 *    réelle au départ. Les candidats de chaque rayon sont mémorisés : le rayon
 *    retenu ne redemande rien à la base.
 *  - **19. Deux distances, jamais confondues.** `approachM` vient de
 *    `nearestTrailhead` (de vous au départ) ; `lengthM` vient de la longueur
 *    déclarée de l'itinéraire. Elles sont calculées par deux chemins
 *    différents, à partir de deux sources différentes, et ne se croisent
 *    jamais.
 *  - **20. Dire ce qui est signalé.** Les signalements retenus sont ceux que
 *    la carte montre réellement (`listVisibleReports` : statut visible, non
 *    expiré, non terminé) et qui passent à moins de
 *    `NEARBY_REPORT_RADIUS_M` du tracé. `reportHint` en tire la phrase.
 *  - **21. Le silence n'est pas une absence.** Sous le seuil d'anonymat
 *    (`isPublishable`) ou sans le moindre segment rattaché, `frequentation` et
 *    `passagesToday` valent `null` — jamais « très calme », jamais « 0
 *    passage ». `popularityScore` vaut `null` quand aucun segment publiable ne
 *    le porte : un itinéraire inconnu n'est pas un itinéraire impopulaire.
 *  - **25. Dire d'où vient la durée.** `durationObserved` distingue une durée
 *    calculée (modèle de Naismith de `theoreticalTimeMs`) d'une durée corrigée
 *    par des passages réellement observés.
 *  - **37. Forme du tracé et départ.** `trailShape` et `nearestTrailhead`.
 *
 * Coût : par appel, une requête de recherche par rayon essayé (une seule en
 * vallée dense), une requête de segments, une requête de statistiques et une
 * requête de signalements — toutes en lot, jamais une par itinéraire.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import {
  DAY_MS,
  NEARBY_MAX_RESULTS,
  bboxFromCenter,
  clampBBox,
  distanceToPolylineM,
  estimateTime,
  frequentationLevel,
  isPublishable,
  nearbyNote,
  nearestTrailhead,
  rankNearby,
  reportHint,
  segmentProfile,
  selectRadius,
  theoreticalTimeMs,
  trailShape,
  type ActivityMode,
  type BBox,
  type DurationStats,
  type FrequentationLevel,
  type LatLng,
  type LngLat,
  type NearbyResult,
  type NearbySort,
  type NearbyTrail,
  type ReportHintInput,
  type SegmentProfile,
  type SegmentStatistics,
  type TrailGeometryResponse,
  type TrailShape,
  type Trailhead,
} from "@mountain-live/core";
import { db } from "../db/client";
import { paths, segmentStatistics, trails, type PathRow, type TrailRow } from "../db/schema";
import { rowToStatistics } from "./network-stats";
import { toPathSegment } from "./paths";
import { listVisibleReports } from "./reports";

/* ------------------------------------------------------------------ */
/* 1. Réglages (seuils documentés, pas des nombres perdus)             */
/* ------------------------------------------------------------------ */

/**
 * Distance (m) sous laquelle un signalement est considéré « sur l'itinéraire ».
 *
 * 250 m, et non 50 : les géométries d'itinéraires de la base sont simplifiées
 * (un sommet tous les 300 à 800 m sur le jeu corse), et la position servie
 * d'un signalement sensible est volontairement floutée. Un seuil serré ne
 * mesurerait plus la proximité réelle, il mesurerait la finesse du tracé.
 */
export const NEARBY_REPORT_RADIUS_M = 250;

/**
 * Nombre maximal de signalements relus pour qualifier une liste.
 *
 * Ils arrivent par priorité d'affichage décroissante : si l'emprise en compte
 * davantage, ce sont les plus importants qui sont vus. Le décompte peut alors
 * être minoré — jamais majoré, et jamais inventé.
 */
export const NEARBY_REPORT_LIMIT = 2000;

/** Taille des lots d'identifiants envoyés en `IN (...)` (comme `network-stats`). */
export const NEARBY_CHUNK = 400;

/** Types d'itinéraires de la table `trails`, dans l'ordre du schéma. */
export const TRAIL_TYPES: readonly TrailRow["type"][] = ["hiking", "trail", "mtb", "equestrian", "mixed"];

/**
 * Activité prêtée à un itinéraire « mixte » pour estimer sa durée.
 *
 * Un itinéraire ouvert à plusieurs pratiques n'a pas une seule vitesse : la
 * marche est la plus lente et la plus universelle. Annoncer le temps du
 * marcheur à un vététiste lui laisse de la marge ; l'inverse l'envoie dans la
 * nuit.
 */
export const MIXED_ACTIVITY_FALLBACK: ActivityMode = "hiking";

/* ------------------------------------------------------------------ */
/* 2. Outils internes                                                  */
/* ------------------------------------------------------------------ */

/** Sommets `[lng, lat]` d'un itinéraire, vides si la géométrie n'est pas une ligne. */
function trailLine(row: TrailRow): LngLat[] {
  const g = row.geometry;
  if (g.type !== "LineString") return [];
  return g.coordinates.map((c) => [c[0], c[1]] as LngLat);
}

/** Emprise déclarée d'un itinéraire (colonnes dénormalisées de la table). */
function trailBox(row: TrailRow): BBox {
  return { west: row.minLng, south: row.minLat, east: row.maxLng, north: row.maxLat };
}

/** Activité affichée : le type de la base, « mixed » compris (contrat `NearbyTrail`). */
function trailActivity(row: TrailRow): ActivityMode | "mixed" {
  return row.type === "mixed" ? "mixed" : row.type;
}

/** Activité retenue pour le modèle de temps : « mixte » marche (voir la constante). */
function timingActivity(row: TrailRow): ActivityMode {
  return row.type === "mixed" ? MIXED_ACTIVITY_FALLBACK : row.type;
}

/**
 * Types retenus par le filtre d'activité.
 *
 * Un itinéraire « mixte » accompagne toutes les pratiques : il reste visible
 * quel que soit le filtre. Une activité qui ne correspond à aucun type
 * d'itinéraire (« all », « other », valeur inattendue) ne filtre rien — mieux
 * vaut montrer trop que laisser un écran vide à un cavalier.
 */
function allowedTypes(activity: string): readonly TrailRow["type"][] {
  const kept = TRAIL_TYPES.filter((t) => t === activity);
  if (kept.length === 0) return TRAIL_TYPES;
  return TRAIL_TYPES.filter((t) => t === activity || t === "mixed");
}

/**
 * Longueur de la randonnée (m) — DISTANCE 2, celle qu'on marche.
 *
 * `distance_km` est la longueur *déclarée* de l'itinéraire : elle compte les
 * deux sens d'un aller-retour et suit le sentier, là où la polyligne stockée
 * est simplifiée et sous-estimerait systématiquement. Une valeur absente ou
 * absurde donne 0, que `describeLength` affichera « Longueur inconnue » — et
 * non « Randonnée de 0 m ».
 */
function trailLengthM(row: TrailRow): number {
  const km = row.distanceKm;
  if (!Number.isFinite(km) || km <= 0) return 0;
  return Math.round(km * 1000);
}

/**
 * Dénivelé négatif d'un itinéraire, ou `null` s'il est inconnu.
 *
 * Sur une boucle et sur un aller-retour, on revient au point de départ : la
 * descente vaut la montée, ce n'est pas une estimation mais une conséquence de
 * la forme. Sur un itinéraire linéaire, l'arrivée est ailleurs et à une
 * altitude que la base ne connaît pas : `null`, jamais 0.
 */
function trailLossM(shape: TrailShape, gainM: number): number | null {
  if (shape === "linear") return null;
  return Number.isFinite(gainM) && gainM > 0 ? Math.round(gainM) : null;
}

/* ------------------------------------------------------------------ */
/* 3. Candidats : une requête par rayon essayé (section 18)            */
/* ------------------------------------------------------------------ */

/** Itinéraire retenu par la recherche, avec ce qu'il a fallu calculer pour le retenir. */
interface Candidate {
  row: TrailRow;
  line: LngLat[];
  trailhead: Trailhead;
}

/**
 * Itinéraires dont un départ est à moins de `radiusM` de l'utilisateur.
 *
 * Deux temps, et c'est volontaire : la base répond sur une **emprise**
 * (`bboxFromCenter`, indexée par `trails_bbox_idx`), puis le filtrage fin se
 * fait sur la distance réelle au départ. L'emprise carrée déborde le disque
 * de recherche ; sans le second filtre, un itinéraire à 34 km en diagonale
 * passerait pour « à moins de 25 km ».
 *
 * Un itinéraire dont l'emprise croise le rayon mais dont les deux extrémités
 * sont ailleurs (le GR20 qui traverse la vallée sans y commencer) est écarté :
 * on ne peut pas s'y rendre depuis ici sans marcher jusqu'à son départ.
 */
function candidatesWithin(user: LatLng, radiusM: number, types: readonly TrailRow["type"][]): Candidate[] {
  const box = bboxFromCenter(user, radiusM);
  const rows = db
    .select()
    .from(trails)
    .where(
      and(
        lte(trails.minLat, box.north),
        gte(trails.maxLat, box.south),
        lte(trails.minLng, box.east),
        gte(trails.maxLng, box.west),
        inArray(trails.type, [...types]),
      ),
    )
    .all();

  const out: Candidate[] = [];
  for (const row of rows) {
    const line = trailLine(row);
    const trailhead = nearestTrailhead(user, line);
    if (trailhead === null) continue;
    if (trailhead.distanceM > radiusM) continue;
    out.push({ row, line, trailhead });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. Réseau rattaché : fréquentation, passages, popularité (s. 21)    */
/* ------------------------------------------------------------------ */

/** Segments du réseau rattachés à chaque itinéraire (`paths.trail_id`), en un lot. */
function segmentsByTrail(trailIds: readonly string[]): Map<string, PathRow[]> {
  const byTrail = new Map<string, PathRow[]>();
  if (trailIds.length === 0) return byTrail;
  for (let i = 0; i < trailIds.length; i += NEARBY_CHUNK) {
    const ids = trailIds.slice(i, i + NEARBY_CHUNK);
    for (const row of db.select().from(paths).where(inArray(paths.trailId, ids)).all()) {
      if (row.trailId === null) continue;
      const list = byTrail.get(row.trailId);
      if (list === undefined) byTrail.set(row.trailId, [row]);
      else list.push(row);
    }
  }
  return byTrail;
}

/**
 * Statistiques publiables des segments indiqués, en un lot.
 *
 * Seul l'agrégat « toutes activités, les deux sens » est lu : c'est lui qui
 * décrit le chemin. Tout ce qui ne franchit pas le seuil d'anonymat
 * (`isPublishable`) est **absent** de la table renvoyée plutôt que neutralisé :
 * ici, une statistique masquée et une statistique inexistante disent la même
 * chose — nous ne savons pas — et doivent produire le même `null`.
 */
function publishableBySegment(segmentIds: readonly string[]): Map<string, SegmentStatistics> {
  const bySegment = new Map<string, SegmentStatistics>();
  if (segmentIds.length === 0) return bySegment;
  for (let i = 0; i < segmentIds.length; i += NEARBY_CHUNK) {
    const ids = segmentIds.slice(i, i + NEARBY_CHUNK);
    const rows = db
      .select()
      .from(segmentStatistics)
      .where(
        and(
          inArray(segmentStatistics.segmentId, ids),
          eq(segmentStatistics.activityType, "all"),
          eq(segmentStatistics.direction, "both"),
        ),
      )
      .all();
    for (const row of rows) {
      const stats = rowToStatistics(row);
      if (isPublishable(stats)) bySegment.set(stats.segmentId, stats);
    }
  }
  return bySegment;
}

/**
 * Passages enregistrés aujourd'hui sur un segment.
 *
 * La fenêtre « aujourd'hui » n'est pas pré-calculée : on l'approche par le
 * dernier passage, comme la carte de fréquentation (`network-stats`). Le
 * résultat n'est un 0 que sur un segment dont on **sait** qu'il n'a pas été
 * parcouru depuis plus de 24 h ; l'ignorance, elle, ne descend jamais jusqu'ici
 * (le segment n'a alors pas de statistique publiable du tout).
 */
function segmentPassagesToday(stats: SegmentStatistics, now: number): number {
  if (stats.lastPassageAt === null) return 0;
  if (now - stats.lastPassageAt >= DAY_MS) return 0;
  return Math.max(1, Math.round(stats.passages.last7 / 7));
}

/** Synthèse de fréquentation d'un itinéraire, telle qu'elle sera publiée. */
interface NetworkSummary {
  frequentation: FrequentationLevel | null;
  passagesToday: number | null;
  popularityScore: number | null;
}

/** Synthèse muette : aucun segment rattaché, ou aucun au-dessus du seuil d'anonymat. */
const UNKNOWN_NETWORK: NetworkSummary = { frequentation: null, passagesToday: null, popularityScore: null };

/**
 * Fréquentation d'un itinéraire à partir de ses segments (sections 11 et 21).
 *
 * La popularité est la moyenne des scores des segments **publiables**,
 * pondérée par leur longueur : un itinéraire de 27 km ne doit pas être qualifié
 * par un raccord de 80 m très fréquenté. Les segments muets ne comptent pas
 * pour zéro — ils ne comptent pas du tout : les faire peser ferait baisser le
 * score d'un itinéraire simplement parce qu'une partie n'est pas encore
 * documentée.
 *
 * Les passages du jour sont pris au **maximum** et non en somme : un marcheur
 * qui parcourt l'itinéraire traverse tous ses segments, les additionner
 * multiplierait la même personne par le nombre de tronçons.
 *
 * Sans un seul segment publiable, tout vaut `null` : c'est « nous ne savons
 * pas encore », et surtout pas « personne n'y passe ».
 */
function summarizeNetwork(
  segments: readonly PathRow[],
  statsBySegment: ReadonlyMap<string, SegmentStatistics>,
  now: number,
): NetworkSummary {
  let weightSum = 0;
  let scoreSum = 0;
  let plainSum = 0;
  let publishable = 0;
  let today = 0;

  for (const segment of segments) {
    const stats = statsBySegment.get(segment.id);
    if (stats === undefined) continue;
    publishable += 1;
    const weight = Number.isFinite(segment.lengthM) && segment.lengthM > 0 ? segment.lengthM : 0;
    weightSum += weight;
    scoreSum += stats.popularityScore * weight;
    plainSum += stats.popularityScore;
    const passages = segmentPassagesToday(stats, now);
    if (passages > today) today = passages;
  }

  if (publishable === 0) return UNKNOWN_NETWORK;
  // Des segments sans longueur exploitable ne doivent pas annuler la moyenne :
  // à défaut de pondération, chacun pèse autant.
  const score = weightSum > 0 ? scoreSum / weightSum : plainSum / publishable;
  const popularityScore = Math.round(score * 10) / 10;
  return { frequentation: frequentationLevel(popularityScore), passagesToday: today, popularityScore };
}

/* ------------------------------------------------------------------ */
/* 5. Durée de marche (sections 14 et 25)                              */
/* ------------------------------------------------------------------ */

/**
 * Profil physique d'un itinéraire entier, pour `theoreticalTimeMs`.
 *
 * Distance et dénivelé positif viennent de la fiche de l'itinéraire : c'est
 * exactement ce que demande le modèle de Naismith (base plate + majoration à
 * la montée). Les pentes valent 0 à dessein : elles ne servent dans ce modèle
 * qu'à la pénalité de *descente raide*, et la pente moyenne d'une randonnée
 * prise dans son ensemble (on monte puis on redescend) ne dit rien de la
 * raideur d'aucune de ses portions. La supposer raide allongerait toutes les
 * durées sans le moindre relevé pour l'étayer.
 *
 * Revêtement et cotation alpine sont inconnus au niveau de l'itinéraire :
 * `null` les laisse au facteur neutre plutôt que de pénaliser un sentier pour
 * un champ que personne n'a renseigné.
 */
function trailProfile(lengthM: number, gainM: number, lossM: number | null): SegmentProfile {
  return {
    distanceM: lengthM,
    elevationGainM: Number.isFinite(gainM) && gainM > 0 ? gainM : 0,
    elevationLossM: lossM ?? 0,
    averageSlope: 0,
    maxSlope: 0,
    surface: null,
    sacScale: null,
    kind: "path",
  };
}

/**
 * Rythme réellement observé sur les segments d'un itinéraire, rapporté à
 * l'itinéraire entier (section 25).
 *
 * Les passages ne couvrent presque jamais toute la randonnée. On compare donc
 * ce qui est comparable : la somme des médianes observées sur les segments
 * documentés, face à la somme des temps *théoriques* de ces mêmes segments. Le
 * rapport obtenu — « ici, on marche 15 % plus lentement que le modèle » —
 * s'applique ensuite au temps théorique de l'itinéraire complet. Extrapoler au
 * prorata de la *distance* ferait passer un raidillon observé pour du plat.
 *
 * L'effectif retenu est le plus petit des segments contributeurs : c'est le
 * maillon faible qui dit ce que l'on sait, et c'est lui qui détermine le poids
 * que `estimateTime` accordera à l'observation. `null` s'il n'y a rien
 * d'exploitable : l'estimation restera franchement théorique, et le dira.
 */
function observedPace(
  segments: readonly PathRow[],
  statsBySegment: ReadonlyMap<string, SegmentStatistics>,
  activity: ActivityMode,
  theoreticalMs: number,
): DurationStats | null {
  let observedSum = 0;
  let theoreticalSum = 0;
  let samples = Infinity;
  let spread = 0;

  for (const segment of segments) {
    const stats = statsBySegment.get(segment.id);
    if (stats === undefined || stats.duration === null) continue;
    const duration = stats.duration;
    if (!Number.isFinite(duration.medianMs) || duration.medianMs <= 0) continue;
    const reference = theoreticalTimeMs(segmentProfile(toPathSegment(segment)), activity);
    if (reference <= 0) continue;
    observedSum += duration.medianMs;
    theoreticalSum += reference;
    if (duration.count < samples) samples = duration.count;
    if (duration.spread > spread) spread = duration.spread;
  }

  if (theoreticalSum <= 0 || observedSum <= 0 || !Number.isFinite(samples) || samples < 1) return null;
  if (theoreticalMs <= 0) return null;
  const medianMs = Math.round(theoreticalMs * (observedSum / theoreticalSum));
  if (medianMs <= 0) return null;
  // Une seule valeur : médiane et quartiles se confondent. `spread` reprend la
  // dispersion la plus large constatée — la prétendre nulle laisserait croire à
  // une régularité que personne n'a mesurée.
  return { count: samples, averageMs: medianMs, medianMs, p25Ms: medianMs, p75Ms: medianMs, spread };
}

/* ------------------------------------------------------------------ */
/* 6. Signalements actifs à proximité du tracé (section 20)            */
/* ------------------------------------------------------------------ */

/** Emprise couvrant tous les itinéraires indiqués, élargie de la tolérance de proximité. */
function coveringBox(rows: readonly TrailRow[], paddingM: number): BBox | null {
  if (rows.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const row of rows) {
    if (row.minLng < west) west = row.minLng;
    if (row.minLat < south) south = row.minLat;
    if (row.maxLng > east) east = row.maxLng;
    if (row.maxLat > north) north = row.maxLat;
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  const dLat = paddingM / 111_320;
  const cosLat = Math.max(0.01, Math.cos(((north + south) / 2) * (Math.PI / 180)));
  const dLng = paddingM / (111_320 * cosLat);
  return clampBBox({ west: west - dLng, south: south - dLat, east: east + dLng, north: north + dLat });
}

/** Le point est-il dans l'emprise de l'itinéraire, à la tolérance près ? */
function nearBox(point: LatLng, box: BBox, paddingM: number): boolean {
  const dLat = paddingM / 111_320;
  const cosLat = Math.max(0.01, Math.cos(point.lat * (Math.PI / 180)));
  const dLng = paddingM / (111_320 * cosLat);
  return (
    point.lat >= box.south - dLat &&
    point.lat <= box.north + dLat &&
    point.lng >= box.west - dLng &&
    point.lng <= box.east + dLng
  );
}

/**
 * Signalements actifs longeant chacun des itinéraires indiqués.
 *
 * Une seule requête pour toute la liste (l'emprise couvre tous les tracés) :
 * une requête par itinéraire serait le N+1 que `network-stats` évite déjà
 * ailleurs. Seuls les signalements que la carte montre vraiment sont comptés —
 * `listVisibleReports` applique le statut visible, l'expiration et la fin
 * programmée — et c'est la position **servie** (`display_*`, floutée le cas
 * échéant) qui est mesurée : compter ce que l'on cache reviendrait à le
 * désigner.
 *
 * Le rapprochement se fait en deux temps, emprise de l'itinéraire d'abord,
 * distance au tracé ensuite : un signalement de Bavella n'a pas à être mesuré
 * contre chaque sommet du GR20.
 */
function reportsByTrail(rows: readonly TrailRow[], lines: ReadonlyMap<string, LngLat[]>, now: number): Map<string, ReportHintInput[]> {
  const byTrail = new Map<string, ReportHintInput[]>();
  const box = coveringBox(rows, NEARBY_REPORT_RADIUS_M);
  if (box === null) return byTrail;

  const visible = listVisibleReports({ bbox: box, limit: NEARBY_REPORT_LIMIT }, new Date(now));
  if (visible.length === 0) return byTrail;

  for (const row of rows) {
    const line = lines.get(row.id);
    if (line === undefined || line.length === 0) continue;
    const trailExtent = trailBox(row);
    const hits: ReportHintInput[] = [];
    for (const report of visible) {
      const point = { lat: report.displayLat, lng: report.displayLng };
      if (!nearBox(point, trailExtent, NEARBY_REPORT_RADIUS_M)) continue;
      if (distanceToPolylineM(point, line) > NEARBY_REPORT_RADIUS_M) continue;
      hits.push({ subtype: report.subtype, category: report.category });
    }
    if (hits.length > 0) byTrail.set(row.id, hits);
  }
  return byTrail;
}

/* ------------------------------------------------------------------ */
/* 7. Assemblage de la liste (sections 13, 18, 19, 21)                 */
/* ------------------------------------------------------------------ */

/** Paramètres de la recherche de proximité, tels que la route les a validés. */
export interface NearbyInput {
  lat: number;
  lng: number;
  /** Filtre d'activité ; « all » ne filtre pas. */
  activity: string;
  sort: NearbySort;
  limit: number;
  /** Rayon imposé (m) : sinon la recherche s'élargit d'elle-même. */
  radiusM?: number;
}

/**
 * Les randonnées autour d'une position (sections 34 et 35).
 *
 * Le rayon est adaptatif par défaut (`selectRadius`) et imposé si l'appelant le
 * demande. La liste est classée par `rankNearby`, puis tronquée à `limit` — et
 * jamais au-delà de `NEARBY_MAX_RESULTS` : une liste de cent cartes n'est plus
 * une réponse à « où va-t-on ? ».
 *
 * `note` décrit ce que la recherche a trouvé *avant* la troncature : c'est la
 * richesse du secteur qui intéresse l'utilisateur, pas la taille de sa page.
 */
export function nearbyTrails(input: NearbyInput, now = Date.now()): NearbyResult {
  const user: LatLng = { lat: input.lat, lng: input.lng };
  const types = allowedTypes(input.activity);
  const limit = Math.min(Math.max(1, Math.floor(input.limit)), NEARBY_MAX_RESULTS);

  // Une entrée par rayon essayé : `selectRadius` n'appelle le compteur qu'une
  // fois par rayon, et le rayon retenu relit ce qu'il a déjà chargé.
  const cache = new Map<number, Candidate[]>();
  const load = (radiusM: number): Candidate[] => {
    const known = cache.get(radiusM);
    if (known !== undefined) return known;
    const found = candidatesWithin(user, radiusM, types);
    cache.set(radiusM, found);
    return found;
  };

  // Rayon imposé : l'utilisateur a déplacé la carte, on ne le contredit pas en
  // élargissant dans son dos. Sinon, la recherche adaptative décide.
  const forced =
    input.radiusM !== undefined && Number.isFinite(input.radiusM) && input.radiusM > 0
      ? Math.round(input.radiusM)
      : null;
  const selection =
    forced !== null ? { radiusM: forced, widened: false } : selectRadius((radiusM) => load(radiusM).length);
  const candidates = load(selection.radiusM);

  const trailIds = candidates.map((c) => c.row.id);
  const segments = segmentsByTrail(trailIds);
  const segmentIds: string[] = [];
  for (const list of segments.values()) for (const segment of list) segmentIds.push(segment.id);
  const statsBySegment = publishableBySegment(segmentIds);

  const listed: NearbyTrail[] = candidates.map((candidate) => {
    const row = candidate.row;
    const attached = segments.get(row.id) ?? [];
    const shape = trailShape(candidate.line);
    const lengthM = trailLengthM(row);
    const elevationLossM = trailLossM(shape, row.elevationGainM);
    const activity = timingActivity(row);
    const theoreticalMs = theoreticalTimeMs(trailProfile(lengthM, row.elevationGainM, elevationLossM), activity);
    const estimate = estimateTime({
      theoreticalMs,
      observed: observedPace(attached, statsBySegment, activity, theoreticalMs),
    });
    const network = summarizeNetwork(attached, statsBySegment, now);

    return {
      id: row.id,
      name: row.name,
      activity: trailActivity(row),
      difficulty: row.difficulty,
      shape,
      // DISTANCE 1 — de vous au départ. DISTANCE 2 — la randonnée elle-même.
      // Deux origines, deux champs, aucune passerelle entre les deux.
      approachM: candidate.trailhead.distanceM,
      lengthM,
      durationMs: estimate.ms,
      durationObserved: estimate.observedWeight > 0,
      elevationGainM: row.elevationGainM,
      elevationLossM,
      trailhead: candidate.trailhead,
      frequentation: network.frequentation,
      passagesToday: network.passagesToday,
      popularityScore: network.popularityScore,
      // Renseignés après le classement : aucun tri n'en dépend, et la requête
      // n'a alors plus à couvrir que les itinéraires réellement renvoyés.
      activeReports: 0,
      reportHint: null,
    };
  });

  const ranked = rankNearby(listed, input.sort).slice(0, limit);
  const shown = new Map(candidates.map((c) => [c.row.id, c]));
  const shownRows: TrailRow[] = [];
  const shownLines = new Map<string, LngLat[]>();
  for (const trail of ranked) {
    const candidate = shown.get(trail.id);
    if (candidate === undefined) continue;
    shownRows.push(candidate.row);
    shownLines.set(trail.id, candidate.line);
  }
  const reports = reportsByTrail(shownRows, shownLines, now);

  const withReports = ranked.map((trail) => {
    const hits = reports.get(trail.id);
    if (hits === undefined || hits.length === 0) return trail;
    return { ...trail, activeReports: hits.length, reportHint: reportHint(hits) };
  });

  return {
    trails: withReports,
    radiusM: selection.radiusM,
    widened: selection.widened,
    sort: input.sort,
    note: nearbyNote(candidates.length, selection.radiusM, selection.widened),
  };
}

/* ------------------------------------------------------------------ */
/* 8. Tracé complet d'un itinéraire (affichage à la sélection)         */
/* ------------------------------------------------------------------ */

/**
 * Nombre de décimales de la clé d'un sommet : 6 ≈ 10 cm, largement en dessous
 * de l'écart entre deux sommets voisins et largement au-dessus du bruit d'un
 * aller-retour en virgule flottante.
 */
const VERTEX_KEY_DECIMALS = 6;

function vertexKey(lng: number, lat: number): string {
  return `${lng.toFixed(VERTEX_KEY_DECIMALS)},${lat.toFixed(VERTEX_KEY_DECIMALS)}`;
}

/**
 * Altitudes des sommets d'un itinéraire, ou `null` si elles ne sont pas connues.
 *
 * La table `trails` ne porte pas d'altimétrie : la seule source est celle des
 * segments du réseau qui lui sont rattachés, où les altitudes sont alignées sur
 * les sommets. Le rapprochement se fait sur le sommet **exact** (même
 * coordonnée à 10 cm près), jamais sur le sommet le plus proche : l'altitude
 * d'un point voisin est l'altitude d'un autre endroit.
 *
 * C'est tout ou rien. Un profil dont il manque un point au milieu n'est pas un
 * profil partiel, c'est un profil faux — il ferait disparaître un col.
 */
function trailElevations(line: readonly LngLat[], segments: readonly PathRow[]): number[] | null {
  if (line.length === 0) return null;
  const byVertex = new Map<string, number>();
  for (const segment of segments) {
    const elevations = segment.elevations;
    if (elevations === null || elevations === undefined) continue;
    if (elevations.length !== segment.coordinates.length) continue;
    for (let i = 0; i < segment.coordinates.length; i++) {
      const value = elevations[i];
      if (!Number.isFinite(value)) continue;
      byVertex.set(vertexKey(segment.coordinates[i][0], segment.coordinates[i][1]), value);
    }
  }
  if (byVertex.size === 0) return null;

  const out: number[] = [];
  for (const [lng, lat] of line) {
    const value = byVertex.get(vertexKey(lng, lat));
    if (value === undefined) return null;
    out.push(value);
  }
  return out;
}

/**
 * Tracé complet d'un itinéraire, chargé quand l'utilisateur sélectionne une
 * carte de la liste (le tracé n'est pas envoyé avec la liste : trente
 * géométries complètes pèsent bien plus que les trente cartes qu'on regarde).
 *
 * `null` si l'identifiant est inconnu — c'est à l'appelant d'en faire un 404.
 */
export function trailGeometry(id: string): TrailGeometryResponse | null {
  const row = db.select().from(trails).where(eq(trails.id, id)).get();
  if (row === undefined) return null;
  const line = trailLine(row);
  const attached = db.select().from(paths).where(eq(paths.trailId, row.id)).all();
  return { id: row.id, name: row.name, coordinates: line, elevations: trailElevations(line, attached) };
}
