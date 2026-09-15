/**
 * Superposition de plusieurs traces d'un même parcours : mesurer les écarts,
 * regrouper ce qui décrit le même passage, en tirer un corridor.
 *
 * Sections du cahier des charges « traces GPX » couvertes ici :
 *
 *  - **10. Comparer plusieurs sources.** Plusieurs GPX du même parcours ne se
 *    départagent pas arbitrairement : on les superpose. `compareTraces` mesure
 *    recouvrement, écart médian, écart maximal, sens de parcours et variantes ;
 *    `clusterTraces` regroupe ce qui décrit le même passage ; `buildCorridor`
 *    en tire une ligne centrale. **Ce qui fait la confiance, ce sont les
 *    sources distinctes** — pas le nombre de fichiers : dix traces rediffusées
 *    par la même plateforme restent une source, et un faisceau qui n'atteint
 *    pas `CORRIDOR_MIN_SOURCES` sources distinctes ne peut jamais être présenté
 *    comme fiable (`COMPARE_UNCORROBORATED_CONFIDENCE_CAP`).
 *  - **13. Ce que la comparaison révèle.** Les variantes (portions où une trace
 *    s'écarte franchement de l'autre) et les corridors sont la matière première
 *    des propositions faites à la modération. Ce module *mesure* ; il ne décide
 *    rien, ne fusionne rien, n'écrase rien.
 *  - **24. Un GPX est une observation, pas la vérité.** Un fort recouvrement ne
 *    prouve pas qu'un chemin existe : il dit que deux relevés se ressemblent.
 *    Deux traces peuvent parfaitement se superposer sur un sentier disparu.
 *    Tout ce qui sort d'ici augmente une confiance, jamais un fait.
 *
 * Trois pièges guident la conception de ce fichier :
 *
 * 1. **La comparaison n'est pas symétrique.** `overlap` est la part de **A**
 *    qui suit B. Une trace courte incluse dans une longue recouvre B à 100 %,
 *    alors que B ne recouvre A qu'en partie. `compareTraces(a, b)` et
 *    `compareTraces(b, a)` répondent donc des choses différentes, et c'est
 *    volontaire : le regroupement, lui, exige le recouvrement **mutuel**.
 * 2. **Une trace parcourue à l'envers recouvre parfaitement.** Le recouvrement
 *    seul ne dit rien du sens : `sameDirection` compare la *progression* le
 *    long de B, sans quoi on moyennerait une trace avec son miroir et la ligne
 *    centrale partirait en zigzag. `buildCorridor` réaligne donc chaque trace
 *    sur la référence avant de moyenner quoi que ce soit.
 * 3. **Une origine non déclarée n'est pas une source.** `sourceId === null` ne
 *    compte pas dans `uniqueSources` : deux fichiers d'origine inconnue peuvent
 *    très bien être le même fichier rediffusé. Dans le doute, on ne corrobore
 *    pas (règle des droits d'abord, appliquée ici à la preuve).
 *
 * Module pur : aucun accès réseau, disque ou DOM, aucun aléa, aucune horloge
 * implicite (l'instant de référence est toujours une option, dont le défaut
 * explicite est `Date.now()`). Sorties déterministes, y compris l'ordre des
 * tableaux (tout est trié explicitement). Coût : `compareTraces` est en
 * O(échantillons × points de B), les échantillons étant plafonnés par
 * `COMPARE_MAX_SAMPLES` ; `clusterTraces` et `deduplicate` comparent les paires
 * deux à deux, après un filtre d'emprise qui écarte d'emblée les traces
 * éloignées — l'appelant borne lui-même le nombre de traces soumises.
 */
import {
  METERS_PER_DEG_LAT,
  bearing,
  clampBBox,
  distanceToPolylineM,
  hashString,
  isValidLatLng,
  offsetPoint,
  polylineLengthM,
  type LngLat,
} from "../geo";
import type { BBox, LatLng } from "../types";
import { axisDiff, cumulativeDistances, pointAtAlong, projectOnPolyline, simplifyPoints } from "../navigation/geometry";
import { freshnessWeight, percentile } from "../network/statistics";
import {
  CORRIDOR_MIN_SOURCES,
  SAME_PATH_TOLERANCE_M,
  type ComparableTrace,
  type GeometryLayer,
  type TraceComparison,
  type TraceCorridor,
} from "./types";

/* ------------------------------------------------------------------ */
/* 1. Réglages (seuils documentés, pas des nombres perdus)             */
/* ------------------------------------------------------------------ */

/**
 * Pas (m) de rééchantillonnage de la trace mesurée.
 *
 * 10 m est plus fin que l'espacement d'un relevé de randonnée (un point toutes
 * les quelques secondes de marche, soit 5 à 15 m) : le recouvrement mesure
 * ainsi une **part de longueur**, et non une part de points, ce qui rend deux
 * traces d'échantillonnage très différent malgré tout comparables. Plus fin
 * n'apporterait rien : sous 10 m, on mesure le bruit du récepteur.
 */
export const COMPARE_SAMPLE_M = 10;

/**
 * Nombre maximal d'échantillons d'une comparaison. Au-delà, le pas est élargi.
 *
 * Garde-fou de coût : une trace de 80 km au pas de 10 m produirait 8 000
 * échantillons, chacun balayant toute la seconde polyligne. 1 000 échantillons
 * décrivent déjà finement le plus long des itinéraires soumis au back-office.
 */
export const COMPARE_MAX_SAMPLES = 1000;

/**
 * Écart (m) à partir duquel une portion n'est plus un frôlement mais une
 * **variante** : deux fois la tolérance du contrat.
 *
 * Entre la tolérance (25 m, « on suit le même passage ») et ce seuil, on est
 * dans la zone grise du bruit GPS sous couvert, d'un lacet coupé ou d'un tracé
 * approximatif. Au-delà de 50 m, les deux traces ne passent visiblement plus au
 * même endroit — c'est cela qu'il faut montrer au modérateur.
 */
export const COMPARE_VARIANT_DEVIATION_M = 2 * SAME_PATH_TOLERANCE_M;

/**
 * Longueur (m) minimale d'une variante signalée : en dessous, c'est un pas de
 * côté (contournement d'une flaque, erreur de position isolée), pas un autre
 * chemin. 50 m est l'ordre de grandeur en dessous duquel aucune variante n'est
 * cartographiable.
 */
export const COMPARE_VARIANT_MIN_LENGTH_M = 50;

/**
 * Nombre d'échantillons revenus près de l'autre trace qu'une variante peut
 * enjamber sans être coupée en deux.
 *
 * Un détour de 300 m qui frôle la trace de référence une seule fois en son
 * milieu reste un seul détour : sans ce pont, il serait scindé en deux
 * portions dont aucune n'atteindrait peut-être la longueur minimale.
 */
export const COMPARE_VARIANT_BRIDGE_SAMPLES = 2;

/**
 * Progression (m) en deçà de laquelle un pas le long de l'autre trace ne dit
 * rien du sens de parcours : à cette échelle, l'abscisse projetée avance ou
 * recule au gré du bruit. On ne compte que les pas francs.
 */
export const COMPARE_DIRECTION_MIN_STEP_M = 5;

/**
 * Recouvrement **mutuel** minimal (0..1) pour considérer que deux traces
 * décrivent le même parcours.
 *
 * Mutuel, c'est-à-dire `min(overlap(a, b), overlap(b, a))` : une trace de 1 km
 * entièrement incluse dans un itinéraire de 10 km ne décrit pas *le même
 * parcours* — elle en décrit un morceau. Le regroupement sert à construire des
 * corridors comparables ; on reste exigeant.
 */
export const COMPARE_CLUSTER_MIN_OVERLAP = 0.6;

/**
 * Pas (m) d'échantillonnage de l'abscisse commune d'un corridor. 25 m suffit à
 * suivre les lacets d'un sentier une fois la ligne centrale lissée, pour dix
 * fois moins de projections qu'au pas de la comparaison.
 */
export const COMPARE_CORRIDOR_STEP_M = 25;

/**
 * Écart latéral (m) au-delà duquel une trace n'appartient plus au corridor à
 * cette abscisse : elle longe autre chose (sentier parallèle, lacet voisin).
 * Deux fois la tolérance du contrat, pour ne pas amputer un faisceau large.
 */
export const COMPARE_CORRIDOR_MAX_LATERAL_M = 2 * SAME_PATH_TOLERANCE_M;

/**
 * Écart angulaire (degrés) au-delà duquel une trace **traverse** le corridor au
 * lieu de le suivre.
 *
 * Deux sentiers qui se croisent passent forcément à moins de quelques mètres
 * l'un de l'autre à leur intersection : sans ce garde-fou, un simple
 * croisement fabriquerait un « faisceau » de quelques dizaines de mètres. La
 * mesure est faite sur l'**axe** (0 à 90°) et non sur le cap : une trace
 * localement à contresens suit quand même le même chemin.
 */
export const COMPARE_CORRIDOR_MAX_AXIS_DIFF_DEG = 45;

/**
 * Nombre de traces en dessous duquel il n'y a pas de faisceau. Une trace seule
 * n'est pas un corridor : c'est une trace, et elle est déjà dans la
 * bibliothèque.
 */
export const COMPARE_CORRIDOR_MIN_TRACES = 2;

/**
 * Longueur (m) minimale de la partie commune d'un faisceau. En dessous, deux
 * traces se croisent — elles ne cheminent pas ensemble.
 */
export const COMPARE_CORRIDOR_MIN_LENGTH_M = 50;

/**
 * Tolérance (m) du lissage de la ligne centrale. La médiane latérale est
 * calculée pas à pas : elle saute de quelques mètres quand une trace entre ou
 * sort du faisceau. 3 m efface ces marches sans déplacer le tracé.
 */
export const COMPARE_CORRIDOR_SIMPLIFY_M = 3;

/**
 * Fenêtre (m) de calcul du cap local de la trace de référence, qui oriente la
 * mesure des écarts latéraux. Sous 20 m, le cap suit le bruit du récepteur au
 * lieu de suivre le sentier.
 */
export const COMPARE_BEARING_WINDOW_M = 20;

/**
 * Percentile retenu pour la dispersion latérale d'un pas : la largeur du
 * faisceau est lue au trois-quarts des écarts à la ligne centrale, pas au
 * maximum — une trace qui divague un instant ne doit pas décrire le faisceau
 * entier.
 */
export const COMPARE_DISPERSION_PERCENTILE = 0.75;

/** Préfixe des identifiants de corridor : lisible dans les journaux et l'API. */
export const COMPARE_CORRIDOR_ID_PREFIX = "corridor-";

/**
 * Pas (m) d'échantillonnage de la ligne centrale pour l'identifiant stable :
 * assez grossier pour qu'une trace de plus ne change pas l'identifiant (et donc
 * pas la décision humaine déjà prise sur ce corridor), assez fin pour
 * distinguer deux corridors voisins.
 */
export const COMPARE_ID_SAMPLE_M = 100;

/** Décimales conservées dans l'empreinte géométrique : 1e-4° ≈ 11 m. */
export const COMPARE_ID_PRECISION = 4;

/**
 * Poids des cinq termes de la confiance d'un corridor (somme = 1).
 *
 * Les **sources distinctes** dominent, conformément à la section 10 : c'est la
 * seule chose qui distingue une corroboration d'un écho. Le nombre de traces
 * pèse peu — dix fichiers de la même origine ne sont pas dix témoignages.
 */
export const COMPARE_CONFIDENCE_WEIGHTS = {
  /** Sources distinctes attestant le passage. */
  sources: 0.4,
  /** Diversité des couches (une donnée officielle + OSM valent mieux que deux GPX). */
  layers: 0.2,
  /** Resserrement du faisceau. */
  precision: 0.2,
  /** Volume de traces : une confirmation, pas une preuve. */
  volume: 0.1,
  /** Fraîcheur de la dernière attestation. */
  recency: 0.1,
} as const;

/** Sources distinctes au-delà desquelles le terme de corroboration est acquis. */
export const COMPARE_CONFIDENCE_FULL_SOURCES = 4;

/** Traces au-delà desquelles le volume ne rapporte plus rien. */
export const COMPARE_CONFIDENCE_FULL_TRACES = 6;

/**
 * Couches distinctes au-delà desquelles la diversité est acquise. Trois couches
 * sur cinq (par exemple officiel + OSM + GPX importé) suffisent : exiger les
 * cinq reviendrait à réserver la confiance aux segments déjà parcourus par la
 * communauté, ce qui n'arrive jamais au démarrage d'un territoire.
 */
export const COMPARE_CONFIDENCE_FULL_LAYERS = 3;

/**
 * Dispersion latérale (m) qui annule le terme de précision. On s'aligne sur la
 * tolérance du contrat : un faisceau large de 25 m ne désigne plus un passage,
 * il désigne une zone.
 */
export const COMPARE_DISPERSION_REFERENCE_M = SAME_PATH_TOLERANCE_M;

/**
 * Demi-vie (jours) de la fraîcheur d'un corridor. Un an : le terrain de
 * montagne bouge (éboulement, coupe forestière, sentier réouvert), mais un
 * sentier attesté l'été dernier n'est pas une information périmée.
 */
export const COMPARE_AGE_HALF_LIFE_DAYS = 365;

/**
 * Valeur du terme de fraîcheur quand aucune trace du faisceau n'est datée : ni
 * bonus, ni pénalité. La plupart des GPX publiés sont dépouillés de leurs
 * horodatages ; les pénaliser reviendrait à condamner une trace pour une
 * information que personne ne lui a demandée, les créditer à inventer une
 * fraîcheur.
 */
export const COMPARE_UNDATED_RECENCY = 0.5;

/**
 * Confiance maximale d'un faisceau qui n'atteint pas `CORRIDOR_MIN_SOURCES`
 * sources distinctes (section 10).
 *
 * C'est le cœur de la règle : dix traces rediffusées par la même plateforme
 * restent **une** observation. Le plafond laisse le corridor exister et
 * s'afficher — il peut parfaitement être vrai — mais il l'empêche d'être
 * présenté comme corroboré.
 */
export const COMPARE_UNCORROBORATED_CONFIDENCE_CAP = 0.35;

/**
 * Recouvrement mutuel exigé pour soupçonner un doublon. Très haut : on cherche
 * le **même fichier** récupéré deux fois, pas deux sorties sur le même sentier.
 */
export const COMPARE_DUPLICATE_MIN_OVERLAP = 0.98;

/**
 * Écart médian (m) maximal entre deux copies du même fichier. Deux relevés
 * réellement indépendants du même sentier s'écartent de plus que cela : c'est
 * ce critère, et non le recouvrement, qui distingue une rediffusion d'une
 * seconde observation — et supprimer à tort une observation, c'est perdre une
 * source, donc de la confiance.
 */
export const COMPARE_DUPLICATE_MAX_MEDIAN_M = 5;

/** Écart maximal (m) toléré entre deux copies : au-delà, quelque chose diffère. */
export const COMPARE_DUPLICATE_MAX_DEVIATION_M = 20;

/** Rapport de longueur minimal entre deux copies du même fichier. */
export const COMPARE_DUPLICATE_MIN_LENGTH_RATIO = 0.97;

/* ------------------------------------------------------------------ */
/* 2. Options et outils internes                                       */
/* ------------------------------------------------------------------ */

/**
 * Réglages d'une comparaison. Toutes les valeurs sont facultatives : les
 * défauts sont les constantes ci-dessus, et une valeur absurde (négative, NaN)
 * retombe sur le défaut plutôt que de produire une mesure fausse.
 */
export interface CompareOptions {
  /** Pas (m) de rééchantillonnage de la trace mesurée. Défaut `COMPARE_SAMPLE_M`. */
  sampleM?: number;
  /** Écart (m) sous lequel un échantillon suit encore l'autre trace. Défaut `SAME_PATH_TOLERANCE_M`. */
  toleranceM?: number;
  /** Écart (m) à partir duquel une portion devient une variante. Défaut `COMPARE_VARIANT_DEVIATION_M`. */
  variantDeviationM?: number;
  /** Longueur (m) minimale d'une variante signalée. Défaut `COMPARE_VARIANT_MIN_LENGTH_M`. */
  variantMinLengthM?: number;
  /** Recouvrement mutuel (0..1) exigé pour regrouper. Défaut `COMPARE_CLUSTER_MIN_OVERLAP`. */
  minOverlap?: number;
  /** Pas (m) d'échantillonnage de la ligne centrale. Défaut `COMPARE_CORRIDOR_STEP_M`. */
  corridorStepM?: number;
  /** Instant de référence (ms epoch) pour la fraîcheur. Défaut `Date.now()`. */
  now?: number;
}

/** Réglages résolus : plus aucune valeur facultative ni absurde. */
interface CompareSettings {
  sampleM: number;
  toleranceM: number;
  variantDeviationM: number;
  variantMinLengthM: number;
  minOverlap: number;
  corridorStepM: number;
  now: number;
}

const toRad = (d: number): number => (d * Math.PI) / 180;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Arrondi stable (évite « -0 » et les artefacts flottants en sortie JSON). */
function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Option numérique strictement positive, sinon le défaut. */
function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Option de part (0..1], sinon le défaut : une part nulle regrouperait tout. */
function share(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1 ? value : fallback;
}

/** Comparaison d'identifiants indépendante de la locale (ordre stable partout). */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function resolveOptions(opts: CompareOptions = {}): CompareSettings {
  return {
    sampleM: positive(opts.sampleM, COMPARE_SAMPLE_M),
    toleranceM: positive(opts.toleranceM, SAME_PATH_TOLERANCE_M),
    variantDeviationM: positive(opts.variantDeviationM, COMPARE_VARIANT_DEVIATION_M),
    variantMinLengthM: positive(opts.variantMinLengthM, COMPARE_VARIANT_MIN_LENGTH_M),
    minOverlap: share(opts.minOverlap, COMPARE_CLUSTER_MIN_OVERLAP),
    corridorStepM: positive(opts.corridorStepM, COMPARE_CORRIDOR_STEP_M),
    now: typeof opts.now === "number" && Number.isFinite(opts.now) ? opts.now : Date.now(),
  };
}

/** Trace préparée une fois pour toutes : géométrie assainie, cumuls, emprise. */
interface PreparedTrace {
  id: string;
  line: LngLat[];
  cumulative: number[];
  lengthM: number;
  bbox: BBox | null;
  sourceId: string | null;
  layer: GeometryLayer;
  at: number | null;
  quality: number;
}

function bboxOf(line: readonly LngLat[]): BBox | null {
  if (line.length === 0) return null;
  let west = line[0][0];
  let east = line[0][0];
  let south = line[0][1];
  let north = line[0][1];
  for (const c of line) {
    if (c[0] < west) west = c[0];
    if (c[0] > east) east = c[0];
    if (c[1] < south) south = c[1];
    if (c[1] > north) north = c[1];
  }
  return clampBBox({ west, south, east, north });
}

/**
 * Assainit une trace candidate : les points illisibles (NaN, hors bornes
 * WGS84) sont écartés — jamais corrigés, jamais remplacés par une position
 * approchée qui n'aurait été observée par personne.
 */
function prepare(trace: ComparableTrace): PreparedTrace {
  const line: LngLat[] = [];
  const raw = Array.isArray(trace.coordinates) ? trace.coordinates : [];
  for (const c of raw) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const point = { lng: c[0], lat: c[1] };
    if (!isValidLatLng(point)) continue;
    line.push([point.lng, point.lat]);
  }
  const cumulative = cumulativeDistances(line);
  const lengthM = line.length > 1 ? cumulative[cumulative.length - 1] : 0;
  return {
    id: trace.id,
    line,
    cumulative,
    lengthM: Number.isFinite(lengthM) ? lengthM : 0,
    bbox: bboxOf(line),
    sourceId: typeof trace.sourceId === "string" && trace.sourceId.length > 0 ? trace.sourceId : null,
    layer: trace.layer,
    at: typeof trace.at === "number" && Number.isFinite(trace.at) ? trace.at : null,
    quality: typeof trace.quality === "number" && Number.isFinite(trace.quality) ? trace.quality : 0,
  };
}

/** Même trace, parcourue à l'envers (utilisé pour réaligner un faisceau). */
function reversePrepared(trace: PreparedTrace): PreparedTrace {
  const line = [...trace.line].reverse();
  return { ...trace, line, cumulative: cumulativeDistances(line) };
}

/** Prépare une liste en écartant les identifiants répétés (le premier gagne). */
function prepareAll(traces: readonly ComparableTrace[]): PreparedTrace[] {
  const seen = new Set<string>();
  const out: PreparedTrace[] = [];
  for (const trace of traces) {
    if (!trace || typeof trace.id !== "string" || seen.has(trace.id)) continue;
    seen.add(trace.id);
    out.push(prepare(trace));
  }
  return out;
}

/** Échantillon d'une trace : abscisse curviligne et position. */
interface TraceSample {
  along: number;
  point: LatLng;
}

/**
 * Rééchantillonne une trace à pas fixe. Le pas s'élargit si le nombre
 * d'échantillons dépasse `COMPARE_MAX_SAMPLES`, et une trace de longueur nulle
 * (points tous identiques) rend un unique échantillon : elle a une position,
 * pas une géométrie.
 */
function sampleTrace(trace: PreparedTrace, stepM: number): TraceSample[] {
  if (trace.line.length === 0) return [];
  const first = { lng: trace.line[0][0], lat: trace.line[0][1] };
  if (trace.lengthM <= 0) return [{ along: 0, point: first }];
  const step = Math.max(stepM, trace.lengthM / COMPARE_MAX_SAMPLES);
  const out: TraceSample[] = [];
  for (let along = 0; along < trace.lengthM; along += step) {
    out.push({ along, point: pointAtAlong(trace.line, trace.cumulative, along) });
  }
  // Le dernier point est toujours échantillonné : sans lui, la fin d'une trace
  // qui s'écarte échapperait à la mesure.
  out.push({ along: trace.lengthM, point: pointAtAlong(trace.line, trace.cumulative, trace.lengthM) });
  return out;
}

/**
 * Les emprises peuvent-elles se toucher, à `marginM` près ? Filtre grossier
 * qui évite de superposer deux traces situées dans deux vallées différentes.
 */
function bboxesMayTouch(a: BBox | null, b: BBox | null, marginM: number): boolean {
  if (!a || !b) return false;
  const dLat = marginM / METERS_PER_DEG_LAT;
  const midLat = (a.south + a.north + b.south + b.north) / 4;
  // Plancher sur le cosinus : près des pôles, un degré de longitude tend vers
  // zéro mètre et la marge exploserait.
  const cosLat = Math.max(0.01, Math.cos(toRad(midLat)));
  const dLng = marginM / (METERS_PER_DEG_LAT * cosLat);
  if (a.east + dLng < b.west || b.east + dLng < a.west) return false;
  if (a.north + dLat < b.south || b.north + dLat < a.south) return false;
  return true;
}

/** Union-find : composantes connexes sans récursion ni tri intermédiaire. */
function makeUnionFind(size: number): { find: (i: number) => number; union: (i: number, j: number) => void } {
  const parent: number[] = [];
  for (let i = 0; i < size; i++) parent.push(i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let cursor = i;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (i: number, j: number): void => {
    const a = find(i);
    const b = find(j);
    // Le plus petit indice devient la racine : la sortie ne dépend pas de
    // l'ordre des unions.
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  return { find, union };
}

/** Groupes triés (identifiants croissants, puis groupes par leur premier id). */
function groupsFrom(prepared: readonly PreparedTrace[], find: (i: number) => number): string[][] {
  const buckets = new Map<number, string[]>();
  for (let i = 0; i < prepared.length; i++) {
    const root = find(i);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(prepared[i].id);
    else buckets.set(root, [prepared[i].id]);
  }
  const groups = [...buckets.values()].map((ids) => ids.sort(byId));
  groups.sort((x, y) => byId(x[0], y[0]));
  return groups;
}

/* ------------------------------------------------------------------ */
/* 3. Superposition de deux traces (section 10)                        */
/* ------------------------------------------------------------------ */

/** Comparaison sans mesure possible : on ne remplit rien, on n'invente rien. */
function emptyComparison(a: string, b: string): TraceComparison {
  return { a, b, overlap: 0, medianDeviationM: 0, maxDeviationM: 0, sameDirection: true, variants: [] };
}

/**
 * Suites contiguës d'échantillons franchement écartés, en abscisses curvilignes
 * sur A. Un retour momentané près de B (jusqu'à `COMPARE_VARIANT_BRIDGE_SAMPLES`
 * échantillons) n'interrompt pas la variante.
 */
function extractVariants(
  samples: readonly TraceSample[],
  deviations: readonly number[],
  settings: CompareSettings,
): { fromM: number; toM: number; maxDeviationM: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < deviations.length; i++) {
    if (deviations[i] <= settings.variantDeviationM) continue;
    if (start === -1) start = i;
    else if (i - last - 1 > COMPARE_VARIANT_BRIDGE_SAMPLES) {
      runs.push({ start, end: last });
      start = i;
    }
    last = i;
  }
  if (start !== -1) runs.push({ start, end: last });

  const variants: { fromM: number; toM: number; maxDeviationM: number }[] = [];
  for (const run of runs) {
    const fromM = samples[run.start].along;
    const toM = samples[run.end].along;
    if (toM - fromM < settings.variantMinLengthM) continue;
    let maxDeviationM = 0;
    for (let i = run.start; i <= run.end; i++) {
      if (deviations[i] > maxDeviationM) maxDeviationM = deviations[i];
    }
    variants.push({ fromM: round(fromM, 1), toM: round(toM, 1), maxDeviationM: round(maxDeviationM, 1) });
  }
  variants.sort((x, y) => x.fromM - y.fromM || x.toM - y.toM);
  return variants;
}

/** Superposition de deux traces déjà préparées (cœur de `compareTraces`). */
function comparePrepared(a: PreparedTrace, b: PreparedTrace, settings: CompareSettings): TraceComparison {
  if (a.line.length === 0 || b.line.length === 0) return emptyComparison(a.id, b.id);
  const samples = sampleTrace(a, settings.sampleM);
  if (samples.length === 0) return emptyComparison(a.id, b.id);

  const deviations: number[] = [];
  const alongs: (number | null)[] = [];
  let near = 0;
  let maxDeviationM = 0;
  for (const sample of samples) {
    const raw = distanceToPolylineM(sample.point, b.line);
    // `distanceToPolylineM` rend `Infinity` sur une ligne vide : le cas est
    // déjà écarté plus haut, la garde reste pour qu'aucun Infinity ne sorte.
    const deviation = Number.isFinite(raw) ? raw : 0;
    deviations.push(deviation);
    if (deviation > maxDeviationM) maxDeviationM = deviation;
    if (deviation <= settings.toleranceM) {
      near++;
      const projection = projectOnPolyline(sample.point, b.line, b.cumulative);
      alongs.push(projection && Number.isFinite(projection.along) ? projection.along : null);
    } else {
      alongs.push(null);
    }
  }

  // Sens de parcours : une trace parcourue à l'envers recouvre parfaitement
  // l'autre, seule la *progression* le long de B la trahit. On ne compte que
  // les pas francs, et l'absence de preuve ne vaut pas inversion constatée.
  let forwardM = 0;
  let backwardM = 0;
  let previous: number | null = null;
  for (const along of alongs) {
    if (along === null) continue;
    if (previous !== null) {
      const delta = along - previous;
      if (Math.abs(delta) >= COMPARE_DIRECTION_MIN_STEP_M) {
        if (delta > 0) forwardM += delta;
        else backwardM -= delta;
      }
    }
    previous = along;
  }

  return {
    a: a.id,
    b: b.id,
    overlap: round(near / samples.length, 3),
    medianDeviationM: round(percentile(deviations, 0.5), 1),
    maxDeviationM: round(maxDeviationM, 1),
    sameDirection: forwardM >= backwardM,
    variants: extractVariants(samples, deviations, settings),
  };
}

/**
 * Superpose deux traces et mesure ce qui les sépare (section 10).
 *
 * A est rééchantillonnée à pas fixe et chaque échantillon est mesuré à la
 * polyligne B : `overlap` est la part des échantillons restés sous la
 * tolérance, accompagnée de l'écart médian et de l'écart maximal.
 *
 * **La relation n'est pas symétrique** : `overlap` décrit la part de **A** qui
 * suit B. Une trace courte incluse dans une longue recouvre B à 100 % alors que
 * l'inverse est bien moindre — `compareTraces(a, b)` et `compareTraces(b, a)`
 * répondent donc à deux questions différentes. Le regroupement
 * (`clusterTraces`) exige pour cette raison le recouvrement *mutuel*.
 *
 * Une entrée vide, d'un seul point ou de coordonnées toutes identiques ne jette
 * pas : la comparaison rendue est neutre (aucun recouvrement, aucun écart).
 */
export function compareTraces(a: ComparableTrace, b: ComparableTrace, opts: CompareOptions = {}): TraceComparison {
  return comparePrepared(prepare(a), prepare(b), resolveOptions(opts));
}

/* ------------------------------------------------------------------ */
/* 4. Regroupement des traces d'un même parcours (section 10)          */
/* ------------------------------------------------------------------ */

/** Recouvrement mutuel de deux traces préparées (le plus faible des deux sens). */
function mutualOverlap(a: PreparedTrace, b: PreparedTrace, settings: CompareSettings): number {
  const ab = comparePrepared(a, b, settings).overlap;
  // Inutile de mesurer le second sens si le premier est déjà insuffisant.
  if (ab < settings.minOverlap) return ab;
  return Math.min(ab, comparePrepared(b, a, settings).overlap);
}

/**
 * Regroupe les traces décrivant le même parcours, par composantes connexes
 * (section 10).
 *
 * Deux traces sont reliées quand leur recouvrement **mutuel** atteint
 * `minOverlap` : l'inclusion d'une trace courte dans une longue ne suffit pas.
 * Le sens de parcours n'entre pas en compte — un aller et son retour décrivent
 * le même passage, c'est `buildCorridor` qui les réalignera.
 *
 * Chaque identifiant fourni apparaît exactement une fois dans la sortie, y
 * compris les traces isolées (groupe d'un seul élément) et celles sans
 * géométrie exploitable. Sortie triée : identifiants croissants dans chaque
 * groupe, groupes ordonnés par leur premier identifiant.
 */
export function clusterTraces(traces: readonly ComparableTrace[], opts: CompareOptions = {}): string[][] {
  const settings = resolveOptions(opts);
  const prepared = prepareAll(traces);
  if (prepared.length === 0) return [];
  const { find, union } = makeUnionFind(prepared.length);
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      if (a.line.length === 0 || b.line.length === 0) continue;
      if (!bboxesMayTouch(a.bbox, b.bbox, settings.toleranceM)) continue;
      if (mutualOverlap(a, b, settings) >= settings.minOverlap) union(i, j);
    }
  }
  return groupsFrom(prepared, find);
}

/* ------------------------------------------------------------------ */
/* 5. Ligne centrale d'un faisceau (section 10)                        */
/* ------------------------------------------------------------------ */

/**
 * Sources distinctes d'un jeu de traces.
 *
 * Une origine non déclarée (`sourceId === null`) **ne compte pas** : deux
 * fichiers dont personne ne sait d'où ils viennent peuvent parfaitement être le
 * même fichier rediffusé. Dans le doute, on ne corrobore pas.
 */
function countUniqueSources(traces: readonly PreparedTrace[]): number {
  const sources = new Set<string>();
  for (const trace of traces) if (trace.sourceId !== null) sources.add(trace.sourceId);
  return sources.size;
}

/** Empreinte géométrique stable d'une ligne centrale (identifiant de corridor). */
function corridorId(line: readonly LngLat[]): string {
  const cumulative = cumulativeDistances(line);
  const total = line.length > 1 ? cumulative[cumulative.length - 1] : 0;
  const parts: string[] = [];
  if (total <= 0) {
    const fallback: LngLat = [0, 0];
    const p = line.length > 0 ? line[0] : fallback;
    parts.push(`${p[0].toFixed(COMPARE_ID_PRECISION)},${p[1].toFixed(COMPARE_ID_PRECISION)}`);
  } else {
    for (let along = 0; along <= total; along += COMPARE_ID_SAMPLE_M) {
      const p = pointAtAlong(line, cumulative, along);
      parts.push(`${p.lng.toFixed(COMPARE_ID_PRECISION)},${p.lat.toFixed(COMPARE_ID_PRECISION)}`);
    }
  }
  return `${COMPARE_CORRIDOR_ID_PREFIX}${hashString(parts.join("|")).toString(16).padStart(8, "0")}`;
}

/** Écart latéral signé (m) d'un point par rapport à une position et un cap. */
function lateralOffsetM(origin: LatLng, point: LatLng, headingDeg: number): number {
  const cosLat = Math.cos(toRad(origin.lat));
  const east = (point.lng - origin.lng) * METERS_PER_DEG_LAT * cosLat;
  const north = (point.lat - origin.lat) * METERS_PER_DEG_LAT;
  const theta = toRad(headingDeg);
  // Repère local : « droite » du cap = (cos θ, −sin θ) en (est, nord).
  return east * Math.cos(theta) - north * Math.sin(theta);
}

/**
 * Construit la ligne centrale d'un faisceau de traces (section 10).
 *
 * L'abscisse commune est portée par la trace de **meilleure qualité** (à
 * qualité égale, la plus longue, puis le plus petit identifiant) : on ne
 * fabrique pas une géométrie moyenne à partir de rien, on corrige une géométrie
 * existante. À chaque pas, les autres traces sont projetées, leur écart latéral
 * signé est relevé, et la **médiane** de ces écarts déplace le point de
 * référence. La médiane, et non la moyenne : une trace qui coupe un lacet ne
 * doit pas tirer la ligne centrale hors du sentier.
 *
 * Chaque trace est réalignée au préalable sur le sens de la référence : sans
 * cela, un aller et son retour se moyenneraient à contresens.
 *
 * Une trace ne compte à une abscisse que si elle y est assez proche
 * (`COMPARE_CORRIDOR_MAX_LATERAL_M`) **et** assez parallèle
 * (`COMPARE_CORRIDOR_MAX_AXIS_DIFF_DEG`) : deux sentiers qui se croisent se
 * frôlent à leur intersection sans cheminer ensemble.
 *
 * Seule la portion où le faisceau existe réellement (au moins
 * `COMPARE_CORRIDOR_MIN_TRACES` traces présentes) est retenue, et seulement sa
 * plus longue partie **contiguë** : recoller deux tronçons distants
 * inventerait une ligne droite que personne n'a parcourue.
 *
 * `uniqueSources` compte les `sourceId` distincts — c'est la seule chose qui
 * fait la confiance (section 10). Rend `null` quand le faisceau est trop
 * maigre : moins de deux traces exploitables, ou pas de portion commune assez
 * longue.
 */
export function buildCorridor(traces: readonly ComparableTrace[], opts: CompareOptions = {}): TraceCorridor | null {
  const settings = resolveOptions(opts);
  const usable = prepareAll(traces).filter((t) => t.line.length > 1 && t.lengthM > 0);
  if (usable.length < COMPARE_CORRIDOR_MIN_TRACES) return null;

  // Ordre déterministe : qualité décroissante, puis longueur, puis identifiant.
  const ordered = [...usable].sort((x, y) => y.quality - x.quality || y.lengthM - x.lengthM || byId(x.id, y.id));
  const reference = ordered[0];
  if (reference.lengthM < COMPARE_CORRIDOR_MIN_LENGTH_M) return null;

  // Réalignement : une trace parcourue à l'envers est retournée avant toute
  // moyenne (piège de la section 10).
  const others = ordered.slice(1).map((trace) => {
    const comparison = comparePrepared(trace, reference, settings);
    return comparison.sameDirection ? trace : reversePrepared(trace);
  });

  const samples = sampleTrace(reference, settings.corridorStepM);
  const half = COMPARE_BEARING_WINDOW_M / 2;
  const centers: LatLng[] = [];
  const spreads: number[] = [];
  const present: Set<string>[] = [];
  const valid: boolean[] = [];

  for (const sample of samples) {
    const before = pointAtAlong(reference.line, reference.cumulative, Math.max(0, sample.along - half));
    const after = pointAtAlong(reference.line, reference.cumulative, Math.min(reference.lengthM, sample.along + half));
    const heading = bearing(before, after);
    const offsets: number[] = [0];
    const contributors = new Set<string>([reference.id]);
    for (const other of others) {
      const projection = projectOnPolyline(sample.point, other.line, other.cumulative);
      if (!projection || !Number.isFinite(projection.distanceM)) continue;
      if (projection.distanceM > COMPARE_CORRIDOR_MAX_LATERAL_M) continue;
      // Une trace qui traverse le corridor n'y chemine pas : deux sentiers qui
      // se croisent se frôlent forcément à leur intersection.
      if (axisDiff(heading, projection.segmentBearing) > COMPARE_CORRIDOR_MAX_AXIS_DIFF_DEG) continue;
      const offset = lateralOffsetM(sample.point, projection.snapped, heading);
      if (!Number.isFinite(offset)) continue;
      offsets.push(offset);
      contributors.add(other.id);
    }
    const median = percentile(offsets, 0.5);
    const deviations = offsets.map((o) => Math.abs(o - median));
    centers.push(
      median === 0
        ? sample.point
        : offsetPoint(sample.point, Math.abs(median), median >= 0 ? heading + 90 : heading - 90),
    );
    spreads.push(percentile(deviations, COMPARE_DISPERSION_PERCENTILE));
    present.push(contributors);
    valid.push(contributors.size >= COMPARE_CORRIDOR_MIN_TRACES);
  }

  // Plus longue portion contiguë où le faisceau existe vraiment.
  let bestStart = -1;
  let bestEnd = -1;
  let runStart = -1;
  for (let i = 0; i <= valid.length; i++) {
    if (i < valid.length && valid[i]) {
      if (runStart === -1) runStart = i;
      continue;
    }
    if (runStart !== -1) {
      if (i - 1 - runStart > bestEnd - bestStart) {
        bestStart = runStart;
        bestEnd = i - 1;
      }
      runStart = -1;
    }
  }
  if (bestStart === -1 || bestEnd <= bestStart) return null;

  const contributors = new Set<string>();
  const retainedSpreads: number[] = [];
  const points: LatLng[] = [];
  for (let i = bestStart; i <= bestEnd; i++) {
    points.push(centers[i]);
    retainedSpreads.push(spreads[i]);
    for (const id of present[i]) contributors.add(id);
  }

  const smoothed = simplifyPoints(points, COMPARE_CORRIDOR_SIMPLIFY_M);
  const coordinates: LngLat[] = smoothed.map((p) => [p.lng, p.lat]);
  if (coordinates.length < 2) return null;
  const lengthM = polylineLengthM(coordinates);
  if (!Number.isFinite(lengthM) || lengthM < COMPARE_CORRIDOR_MIN_LENGTH_M) return null;

  const members = ordered.filter((t) => contributors.has(t.id));
  const traceIds = members.map((t) => t.id).sort(byId);
  const dispersionM = round(percentile(retainedSpreads, 0.5), 1);
  const layers = [...new Set(members.map((t) => t.layer))];
  const dates = members.map((t) => t.at).filter((at): at is number => at !== null);
  const lastSeenAt = dates.length > 0 ? Math.max(...dates) : null;
  const uniqueSources = countUniqueSources(members);

  return {
    id: corridorId(coordinates),
    traceIds,
    coordinates,
    lengthM: round(lengthM, 1),
    dispersionM,
    uniqueSources,
    confidence: corridorConfidence(
      { uniqueSources, traces: traceIds.length, dispersionM, layers, lastSeenAt },
      settings.now,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 6. Confiance d'un corridor (sections 10, 24)                        */
/* ------------------------------------------------------------------ */

/**
 * Confiance 0..1 d'un faisceau de traces (section 10).
 *
 * Croissante avec les **sources distinctes** (terme dominant) et la diversité
 * des couches, décroissante avec la dispersion latérale et l'âge de la dernière
 * attestation. Le volume de traces ne pèse qu'un dixième : dix fichiers d'une
 * même origine ne sont pas dix témoignages.
 *
 * Tant que le faisceau n'atteint pas `CORRIDOR_MIN_SOURCES` sources distinctes,
 * le score est plafonné à `COMPARE_UNCORROBORATED_CONFIDENCE_CAP` : une seule
 * source, même prolifique, ne se corrobore pas elle-même. Et même à 1, ce
 * chiffre dit « plusieurs sources indépendantes décrivent ce passage », jamais
 * « ce chemin existe » (section 24).
 *
 * Entrées incohérentes (NaN, négatifs, plus de sources que de traces) ramenées
 * à des valeurs exploitables : la sortie est toujours un nombre fini de 0 à 1.
 */
export function corridorConfidence(
  input: {
    uniqueSources: number;
    traces: number;
    dispersionM: number;
    layers: readonly GeometryLayer[];
    lastSeenAt?: number | null;
  },
  now: number = Date.now(),
): number {
  const traces = Number.isFinite(input.traces) ? Math.max(0, Math.floor(input.traces)) : 0;
  if (traces <= 0) return 0;
  const declared = Number.isFinite(input.uniqueSources) ? Math.max(0, Math.floor(input.uniqueSources)) : 0;
  // On ne peut pas avoir plus de sources distinctes que de traces.
  const uniqueSources = Math.min(declared, traces);
  const dispersionM = Number.isFinite(input.dispersionM) ? Math.max(0, input.dispersionM) : 0;
  const layers = new Set(Array.isArray(input.layers) ? input.layers : []);
  const reference = typeof now === "number" && Number.isFinite(now) ? now : null;
  const lastSeenAt = typeof input.lastSeenAt === "number" && Number.isFinite(input.lastSeenAt) ? input.lastSeenAt : null;

  const terms = {
    sources: clamp01(uniqueSources / COMPARE_CONFIDENCE_FULL_SOURCES),
    layers: clamp01(layers.size / COMPARE_CONFIDENCE_FULL_LAYERS),
    precision: 1 - clamp01(dispersionM / COMPARE_DISPERSION_REFERENCE_M),
    volume: clamp01(traces / COMPARE_CONFIDENCE_FULL_TRACES),
    recency:
      lastSeenAt === null || reference === null
        ? COMPARE_UNDATED_RECENCY
        : freshnessWeight(lastSeenAt, reference, COMPARE_AGE_HALF_LIFE_DAYS),
  };

  let score =
    COMPARE_CONFIDENCE_WEIGHTS.sources * terms.sources +
    COMPARE_CONFIDENCE_WEIGHTS.layers * terms.layers +
    COMPARE_CONFIDENCE_WEIGHTS.precision * terms.precision +
    COMPARE_CONFIDENCE_WEIGHTS.volume * terms.volume +
    COMPARE_CONFIDENCE_WEIGHTS.recency * terms.recency;
  if (uniqueSources < CORRIDOR_MIN_SOURCES) score = Math.min(score, COMPARE_UNCORROBORATED_CONFIDENCE_CAP);
  return round(clamp01(score), 2);
}

/* ------------------------------------------------------------------ */
/* 7. Doublons de collecte (sections 10, 13)                           */
/* ------------------------------------------------------------------ */

/**
 * Deux traces sont-elles le même fichier récupéré deux fois ?
 *
 * Le recouvrement mutuel seul ne suffit pas : deux personnes marchant sur le
 * même sentier produisent aussi deux traces qui se recouvrent. Ce sont les
 * écarts (médian et maximal) et l'égalité des longueurs qui distinguent une
 * rediffusion d'une seconde observation — et le doute profite à l'observation,
 * puisque supprimer une trace à tort revient à perdre une source.
 *
 * Le sens de parcours n'intervient pas : une copie rediffusée à l'envers reste
 * la même géométrie, et la conserver gonflerait artificiellement la confiance.
 */
function looksDuplicate(a: PreparedTrace, b: PreparedTrace, settings: CompareSettings): boolean {
  if (!bboxesMayTouch(a.bbox, b.bbox, settings.toleranceM)) return false;
  const longest = Math.max(a.lengthM, b.lengthM);
  if (longest > 0) {
    const ratio = Math.min(a.lengthM, b.lengthM) / longest;
    if (ratio < COMPARE_DUPLICATE_MIN_LENGTH_RATIO) return false;
  }
  const ab = comparePrepared(a, b, settings);
  if (ab.overlap < COMPARE_DUPLICATE_MIN_OVERLAP) return false;
  if (ab.medianDeviationM > COMPARE_DUPLICATE_MAX_MEDIAN_M) return false;
  if (ab.maxDeviationM > COMPARE_DUPLICATE_MAX_DEVIATION_M) return false;
  const ba = comparePrepared(b, a, settings);
  if (ba.overlap < COMPARE_DUPLICATE_MIN_OVERLAP) return false;
  if (ba.medianDeviationM > COMPARE_DUPLICATE_MAX_MEDIAN_M) return false;
  return ba.maxDeviationM <= COMPARE_DUPLICATE_MAX_DEVIATION_M;
}

/**
 * Repère les traces récupérées deux fois (deux sources rediffusant le même
 * fichier) et désigne celle à conserver.
 *
 * On garde la meilleure de chaque groupe — qualité décroissante, puis la plus
 * détaillée (nombre de points), puis la plus longue, puis le plus petit
 * identifiant, pour que le choix ne dépende jamais de l'ordre d'entrée — et
 * `duplicates` note, pour chaque trace écartée, de quelle trace conservée elle
 * est le doublon.
 *
 * Rien n'est supprimé ici : la fonction *désigne*, l'appelant décide (section
 * 13, aucune modification automatique). Une trace sans géométrie exploitable,
 * ou seulement incluse dans une autre, n'est jamais déclarée doublon.
 *
 * Sortie déterministe : `keep` trié, et les clés de `duplicates` insérées dans
 * l'ordre croissant.
 */
export function deduplicate(
  traces: readonly ComparableTrace[],
  opts: CompareOptions = {},
): { keep: string[]; duplicates: Record<string, string> } {
  const settings = resolveOptions(opts);
  const prepared = prepareAll(traces);
  const keep: string[] = [];
  const duplicates: Record<string, string> = {};
  if (prepared.length === 0) return { keep, duplicates };

  const { find, union } = makeUnionFind(prepared.length);
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i];
      const b = prepared[j];
      if (a.line.length === 0 || b.line.length === 0) continue;
      if (looksDuplicate(a, b, settings)) union(i, j);
    }
  }

  const buckets = new Map<number, PreparedTrace[]>();
  for (let i = 0; i < prepared.length; i++) {
    const root = find(i);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(prepared[i]);
    else buckets.set(root, [prepared[i]]);
  }

  const pairs: { kept: string; dropped: string }[] = [];
  for (const bucket of buckets.values()) {
    const ordered = [...bucket].sort(
      (x, y) =>
        y.quality - x.quality || y.line.length - x.line.length || y.lengthM - x.lengthM || byId(x.id, y.id),
    );
    keep.push(ordered[0].id);
    for (const dropped of ordered.slice(1)) pairs.push({ kept: ordered[0].id, dropped: dropped.id });
  }

  keep.sort(byId);
  pairs.sort((x, y) => byId(x.dropped, y.dropped));
  for (const pair of pairs) duplicates[pair.dropped] = pair.kept;
  return { keep, duplicates };
}
