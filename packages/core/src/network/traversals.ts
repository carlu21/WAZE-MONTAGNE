/**
 * Passages par segment : du map matching différé aux observations anonymisées.
 *
 * Sections du cahier des charges « moteur cartographique » couvertes ici :
 *  - 7  (map matching) : la trace enregistrée est rejouée sur le réseau, en
 *       différé, par le moteur temps réel (`matchFix`). Il n'y a pas de second
 *       algorithme de rattachement : il divergerait de celui du terrain.
 *  - 8  (deux traces distinctes) : la trace brute n'est jamais écrasée. Chaque
 *       point rattaché garde l'`index` de son point d'origine, y compris quand
 *       il n'a pas pu être rattaché.
 *  - 9  (mesurer les passages) : découpage de la trace rattachée en passages.
 *  - 13 (temps réel par segment) : entrée et sortie interpolées, pour que la
 *       durée d'un segment soit comparable d'un utilisateur à l'autre quelle
 *       que soit la cadence d'échantillonnage du récepteur.
 *  - 15 (temps selon le sens) : un aller-retour produit deux passages, un par
 *       sens ; la déduplication éventuelle appartient aux statistiques.
 *  - 19 (chemins potentiels) : isolement des portions hors de tout chemin connu.
 *
 * Tout est pur et déterministe : mêmes entrées, mêmes sorties, aucune horloge
 * implicite (l'instant de référence est toujours celui des points). Le coût est
 * linéaire en nombre de points : le graphe fournit un index spatial par grille,
 * et les passages se construisent en une seule passe, sans comparaison de tous
 * les points deux à deux.
 */
import { haversineM, polylineLengthM } from "../geo";
import type { PathGraph } from "../navigation/graph";
import { createMatchState, matchFix, type MatcherOptions, type MatchState } from "../navigation/matcher";
import type { ActivityMode, GpsFix, PathSegment } from "../navigation/types";
import type {
  MatchedPoint,
  OffNetworkRun,
  PointQuality,
  ScoredPoint,
  SegmentTraversal,
  TraversalDirection,
  TraversalObservation,
} from "./types";

/* ------------------------------------------------------------------ */
/* Réglages produit (seuils documentés, pas des nombres perdus)        */
/* ------------------------------------------------------------------ */

/**
 * Qualité minimale d'un point pour être soumis au matching (section 6).
 * 2 = point utilisable mais médiocre : en dessous, le point est au mieux
 * inutile, au pire il déplacerait l'hypothèse courante sur un chemin voisin.
 */
export const DEFAULT_MIN_QUALITY: PointQuality = 2;

/**
 * Écart maximal (m) accepté entre la position brute et le chemin retenu.
 * Le moteur temps réel tolère jusqu'à 75 m quand le signal est dégradé : il
 * vaut mieux afficher quelque chose que rien. En différé, l'objectif est
 * inverse — un rattachement douteux fausse des statistiques collectives — donc
 * on resserre. Ce seuil ne relâche jamais le matcher : il filtre sa sortie.
 */
export const DEFAULT_MAX_SNAP_M = 40;

/** Seuils par défaut du découpage en passages. */
export const DEFAULT_TRAVERSAL_OPTIONS: Required<TraversalOptions> = {
  /** Moins de la moitié du segment parcourue : la durée n'est pas comparable. */
  minCoverage: 0.5,
  /**
   * …sauf sur un segment très long, où la moitié n'a plus de sens : 500 m
   * réellement parcourus font un passage, même sur une arête de 40 km.
   */
  minDistanceM: 500,
  /** Un point isolé ne décrit pas un passage. */
  minPoints: 2,
  /** Sous 3 s, la durée est dominée par l'incertitude des horodatages. */
  minDurationMs: 3000,
  /** Deux minutes sans relevé : on ne sait plus ce qui s'est passé entre-temps. */
  maxGapMs: 120_000,
  /** Rattachement moyen trop incertain : le passage porterait sur le mauvais chemin. */
  minConfidence: 0.35,
};

/**
 * Recul (m) de l'abscisse à partir duquel on considère un demi-tour et non du
 * bruit. L'abscisse d'un point est bruitée de quelques mètres même immobile ;
 * 15 m est au-dessus de ce bruit et bien en dessous d'un vrai demi-tour.
 */
export const REVERSAL_TOLERANCE_M = 15;

/** Pas minimal (m) pour qu'un déplacement d'abscisse établisse un sens de parcours. */
export const DIRECTION_MIN_STEP_M = 2;

/**
 * Extrapolation maximale (m) vers une extrémité de segment. Au-delà, l'absence
 * de relevé n'est plus un artefact d'échantillonnage mais un trou de données :
 * on préfère un passage partiel (écarté par `minCoverage`) à une durée inventée.
 */
export const MAX_BOUNDARY_EXTRAPOLATION_M = 60;

/** Vitesse minimale (m/s) pour extrapoler : à l'arrêt, rien ne permet de dater un franchissement. */
export const MIN_EXTRAPOLATION_SPEED_MS = 0.2;

/** Longueur minimale (m) d'une portion hors réseau exploitable (section 19). */
export const DEFAULT_OFF_NETWORK_MIN_LENGTH_M = 80;

/** Nombre minimal de points d'une portion hors réseau (une poignée de points ne fait pas un chemin). */
export const DEFAULT_OFF_NETWORK_MIN_POINTS = 5;

/** Trou (ms) au-delà duquel deux portions hors réseau sont deux portions distinctes. */
export const OFF_NETWORK_MAX_GAP_MS = 120_000;

/* ------------------------------------------------------------------ */
/* Outils internes                                                     */
/* ------------------------------------------------------------------ */

/** Arrondi stable (évite « -0 » et les artefacts flottants dans les sorties sérialisées). */
function round(value: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Point conservé dans la trace rattachée sans avoir été rattaché (section 8). */
function unmatched(p: ScoredPoint, index: number): MatchedPoint {
  return {
    index,
    at: p.at,
    segmentId: null,
    // La position brute est conservée telle quelle : c'est elle qui alimentera
    // la détection de chemins potentiels.
    lat: p.lat,
    lng: p.lng,
    along: 0,
    confidence: 0,
    // Aucun segment retenu : pas d'écart à un segment (0 plutôt qu'Infinity,
    // qui ne survivrait pas à une sérialisation JSON).
    deviationM: 0,
    alt: p.alt,
    accuracy: p.accuracy,
  };
}

function toFix(p: ScoredPoint): GpsFix {
  return {
    lat: p.lat,
    lng: p.lng,
    accuracy: p.accuracy,
    altitude: p.alt,
    altitudeAccuracy: null,
    heading: p.heading,
    speed: p.speed,
    at: p.at,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Map matching différé (sections 7 et 8)                           */
/* ------------------------------------------------------------------ */

export interface MatchTraceOptions {
  /** Qualité minimale d'un point pour être soumis au matching. Défaut 2. */
  minQuality?: PointQuality;
  /** Écart maximal (m) au chemin retenu. Défaut 40. */
  maxSnapM?: number;
}

/**
 * Rejoue le map matching sur toute la trace, en différé.
 *
 * La trace est supposée chronologique (c'est ainsi qu'elle est enregistrée) et
 * n'est pas retriée : le matcher est séquentiel, réordonner les points
 * changerait silencieusement le résultat.
 *
 * Les points de qualité insuffisante ne sont pas soumis au matcher — ils
 * fausseraient l'hypothèse courante — mais restent présents dans la sortie
 * avec leur position brute et leur `index` d'origine : le tableau renvoyé a
 * toujours la même longueur que la trace, et `index` fait le lien RAW ↔ MATCHED.
 */
export function matchTrace(
  points: readonly ScoredPoint[],
  graph: PathGraph,
  activity: ActivityMode,
  opts: MatchTraceOptions = {},
): MatchedPoint[] {
  const minQuality = opts.minQuality ?? DEFAULT_MIN_QUALITY;
  const maxSnapM = opts.maxSnapM ?? DEFAULT_MAX_SNAP_M;
  const matcherOptions: MatcherOptions = { activity, route: null };
  const out: MatchedPoint[] = [];
  let state: MatchState = createMatchState();

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.quality < minQuality || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !Number.isFinite(p.at)) {
      out.push(unmatched(p, i));
      continue;
    }
    // `now = p.at` : en différé, « maintenant » est l'instant du relevé, sinon
    // tous les points seraient jugés périmés (signal perdu).
    const res = matchFix(state, toFix(p), graph, matcherOptions, null, p.at);
    state = res.state;
    const output = res.output;
    // L'état du matcher garde la trace de ce point même si le filtre `maxSnapM`
    // le déclasse : c'est bien la position observée qui contraint la suite.
    if (!output.matched || output.segment === null || output.distanceToPathM > maxSnapM) {
      out.push(unmatched(p, i));
      continue;
    }
    out.push({
      index: i,
      at: p.at,
      segmentId: output.segment.id,
      lat: output.position.lat,
      lng: output.position.lng,
      along: round(output.along, 1),
      confidence: output.confidence,
      deviationM: round(output.distanceToPathM, 1),
      alt: p.alt,
      accuracy: p.accuracy,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Découpage en passages (sections 9, 13, 15)                       */
/* ------------------------------------------------------------------ */

export interface TraversalOptions {
  /** Fraction minimale du segment parcourue. Défaut 0,5. */
  minCoverage?: number;
  /**
   * Distance (m) réellement parcourue qui suffit à retenir un passage même
   * sous `minCoverage`.
   *
   * Un réseau réel comporte des arêtes très inégales : une piste découpée tous
   * les 300 m, et une section de GR que nulle intersection ne coupe sur 40 km.
   * Exiger la moitié de l'arête effacerait tous les passages de la seconde, et
   * un chemin très emprunté passerait pour désert (section 43). La couverture
   * reste portée par le passage : c'est la couche statistique qui décide,
   * elle, si la DURÉE est comparable (`MIN_COVERAGE_FOR_DURATION`).
   */
  minDistanceM?: number;
  /** Nombre minimal de points rattachés. Défaut 2. */
  minPoints?: number;
  /** Durée minimale d'un passage (ms). Défaut 3000. */
  minDurationMs?: number;
  /** Trou (ms) au-delà duquel le passage est coupé. Défaut 120 000. */
  maxGapMs?: number;
  /** Confiance moyenne minimale du rattachement. Défaut 0,35. */
  minConfidence?: number;
}

/** Raison d'ouverture ou de fermeture d'un passage (détermine les interpolations). */
type RunBreak =
  | "start" // début de la trace : rien avant, aucun franchissement observé
  | "segment" // le point voisin est ailleurs (autre segment ou hors réseau)
  | "reversal" // demi-tour : l'entrée/sortie est connue exactement
  | "gap" // trou de données : on ne sait pas ce qui s'est passé
  | "end"; // fin de la trace

interface Run {
  segmentId: string;
  points: MatchedPoint[];
  /** Sens établi au premier pas significatif ; sert à détecter le demi-tour. */
  direction: 1 | -1 | 0;
  /** Indice, dans `points`, du point le plus avancé dans `direction`. */
  extremeIdx: number;
  openedBy: RunBreak;
  closedBy: RunBreak;
  /** Instant du point qui précède le passage dans la trace, ou null. */
  prevAt: number | null;
  /** Instant du point qui suit le passage dans la trace, ou null. */
  nextAt: number | null;
}

function closeRun(runs: Run[], run: Run, reason: RunBreak, nextAt: number | null): void {
  run.closedBy = reason;
  run.nextAt = nextAt;
  runs.push(run);
}

/**
 * Découpe la trace rattachée en séries de points consécutifs sur le même
 * segment et dans le même sens. Une seule passe, donc linéaire.
 */
function splitRuns(matched: readonly MatchedPoint[], maxGapMs: number): Run[] {
  const runs: Run[] = [];
  let cur: Run | null = null;
  let pendingOpen: RunBreak = "start";

  for (let i = 0; i < matched.length; i++) {
    const p = matched[i];
    const segmentId = p.segmentId;

    if (segmentId === null) {
      if (cur !== null) {
        closeRun(runs, cur, "segment", p.at);
        cur = null;
      }
      // Le point voisin est hors réseau : le passage suivant commencera bien
      // par une transition observée (bornée, plus loin, par le temps écoulé).
      pendingOpen = "segment";
      continue;
    }

    if (cur !== null && cur.segmentId !== segmentId) {
      closeRun(runs, cur, "segment", p.at);
      cur = null;
      pendingOpen = "segment";
    }
    if (cur !== null && p.at - cur.points[cur.points.length - 1].at > maxGapMs) {
      closeRun(runs, cur, "gap", p.at);
      cur = null;
      pendingOpen = "gap";
    }

    if (cur === null) {
      cur = {
        segmentId,
        points: [p],
        direction: 0,
        extremeIdx: 0,
        openedBy: i === 0 ? "start" : pendingOpen,
        closedBy: "end",
        prevAt: i > 0 ? matched[i - 1].at : null,
        nextAt: null,
      };
      continue;
    }

    const last = cur.points[cur.points.length - 1];
    if (cur.direction === 0) {
      cur.points.push(p);
      cur.extremeIdx = cur.points.length - 1;
      const step = p.along - last.along;
      if (Math.abs(step) >= DIRECTION_MIN_STEP_M) cur.direction = step > 0 ? 1 : -1;
      continue;
    }

    const advanceM = cur.direction * (p.along - cur.points[cur.extremeIdx].along);
    if (advanceM >= 0) {
      // Progression (ou stationnement) : le point le plus avancé est le plus
      // récent, de sorte qu'un arrêt en bout de segment clôt le passage au
      // moment où l'utilisateur repart, et non à son arrivée.
      cur.points.push(p);
      cur.extremeIdx = cur.points.length - 1;
      continue;
    }
    if (-advanceM <= REVERSAL_TOLERANCE_M) {
      // Recul compatible avec le bruit GPS projeté sur l'axe du chemin.
      cur.points.push(p);
      continue;
    }

    // Demi-tour (section 15) : le point le plus avancé ferme l'aller et ouvre
    // le retour. Les points intermédiaires (reculs tolérés) suivent le retour,
    // auquel ils appartiennent réellement.
    const prevDirection: 1 | -1 = cur.direction;
    const tail = cur.points.slice(cur.extremeIdx);
    const pivotPrevAt = cur.extremeIdx > 0 ? cur.points[cur.extremeIdx - 1].at : cur.prevAt;
    cur.points = cur.points.slice(0, cur.extremeIdx + 1);
    closeRun(runs, cur, "reversal", tail.length > 1 ? tail[1].at : p.at);
    const back: Run = {
      segmentId,
      points: [...tail, p],
      direction: prevDirection === 1 ? -1 : 1,
      // `p` a dépassé la tolérance de demi-tour : c'est lui le point le plus
      // avancé dans le nouveau sens.
      extremeIdx: tail.length,
      openedBy: "reversal",
      closedBy: "end",
      prevAt: pivotPrevAt,
      nextAt: null,
    };
    cur = back;
  }

  if (cur !== null) closeRun(runs, cur, "end", null);
  return runs;
}

interface Extrapolation {
  distanceM: number;
  durationMs: number;
}

const NO_EXTRAPOLATION: Extrapolation = { distanceM: 0, durationMs: 0 };

/**
 * Extrapolation vers une extrémité de segment (section 13).
 *
 * Trois bornes, toutes nécessaires : la distance qui reste réellement à
 * couvrir (`gapM`), ce que l'utilisateur a pu parcourir depuis (ou jusqu'au)
 * relevé voisin à la vitesse observée, et un plafond absolu. La deuxième borne
 * est la garantie de sincérité : elle interdit d'inventer un franchissement
 * que la cadence des relevés ne permet pas.
 */
function extrapolate(gapM: number, speedMs: number | null, elapsedMs: number | null, maxGapMs: number): Extrapolation {
  if (speedMs === null || speedMs < MIN_EXTRAPOLATION_SPEED_MS) return NO_EXTRAPOLATION;
  if (elapsedMs === null || elapsedMs <= 0 || elapsedMs > maxGapMs) return NO_EXTRAPOLATION;
  const reach = Math.min(Math.max(0, gapM), MAX_BOUNDARY_EXTRAPOLATION_M, (speedMs * elapsedMs) / 1000);
  if (reach <= 0) return NO_EXTRAPOLATION;
  return { distanceM: reach, durationMs: Math.round((reach / speedMs) * 1000) };
}

function runToTraversal(
  run: Run,
  segments: ReadonlyMap<string, PathSegment>,
  lengths: Map<string, number>,
  opts: Required<TraversalOptions>,
): SegmentTraversal | null {
  const seg = segments.get(run.segmentId);
  if (!seg) return null; // segment inconnu du contexte : rien de mesurable.

  let lengthM = lengths.get(run.segmentId);
  if (lengthM === undefined) {
    // Longueur mesurée sur la géométrie : `seg.lengthM` est arrondi au mètre
    // alors que l'abscisse `along` vient d'un cumul haversine. Mélanger les
    // deux ferait dépasser 1 à la couverture des passages complets.
    const geometric = polylineLengthM(seg.coordinates);
    lengthM = geometric > 0 ? geometric : seg.lengthM;
    lengths.set(run.segmentId, lengthM);
  }
  if (!(lengthM > 0)) return null;

  const pts = run.points;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const spanM = last.along - first.along;
  const sign: 1 | -1 = spanM > 0 ? 1 : spanM < 0 ? -1 : run.direction === -1 ? -1 : 1;
  const observedMs = last.at - first.at;
  // Vitesse moyenne le long du chemin : plus robuste qu'une vitesse instantanée
  // calculée sur deux points, qui reprendrait tout le bruit du récepteur.
  const speedMs = observedMs > 0 && spanM !== 0 ? Math.abs(spanM) / (observedMs / 1000) : null;

  const entryGapM = sign > 0 ? first.along : lengthM - first.along;
  const exitGapM = sign > 0 ? lengthM - last.along : last.along;
  const entry =
    run.openedBy === "segment"
      ? extrapolate(entryGapM, speedMs, run.prevAt === null ? null : first.at - run.prevAt, opts.maxGapMs)
      : NO_EXTRAPOLATION;
  const exit =
    run.closedBy === "segment"
      ? extrapolate(exitGapM, speedMs, run.nextAt === null ? null : run.nextAt - last.at, opts.maxGapMs)
      : NO_EXTRAPOLATION;

  const enteredAt = first.at - entry.durationMs;
  const exitedAt = last.at + exit.durationMs;
  const durationMs = Math.max(0, exitedAt - enteredAt);
  // Distance retenue = amplitude d'abscisse, bornes interpolées comprises. La
  // somme des écarts point à point amplifierait le bruit GPS projeté sur l'axe
  // du chemin (quelques mètres par relevé) et gonflerait la vitesse moyenne.
  const distanceM = Math.abs(spanM) + entry.distanceM + exit.distanceM;
  const coverage = clamp01(distanceM / lengthM);

  let confidenceSum = 0;
  for (const p of pts) confidenceSum += p.confidence;
  const confidence = round(confidenceSum / pts.length, 2);

  const direction: TraversalDirection = sign > 0 ? "forward" : "backward";
  const traversal: SegmentTraversal = {
    segmentId: run.segmentId,
    direction,
    enteredAt: Math.round(enteredAt),
    exitedAt: Math.round(exitedAt),
    durationMs: Math.round(durationMs),
    coverage: round(coverage, 3),
    distanceM: round(distanceM, 1),
    averageSpeedMs: durationMs > 0 ? round(distanceM / (durationMs / 1000), 3) : 0,
    points: pts.length,
    confidence,
  };

  if (
    traversal.points < opts.minPoints ||
    (traversal.coverage < opts.minCoverage && traversal.distanceM < opts.minDistanceM) ||
    traversal.durationMs < opts.minDurationMs ||
    traversal.confidence < opts.minConfidence
  ) {
    return null;
  }
  return traversal;
}

/**
 * Extrait les passages (section 9) d'une trace rattachée.
 *
 * Un passage est une série de points consécutifs sur le même segment et dans
 * le même sens. Il se ferme sur un changement de segment, un demi-tour ou un
 * trou de données. Un aller-retour produit donc deux passages, un par sens
 * (section 15) : c'est la matière première des temps par sens.
 *
 * Les passages trop partiels, trop courts ou trop incertains sont écartés :
 * ils ne fausseront pas les temps médians calculés plus loin.
 */
export function extractTraversals(
  matched: readonly MatchedPoint[],
  segments: ReadonlyMap<string, PathSegment>,
  opts: TraversalOptions = {},
): SegmentTraversal[] {
  const merged: Required<TraversalOptions> = { ...DEFAULT_TRAVERSAL_OPTIONS, ...opts };
  const lengths = new Map<string, number>();
  const out: SegmentTraversal[] = [];
  for (const run of splitRuns(matched, merged.maxGapMs)) {
    const traversal = runToTraversal(run, segments, lengths, merged);
    if (traversal !== null) out.push(traversal);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 3. Observations anonymisées (sections 9, 13, 15)                    */
/* ------------------------------------------------------------------ */

/**
 * Convertit des passages en observations publiables.
 *
 * Aucune position n'est reportée : une observation dit « ce segment a été
 * parcouru dans ce sens, en tant de temps », jamais où était quelqu'un. Le
 * `userKey` est un pseudonyme fourni par l'appelant (dérivé d'un secret
 * serveur) : ce module ne voit jamais d'identifiant de compte.
 * `at` est la fin du passage : c'est l'instant qui compte pour la fraîcheur.
 */
export function toObservations(
  traversals: readonly SegmentTraversal[],
  meta: { activity: ActivityMode; userKey: string },
): TraversalObservation[] {
  return traversals.map((t) => ({
    segmentId: t.segmentId,
    activity: meta.activity,
    direction: t.direction,
    at: t.exitedAt,
    durationMs: t.durationMs,
    distanceM: t.distanceM,
    coverage: t.coverage,
    userKey: meta.userKey,
    confidence: t.confidence,
  }));
}

/* ------------------------------------------------------------------ */
/* 4. Portions hors réseau (section 19)                                */
/* ------------------------------------------------------------------ */

function buildOffNetworkRun(
  run: readonly MatchedPoint[],
  meta: { activity: ActivityMode; userKey: string },
  minLengthM: number,
  minPoints: number,
): OffNetworkRun | null {
  if (run.length < minPoints) return null;
  let lengthM = 0;
  for (let i = 1; i < run.length; i++) lengthM += haversineM(run[i - 1], run[i]);
  if (lengthM < minLengthM) return null;
  return {
    userKey: meta.userKey,
    activity: meta.activity,
    // Début de la portion : la borne de fin se lit sur le dernier point.
    at: run[0].at,
    fromIndex: run[0].index,
    toIndex: run[run.length - 1].index,
    lengthM: round(lengthM, 1),
    points: run.map((p) => ({ lat: p.lat, lng: p.lng, at: p.at, accuracy: p.accuracy })),
  };
}

/**
 * Isole les portions de trace hors de tout chemin connu (section 19).
 *
 * Seuls les points non rattachés comptent : une portion collée à un chemin
 * connu n'est pas un chemin nouveau, elle est déjà dans le réseau. Un point
 * rattaché coupe donc la série, comme un trou de plus de deux minutes — deux
 * portions séparées par une longue absence de relevés ne décrivent pas le même
 * passage.
 *
 * Les seuils de longueur et de nombre de points sont là pour écarter le bruit :
 * quelques points déclassés au bord d'un sentier ne sont pas un chemin.
 */
export function extractOffNetworkRuns(
  matched: readonly MatchedPoint[],
  meta: { activity: ActivityMode; userKey: string },
  opts: { minLengthM?: number; minPoints?: number } = {},
): OffNetworkRun[] {
  const minLengthM = opts.minLengthM ?? DEFAULT_OFF_NETWORK_MIN_LENGTH_M;
  const minPoints = opts.minPoints ?? DEFAULT_OFF_NETWORK_MIN_POINTS;
  const out: OffNetworkRun[] = [];
  let run: MatchedPoint[] = [];

  for (const p of matched) {
    if (p.segmentId !== null) {
      const built = buildOffNetworkRun(run, meta, minLengthM, minPoints);
      if (built !== null) out.push(built);
      run = [];
      continue;
    }
    if (run.length > 0 && p.at - run[run.length - 1].at > OFF_NETWORK_MAX_GAP_MS) {
      const built = buildOffNetworkRun(run, meta, minLengthM, minPoints);
      if (built !== null) out.push(built);
      run = [];
    }
    run.push(p);
  }
  const built = buildOffNetworkRun(run, meta, minLengthM, minPoints);
  if (built !== null) out.push(built);
  return out;
}
