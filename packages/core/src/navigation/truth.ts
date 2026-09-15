/**
 * Ce que l'application a le DROIT d'afficher.
 *
 * Règle fondatrice, et elle ne souffre aucune exception :
 *
 *   NE JAMAIS RELIER DEUX POSITIONS GPS PAR UNE SIMPLE LIGNE DROITE POUR
 *   REPRÉSENTER UN ITINÉRAIRE.
 *
 * Une ligne droite ne peut être qu'une DIRECTION INDICATIVE — une flèche de
 * boussole, courte et bornée — jamais un chemin à suivre. Un itinéraire suit le
 * réseau réel de chemins ou n'existe pas. Une absence de réponse vaut mieux
 * qu'un faux itinéraire.
 *
 * Ce module ne dessine rien et n'appelle rien : il répond à quatre questions
 * que le reste du code doit poser avant d'afficher quoi que ce soit.
 *
 *  1. Cette géométrie est-elle un vrai chemin, ou un schéma ?   `geometryFidelity`
 *  2. Ai-je le droit de la tracer comme un itinéraire ?          `routeVerdict`
 *  3. Cette position est-elle assez fiable pour juger ?          `positionTrust`
 *  4. Ai-je le droit de dire « hors sentier » ?                  `trailVerdict`
 *
 * Et une cinquième, pour la trace réellement parcourue :
 *  5. Ces deux relevés se suivent-ils vraiment ?                 `splitTrace`
 */
import { bearing, haversineM, offsetPoint } from "../geo";
import type { LngLat } from "../geo";
import type { LatLng } from "../types";
import type { GpsQuality, PathSource, TrackPoint } from "./types";

/* ------------------------------------------------------------------ */
/* 1. Provenance : d'où vient la géométrie                             */
/* ------------------------------------------------------------------ */

/**
 * Sources relevées sur le terrain ou publiées par une autorité cartographique.
 * `seed` et `local` en sont exclues : ce sont des données de démonstration ou
 * de travail, et présenter une démonstration comme un sentier réel est
 * exactement ce que ce module existe pour empêcher.
 */
export const SURVEYED_SOURCES: readonly PathSource[] = ["osm", "ign", "gpx"];

export function isSurveyed(source: PathSource | null | undefined): boolean {
  return source !== null && source !== undefined && SURVEYED_SOURCES.includes(source);
}

/* ------------------------------------------------------------------ */
/* 2. Fidélité géométrique : un chemin, ou un schéma ?                  */
/* ------------------------------------------------------------------ */

/**
 * Au-delà de cet espacement moyen entre sommets (m), la ligne ne décrit plus le
 * terrain : elle relie des points de passage. Un sentier de montagne tourne ;
 * une polyligne qui avance de 150 m en ligne droite en moyenne ne tourne pas.
 */
export const SCHEMATIC_MEAN_SPACING_M = 150;
/** Un seul bond de cette longueur (m) suffit à disqualifier la géométrie. */
export const SCHEMATIC_MAX_GAP_M = 600;
/**
 * Si la longueur annoncée est connue et que la polyligne ne fait pas au moins
 * cette fraction de cette longueur, la ligne coupe au plus court : c'est un
 * raccourci à vol d'oiseau, pas le chemin.
 */
export const SCHEMATIC_MIN_LENGTH_RATIO = 0.7;

export type FidelityLevel = "empty" | "schematic" | "detailed";

export interface GeometryFidelity {
  level: FidelityLevel;
  pointCount: number;
  /** Longueur réelle de la polyligne (m). */
  lengthM: number;
  /** Espacement moyen entre deux sommets (m) ; 0 si moins de deux points. */
  meanSpacingM: number;
  /** Plus long segment rectiligne (m). */
  maxGapM: number;
  /** Longueur annoncée par la source (m), si elle a été fournie. */
  declaredLengthM: number | null;
  /** Ce qui a disqualifié la géométrie, pour l'expliquer honnêtement. */
  reason: "too_few_points" | "mean_spacing" | "max_gap" | "shorter_than_declared" | null;
}

/**
 * Mesure la finesse d'une polyligne. `declaredLengthM` est la longueur que la
 * source annonce (fiche de sentier, base de données) : quand la ligne est bien
 * plus courte que cette annonce, elle coupe au plus court et ne décrit pas le
 * parcours.
 */
export function geometryFidelity(
  coordinates: readonly LngLat[] | null | undefined,
  declaredLengthM: number | null = null,
): GeometryFidelity {
  const declared = declaredLengthM !== null && Number.isFinite(declaredLengthM) && declaredLengthM > 0 ? declaredLengthM : null;
  const pts = coordinates ?? [];
  if (pts.length < 2) {
    return { level: "empty", pointCount: pts.length, lengthM: 0, meanSpacingM: 0, maxGapM: 0, declaredLengthM: declared, reason: "too_few_points" };
  }
  let lengthM = 0;
  let maxGapM = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineM({ lng: pts[i - 1][0], lat: pts[i - 1][1] }, { lng: pts[i][0], lat: pts[i][1] });
    lengthM += d;
    if (d > maxGapM) maxGapM = d;
  }
  const meanSpacingM = lengthM / (pts.length - 1);
  const base = { pointCount: pts.length, lengthM: Math.round(lengthM), meanSpacingM: Math.round(meanSpacingM), maxGapM: Math.round(maxGapM), declaredLengthM: declared };
  if (meanSpacingM > SCHEMATIC_MEAN_SPACING_M) return { ...base, level: "schematic", reason: "mean_spacing" };
  if (maxGapM > SCHEMATIC_MAX_GAP_M) return { ...base, level: "schematic", reason: "max_gap" };
  if (declared !== null && lengthM < declared * SCHEMATIC_MIN_LENGTH_RATIO) return { ...base, level: "schematic", reason: "shorter_than_declared" };
  return { ...base, level: "detailed", reason: null };
}

/* ------------------------------------------------------------------ */
/* 3. Ai-je le droit de tracer cet itinéraire ?                         */
/* ------------------------------------------------------------------ */

/**
 * Pourquoi un itinéraire ne peut pas être dessiné. Chaque valeur correspond à
 * une phrase affichée à l'utilisateur : on dit ce qui manque, on n'invente pas
 * une ligne pour combler le vide.
 */
export type RouteRefusal =
  /** Aucune géométrie : moins de deux points. */
  | "no_geometry"
  /** La géométrie existe mais relie des points de passage, pas le terrain. */
  | "schematic_geometry"
  /** La géométrie ne vient pas d'un relevé réel (démonstration, brouillon). */
  | "not_surveyed"
  /** Aucun chemin connu dans le secteur : le réseau n'est pas chargé. */
  | "no_network"
  /** Le réseau est là, mais aucun chemin ne relie les deux points. */
  | "unreachable";

export interface RouteVerdictInput {
  coordinates: readonly LngLat[] | null | undefined;
  /** Provenance de la géométrie. `null` quand elle est inconnue — donc refusée. */
  source: PathSource | null;
  /** Longueur annoncée par la source (m), si connue. */
  declaredLengthM?: number | null;
  /** Nombre de segments de réseau chargés autour (0 = rien de connu). */
  networkSegments?: number;
}

export interface RouteVerdict {
  /** `true` seulement si la ligne peut être présentée comme un itinéraire à suivre. */
  drawable: boolean;
  refusal: RouteRefusal | null;
  fidelity: GeometryFidelity;
}

/**
 * Un itinéraire ne se dessine que s'il suit un réseau réel : géométrie relevée
 * (OSM, IGN, GPX) ET assez fine pour décrire le terrain. Tout le reste est
 * refusé, avec sa raison.
 */
export function routeVerdict(input: RouteVerdictInput): RouteVerdict {
  const fidelity = geometryFidelity(input.coordinates, input.declaredLengthM ?? null);
  if (fidelity.level === "empty") {
    return { drawable: false, refusal: input.networkSegments === 0 ? "no_network" : "no_geometry", fidelity };
  }
  if (!isSurveyed(input.source)) return { drawable: false, refusal: "not_surveyed", fidelity };
  if (fidelity.level === "schematic") return { drawable: false, refusal: "schematic_geometry", fidelity };
  return { drawable: true, refusal: null, fidelity };
}

/* ------------------------------------------------------------------ */
/* 4. Direction indicative : une flèche, jamais un chemin               */
/* ------------------------------------------------------------------ */

/**
 * Longueur affichée d'une direction indicative (m). Bornée exprès : une flèche
 * de 90 m ne peut pas se lire comme « marchez tout droit pendant 4 km ».
 */
export const DIRECTION_INDICATOR_M = 90;

export interface DirectionIndicator {
  /** Deux points : l'origine et la pointe de la flèche. Jamais plus. */
  coordinates: LngLat[];
  /** Cap réel vers la cible (degrés). */
  bearing: number;
  /** Distance réelle jusqu'à la cible (m) — affichée, mais pas dessinée. */
  distanceM: number;
}

/**
 * Flèche courte partant de `from` vers `to`. C'est le SEUL usage légitime d'une
 * ligne droite entre deux positions : elle s'arrête à `DIRECTION_INDICATOR_M`
 * (ou avant, si la cible est plus proche) précisément pour qu'on ne puisse pas
 * la confondre avec un tracé à suivre.
 */
export function directionIndicator(from: LatLng, to: LatLng, lengthM = DIRECTION_INDICATOR_M): DirectionIndicator {
  const distanceM = haversineM(from, to);
  const brg = bearing(from, to);
  const tip = offsetPoint(from, Math.min(lengthM, Math.max(1, distanceM)), brg);
  return { coordinates: [[from.lng, from.lat], [tip.lng, tip.lat]], bearing: Math.round(brg), distanceM: Math.round(distanceM) };
}

/* ------------------------------------------------------------------ */
/* 5. Confiance dans la position                                        */
/* ------------------------------------------------------------------ */

/** Au-delà, la position ne permet aucun jugement sur le sentier (m). */
export const TRUST_RELIABLE_ACCURACY_M = 25;
/** Au-delà, la position est grossière : on l'affiche, on n'en conclut rien (m). */
export const TRUST_COARSE_ACCURACY_M = 60;
/** Relevés successifs nécessaires avant de considérer la position acquise. */
export const TRUST_MIN_FIXES = 3;

/**
 * - `unavailable` : aucun relevé — on n'affiche NI marqueur NI trajectoire.
 * - `acquiring`   : signal en cours d'acquisition (trop peu de relevés, ou perdu).
 * - `coarse`      : position affichable, mais aucune conclusion permise.
 * - `reliable`    : position exploitable pour juger du sentier.
 */
export type PositionTrust = "unavailable" | "acquiring" | "coarse" | "reliable";

export interface PositionTrustInput {
  /** Précision horizontale annoncée (m), `null` si inconnue. */
  accuracy: number | null;
  quality: GpsQuality;
  /** Nombre de relevés reçus depuis le début de la session. */
  fixes: number;
  /** La source cherche encore le signal. */
  searching?: boolean;
}

export function positionTrust(input: PositionTrustInput | null): PositionTrust {
  if (!input || input.fixes <= 0) return "unavailable";
  if (input.quality === "lost" || input.searching === true) return "acquiring";
  // Une précision inconnue n'est pas une bonne précision.
  if (input.accuracy === null || !Number.isFinite(input.accuracy)) return "coarse";
  if (input.accuracy > TRUST_COARSE_ACCURACY_M) return "acquiring";
  if (input.accuracy > TRUST_RELIABLE_ACCURACY_M || input.quality === "poor") return "coarse";
  /*
   * Un premier relevé précis EST une position : on l'affiche, avec sa marge.
   * Ce qui lui manque n'est pas la précision mais l'historique — et c'est
   * l'historique qui autorise à juger du sentier. Tant qu'il n'y en a pas
   * assez, la position reste « approximative » : affichée, jamais opposée à
   * l'utilisateur. Dire « Acquisition GPS… » alors qu'on a déjà une position
   * à 8 m serait faux dans l'autre sens.
   */
  if (input.fixes < TRUST_MIN_FIXES) return "coarse";
  return "reliable";
}

/* ------------------------------------------------------------------ */
/* 6. Ai-je le droit de dire « hors sentier » ?                         */
/* ------------------------------------------------------------------ */

/** Confiance minimale du rattachement avant de nommer le chemin. */
export const TRAIL_MIN_CONFIDENCE = 0.35;
/** Écart au chemin (m) toléré sans rien dire, une fois la position fiable. */
export const TRAIL_TOLERANCE_M = 25;
/** Relevés successifs au-delà de la tolérance avant d'alerter. */
export const TRAIL_MIN_CONSECUTIVE = 4;

export type TrailVerdict =
  /** On ne sait pas — et on le dit ainsi, jamais « hors sentier ». */
  | "unknown"
  | "on_trail"
  /** Rattaché, mais sans certitude sur le chemin exact. */
  | "uncertain"
  /** Assez d'éléments concordants pour dire que l'utilisateur a quitté le sentier. */
  | "off_trail";

export interface TrailJudgementInput {
  trust: PositionTrust;
  /** Segments de réseau chargés autour de l'utilisateur. */
  networkSegments: number;
  /** Le map matching a tourné sur ce relevé. */
  matchAttempted: boolean;
  matched: boolean;
  confidence: number;
  /** Distance au chemin retenu (m) ; `Infinity` sans candidat. */
  distanceToPathM: number;
  /** Relevés successifs au-delà de la tolérance. */
  consecutiveOff: number;
}

/**
 * Les trois conditions préalables du cahier des charges : GPS assez précis,
 * réseau de chemins disponible, map matching effectué. Tant qu'elles ne sont
 * pas réunies, aucun jugement — « Position en cours d'acquisition », pas
 * « Hors sentier ».
 */
export function canJudgeTrail(input: Pick<TrailJudgementInput, "trust" | "networkSegments" | "matchAttempted">): boolean {
  return input.trust === "reliable" && input.networkSegments > 0 && input.matchAttempted;
}

/**
 * Verdict sur le rattachement au sentier. « Hors sentier » exige, EN PLUS des
 * trois conditions préalables, plusieurs mesures successives au-delà du seuil :
 * quelques mètres d'écart ne disent rien, et un relevé isolé encore moins.
 */
export function trailVerdict(input: TrailJudgementInput): TrailVerdict {
  if (!canJudgeTrail(input)) return "unknown";
  if (input.matched && input.confidence >= TRAIL_MIN_CONFIDENCE) return "on_trail";
  if (input.matched) return "uncertain";
  if (!Number.isFinite(input.distanceToPathM)) return input.consecutiveOff >= TRAIL_MIN_CONSECUTIVE ? "off_trail" : "unknown";
  if (input.distanceToPathM <= TRAIL_TOLERANCE_M) return "uncertain";
  return input.consecutiveOff >= TRAIL_MIN_CONSECUTIVE ? "off_trail" : "uncertain";
}

/* ------------------------------------------------------------------ */
/* 7. Trace brute : deux relevés se suivent-ils vraiment ?              */
/* ------------------------------------------------------------------ */

/** Vitesse au-delà de laquelle deux relevés ne peuvent pas être consécutifs à pied (m/s). */
export const TRACE_BREAK_SPEED_MS = 12;
/** Silence au-delà duquel on ne relie plus deux relevés (ms). */
export const TRACE_BREAK_GAP_MS = 180_000;
/** Bond au-delà duquel on ne relie plus deux relevés, quel que soit le délai (m). */
export const TRACE_BREAK_DISTANCE_M = 400;

export type TraceBreakReason = "speed" | "gap" | "distance";

export interface TraceBreak {
  /** Indice du premier point du nouveau tronçon. */
  index: number;
  distanceM: number;
  gapMs: number;
  reason: TraceBreakReason;
}

export interface SplitTrace {
  /** Tronçons continus, dans l'ordre. Chacun se dessine séparément. */
  segments: TrackPoint[][];
  breaks: TraceBreak[];
}

/**
 * Découpe la trace enregistrée là où deux relevés ne peuvent pas se suivre :
 * trop loin, trop tard, ou trop vite pour la marche. Le tracé est alors
 * INTERROMPU visuellement plutôt que rafistolé par une ligne droite — un tunnel,
 * une reprise de signal ou une mise en veille ne sont pas un itinéraire.
 */
export function splitTrace(points: readonly TrackPoint[]): SplitTrace {
  const segments: TrackPoint[][] = [];
  const breaks: TraceBreak[] = [];
  if (points.length === 0) return { segments, breaks };
  let current: TrackPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const distanceM = haversineM(a, b);
    const gapMs = Math.max(0, b.at - a.at);
    const speedMs = gapMs > 0 ? distanceM / (gapMs / 1000) : distanceM > 0 ? Infinity : 0;
    const reason: TraceBreakReason | null =
      distanceM > TRACE_BREAK_DISTANCE_M ? "distance" : gapMs > TRACE_BREAK_GAP_MS ? "gap" : speedMs > TRACE_BREAK_SPEED_MS ? "speed" : null;
    if (reason === null) {
      current.push(b);
      continue;
    }
    segments.push(current);
    breaks.push({ index: i, distanceM: Math.round(distanceM), gapMs, reason });
    current = [b];
  }
  segments.push(current);
  return { segments, breaks };
}

/** Tronçons d'au moins deux points, prêts à être dessinés (les autres n'ont rien à montrer). */
export function drawableTraceSegments(points: readonly TrackPoint[]): LngLat[][] {
  return splitTrace(points)
    .segments.filter((s) => s.length >= 2)
    .map((s) => s.map((p) => [p.lng, p.lat] as LngLat));
}
