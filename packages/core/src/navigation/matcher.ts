/**
 * Map matching (section 3) : rattache chaque relevé GPS au chemin le plus
 * probable en combinant, pour chaque segment candidat :
 *
 *  - la distance au segment (gaussienne dont l'écart-type suit la précision GPS) ;
 *  - l'accord entre le cap de déplacement et l'axe du segment (parcourable dans les deux sens) ;
 *  - la continuité avec les hypothèses précédentes : même segment (la distance
 *    parcourue le long du chemin doit correspondre au déplacement observé),
 *    segment connecté (petit malus), saut sans connexion (fort malus) ;
 *  - la praticabilité pour l'activité choisie (VTT, cheval…) ;
 *  - l'appartenance à l'itinéraire actif (bonus léger : on privilégie le bon
 *    chemin sans forcer l'utilisateur dessus).
 *
 * Plusieurs hypothèses sont conservées d'un relevé à l'autre (filtre à
 * hypothèses multiples, forme simplifiée d'un modèle de Markov caché), avec
 * une hystérésis aux intersections : on ne bascule sur un autre chemin que si
 * la préférence est nette, sinon on reste sur le chemin en cours (section 4).
 *
 * Aucune dépendance au navigateur : entrée = relevé, sortie = nouvel état +
 * résultat, ce qui rend le moteur testable et réutilisable (application native).
 */
import type { LatLng } from "../types";
import { bearing, haversineM } from "../geo";
import { axisDiff, headingDelta, pointAtAlong, projectOnPolyline, cumulativeDistances } from "./geometry";
import { isSegmentAllowed, segmentsNear, type PathGraph } from "./graph";
import type { ActivityMode, GpsFix, GpsQuality, NavRoute, PathSegment, Projection } from "./types";

export interface MatcherOptions {
  activity: ActivityMode;
  /** Itinéraire actif (bonus pour les segments qui le longent) ou null. */
  route?: NavRoute | null;
  /** Rayon de recherche minimal / maximal (m). */
  minSearchM?: number;
  maxSearchM?: number;
  /** Distance de base au-delà de laquelle l'utilisateur n'est plus rattaché à un chemin (m). */
  snapBaseM?: number;
  maxHypotheses?: number;
}

export interface Hypothesis {
  segmentId: string;
  projection: Projection;
  /** Score cumulé (log-vraisemblance amortie). */
  score: number;
  /** Sens de parcours sur le segment : +1 abscisse croissante, -1 décroissante, 0 inconnu. */
  direction: 1 | -1 | 0;
}

export interface MatchState {
  hypotheses: Hypothesis[];
  lastFix: GpsFix | null;
  /** Relevés récents (cap de déplacement par déplacement réel). */
  recent: GpsFix[];
  /** Cap de déplacement lissé (degrés) ou null. */
  heading: number | null;
  /** Vitesse lissée (m/s) ou null. */
  speedMs: number | null;
  lastOutput: MatchOutput | null;
}

export interface MatchOutput {
  matched: boolean;
  /** Position à afficher : projetée sur le chemin si rattachée, brute sinon. */
  position: LatLng;
  raw: LatLng;
  segment: PathSegment | null;
  /** Abscisse (m) sur le segment retenu. */
  along: number;
  direction: 1 | -1 | 0;
  /** Distance au chemin retenu (m), Infinity sans candidat. */
  distanceToPathM: number;
  /** Confiance 0..1 dans le rattachement. */
  confidence: number;
  heading: number | null;
  speedMs: number | null;
  quality: GpsQuality;
  accuracy: number | null;
  candidates: number;
  onRoute: boolean;
  at: number;
}

export const DEFAULT_MATCHER: Required<Omit<MatcherOptions, "activity" | "route">> = {
  minSearchM: 25,
  maxSearchM: 80,
  snapBaseM: 30,
  maxHypotheses: 4,
};

/** Amortissement des scores cumulés (mémoire ≈ 4 relevés). */
const DECAY = 0.75;
/** Écart de score en dessous duquel on reste sur le chemin en cours (hystérésis). */
const HYSTERESIS = 0.6;
/** Vitesse minimale pour faire confiance au cap (m/s). */
const MIN_SPEED_FOR_HEADING = 0.4;
const RECENT_MAX = 6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function createMatchState(): MatchState {
  return { hypotheses: [], lastFix: null, recent: [], heading: null, speedMs: null, lastOutput: null };
}

/** Qualité du signal (section 21) : selon la précision et l'âge du relevé. */
export function gpsQuality(fix: Pick<GpsFix, "accuracy" | "at"> | null, now: number = Date.now()): GpsQuality {
  if (!fix) return "lost";
  if (now - fix.at > 30_000) return "lost";
  if (fix.accuracy === null || !Number.isFinite(fix.accuracy)) return "fair";
  if (fix.accuracy <= 15) return "good";
  if (fix.accuracy <= 35) return "fair";
  return "poor";
}

/** Cap de déplacement : cap GPS si fiable, sinon déduit des derniers relevés. */
export function movementHeading(recent: readonly GpsFix[], fix: GpsFix): number | null {
  if (fix.heading !== null && Number.isFinite(fix.heading) && fix.speed !== null && fix.speed >= MIN_SPEED_FOR_HEADING) {
    return ((fix.heading % 360) + 360) % 360;
  }
  const minMove = Math.max(6, (fix.accuracy ?? 15) * 0.5);
  // Le relevé le plus ancien (≤ 60 s) situé à plus de `minMove` : cap robuste au bruit.
  for (const old of recent) {
    if (fix.at - old.at > 60_000) continue;
    if (haversineM(old, fix) >= minMove) return bearing(old, fix);
  }
  return null;
}

function smoothHeading(prev: number | null, next: number | null): number | null {
  if (next === null) return prev;
  if (prev === null) return next;
  const d = headingDelta(prev, next);
  return (((prev + d * 0.6) % 360) + 360) % 360;
}

function observedSpeed(state: MatchState, fix: GpsFix): number | null {
  if (fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0) {
    return state.speedMs === null ? fix.speed : state.speedMs * 0.5 + fix.speed * 0.5;
  }
  const last = state.lastFix;
  if (!last) return state.speedMs;
  const dt = (fix.at - last.at) / 1000;
  if (dt <= 0) return state.speedMs;
  const v = haversineM(last, fix) / dt;
  return state.speedMs === null ? v : state.speedMs * 0.5 + v * 0.5;
}

interface Scored {
  segment: PathSegment;
  projection: Projection;
  score: number;
  direction: 1 | -1 | 0;
}

function sharedNodeAlong(graph: PathGraph, a: PathSegment, b: PathSegment): { alongA: number; alongB: number } | null {
  const ea = graph.ends.get(a.id);
  const eb = graph.ends.get(b.id);
  if (!ea || !eb) return null;
  const pairs: [number, number][] = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ];
  for (const [i, j] of pairs) {
    if (ea[i] === eb[j]) return { alongA: i === 0 ? 0 : a.lengthM, alongB: j === 0 ? 0 : b.lengthM };
  }
  return null;
}

/** Malus de continuité : la distance parcourue sur le réseau doit ressembler au déplacement observé. */
function transitionScore(graph: PathGraph, prev: Hypothesis, prevSeg: PathSegment | undefined, next: Scored, observedM: number, sigma: number): number {
  const scale = Math.max(15, 0.5 * observedM + sigma);
  if (prev.segmentId === next.segment.id) {
    const expected = Math.abs(next.projection.along - prev.projection.along);
    const mismatch = Math.abs(expected - observedM);
    return -Math.min(3, 0.5 * (mismatch / scale) ** 2);
  }
  if (!prevSeg) return -2.5;
  const shared = sharedNodeAlong(graph, prevSeg, next.segment);
  if (shared) {
    const expected = Math.abs(prev.projection.along - shared.alongA) + Math.abs(next.projection.along - shared.alongB);
    const mismatch = Math.abs(expected - observedM);
    return -0.4 - Math.min(3, 0.5 * (mismatch / scale) ** 2);
  }
  const gap = haversineM(prev.projection.snapped, next.projection.snapped);
  return gap < 40 ? -2.5 : -4;
}

function inferDirection(prev: Hypothesis | undefined, next: Scored, heading: number | null): 1 | -1 | 0 {
  if (prev && prev.segmentId === next.segment.id) {
    const d = next.projection.along - prev.projection.along;
    if (d > 2) return 1;
    if (d < -2) return -1;
    if (prev.direction !== 0) return prev.direction;
  }
  if (heading !== null) {
    const diff = Math.abs(headingDelta(next.projection.segmentBearing, heading));
    return diff <= 90 ? 1 : -1;
  }
  return prev?.direction ?? 0;
}

function distanceToRoute(route: NavRoute, p: LatLng): number {
  return projectOnPolyline(p, route.coordinates, route.cumulative)?.distanceM ?? Infinity;
}

/**
 * Traite un relevé : renvoie le nouvel état et le résultat du rattachement.
 * `compassHeading` (boussole) n'intervient que si le déplacement est trop
 * faible pour déduire un cap fiable.
 */
export function matchFix(
  state: MatchState,
  fix: GpsFix,
  graph: PathGraph,
  options: MatcherOptions,
  compassHeading: number | null = null,
  now: number = fix.at,
): { state: MatchState; output: MatchOutput } {
  const opts = { ...DEFAULT_MATCHER, ...options };
  const quality = gpsQuality(fix, now);
  const acc = fix.accuracy !== null && Number.isFinite(fix.accuracy) ? fix.accuracy : 40;

  const recent = [...state.recent, fix].slice(-RECENT_MAX);
  const moveHeading = movementHeading(state.recent, fix);
  const speedMs = observedSpeed(state, fix);
  let heading = smoothHeading(state.heading, moveHeading);
  if (heading === null && compassHeading !== null && Number.isFinite(compassHeading)) heading = compassHeading;
  // Un cap trop ancien ne vaut plus rien.
  if (moveHeading === null && state.lastFix && fix.at - state.lastFix.at > 120_000) heading = compassHeading;

  const searchM = clamp(2.5 * acc, opts.minSearchM, opts.maxSearchM);
  const sigma = Math.max(quality === "poor" ? 25 : 8, 0.7 * acc);
  const snapLimit = clamp(opts.snapBaseM + 0.5 * acc, opts.snapBaseM, 60) + (quality === "poor" ? 15 : 0);
  const moving = speedMs !== null && speedMs >= MIN_SPEED_FOR_HEADING;
  const headingWeight = quality === "poor" ? 1 : 2;
  const observedM = state.lastFix ? haversineM(state.lastFix, fix) : 0;
  const routeAlong = opts.route ?? null;

  const scored: Scored[] = [];
  for (const seg of segmentsNear(graph, fix, searchM)) {
    const projection = projectOnPolyline(fix, seg.coordinates);
    if (!projection || projection.distanceM > searchM) continue;
    let score = -0.5 * (projection.distanceM / sigma) ** 2;
    if (heading !== null && (moving || moveHeading !== null)) {
      const a = axisDiff(heading, projection.segmentBearing);
      score -= headingWeight * (a / 90) ** 2;
    }
    if (!isSegmentAllowed(seg, opts.activity)) score -= seg.status === "closed" ? 1 : 1.5;
    if (routeAlong && distanceToRoute(routeAlong, projection.snapped) <= 25) score += 0.8;
    scored.push({ segment: seg, projection, score, direction: 0 });
  }

  // Continuité avec les hypothèses précédentes.
  const prevList = state.hypotheses;
  for (const cand of scored) {
    if (prevList.length === 0) continue;
    let best = -Infinity;
    for (const prev of prevList) {
      const prevSeg = graph.segments.get(prev.segmentId);
      const s = DECAY * prev.score + transitionScore(graph, prev, prevSeg, cand, observedM, sigma);
      if (s > best) best = s;
    }
    cand.score += best;
  }
  scored.sort((a, b) => b.score - a.score);

  // Hystérésis : rester sur le chemin en cours si la préférence n'est pas nette.
  const prevBest = prevList[0];
  if (prevBest && scored.length > 1 && scored[0].segment.id !== prevBest.segmentId) {
    const keep = scored.find((c) => c.segment.id === prevBest.segmentId);
    if (keep && scored[0].score - keep.score < HYSTERESIS && keep.projection.distanceM <= snapLimit) {
      scored.splice(scored.indexOf(keep), 1);
      scored.unshift(keep);
    }
  }

  const hypotheses: Hypothesis[] = scored.slice(0, opts.maxHypotheses).map((c) => ({
    segmentId: c.segment.id,
    projection: c.projection,
    score: c.score,
    direction: inferDirection(prevList.find((p) => p.segmentId === c.segment.id), c, heading),
  }));

  const best = scored[0];
  const matched = Boolean(best) && best.projection.distanceM <= snapLimit;
  let confidence = 0;
  if (matched) {
    const distFactor = 1 - best.projection.distanceM / snapLimit;
    const margin = scored.length > 1 ? clamp((best.score - scored[1].score) / 1.5, 0, 1) : 1;
    confidence = Math.round(clamp(distFactor * (0.55 + 0.45 * margin), 0, 1) * 100) / 100;
  }
  const raw = { lat: fix.lat, lng: fix.lng };
  const output: MatchOutput = {
    matched,
    position: matched ? best.projection.snapped : raw,
    raw,
    segment: matched ? best.segment : null,
    along: matched ? best.projection.along : 0,
    direction: matched ? hypotheses[0].direction : 0,
    distanceToPathM: best ? best.projection.distanceM : Infinity,
    confidence,
    heading,
    speedMs,
    quality,
    accuracy: fix.accuracy,
    candidates: scored.length,
    onRoute: matched && routeAlong ? distanceToRoute(routeAlong, best.projection.snapped) <= 25 : false,
    at: fix.at,
  };
  return { state: { hypotheses, lastFix: fix, recent, heading, speedMs, lastOutput: output }, output };
}

/**
 * Estimation à l'estime (section 22) : entre deux relevés, ou quand le signal
 * se dégrade, avance la position le long du chemin à la vitesse observée
 * (au plus 20 s), sans jamais la faire sauter.
 */
export function deadReckon(output: MatchOutput, now: number): LatLng {
  if (!output.matched || !output.segment || output.direction === 0 || output.speedMs === null || output.speedMs < 0.3) return output.position;
  const dt = clamp((now - output.at) / 1000, 0, 20);
  if (dt <= 0) return output.position;
  const along = clamp(output.along + output.direction * output.speedMs * dt, 0, output.segment.lengthM);
  const cumulative = cumulativeDistances(output.segment.coordinates);
  return pointAtAlong(output.segment.coordinates, cumulative, along);
}
