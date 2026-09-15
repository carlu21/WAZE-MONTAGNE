/**
 * Boucle de navigation (sections 1, 5, 7, 8, 11) : à chaque relevé GPS,
 * enchaîne map matching, progression sur l'itinéraire, détection de sortie de
 * parcours, instruction courante, alertes devant soi et enregistrement de la
 * trace. Réducteur pur : (état, contexte, relevé) → (nouvel état, résultat).
 */
import type { OfficialAlert, Report, WaterPoint } from "../types";
import { collectFreeEvents, computeAheadAlerts, nextEventAhead, type AheadAlert, type RouteEvent } from "./events";
import type { PathGraph } from "./graph";
import { pathDensity } from "./graph";
import { currentInstruction, type Instruction, type Maneuver } from "./instructions";
import { createMatchState, matchFix, type MatchOutput, type MatchState } from "./matcher";
import { createOffRouteState, offRouteThresholdM, projectOnRoute, updateOffRoute, type OffRouteState, type RouteProgress } from "./route";
import { acceptTrackPoint, toTrackPoint } from "./track";
import type { ActivityMode, GpsFix, NavRoute, TrackPoint } from "./types";
import type { RawPoint } from "../network/types";

export interface NavContext {
  graph: PathGraph;
  activity: ActivityMode;
  route: NavRoute | null;
  /** Manœuvres précalculées pour `route` (computeManeuvers). */
  maneuvers: readonly Maneuver[];
  /** Événements précalculés sur `route` (collectRouteEvents). */
  events: readonly RouteEvent[];
  /** Sources des événements en mode libre. */
  reports?: readonly Report[];
  officialAlerts?: readonly OfficialAlert[];
  waterPoints?: readonly WaterPoint[];
  /** Cap boussole (degrés) si le téléphone le fournit. */
  compassHeading?: number | null;
  /** Distance (m) d'arrivée. Défaut 25. */
  arrivalM?: number;
}

export interface NavState {
  match: MatchState;
  routeAlong: number | null;
  progress: RouteProgress | null;
  offRoute: OffRouteState;
  /** Palier annoncé par événement. */
  announced: Map<string, number>;
  /**
   * Trace d'affichage (fil d'Ariane) : position retenue, donc rattachée au
   * chemin quand la confiance est bonne.
   */
  track: TrackPoint[];
  /**
   * Trace BRUTE : tout relevé reçu, jamais corrigé (section 5 du moteur
   * cartographique). C'est elle qui est envoyée au serveur si l'utilisateur
   * contribue, et elle ne doit jamais être écrasée par la trace corrigée.
   */
  raw: RawPoint[];
  /** Vitesse moyenne lissée en mouvement (m/s). */
  movingSpeedMs: number | null;
  lastInstructionKey: string | null;
  arrived: boolean;
  startedAt: number | null;
  /** Relevés traités. */
  fixes: number;
}

export interface NavStep {
  state: NavState;
  output: MatchOutput;
  progress: RouteProgress | null;
  instruction: Instruction | null;
  /** L'instruction est nouvelle (à annoncer). */
  announceInstruction: boolean;
  alerts: AheadAlert[];
  /** Transition « hors itinéraire » / « de retour sur l'itinéraire ». */
  offRouteChange: "left" | "back" | null;
  /** Arrivée atteinte à ce relevé. */
  justArrived: boolean;
  trackPointAdded: boolean;
  nextEvent: { event: RouteEvent; distanceM: number } | null;
  /** Événements considérés à ce relevé (itinéraire ou cône devant soi). */
  events: RouteEvent[];
}

export function createNavState(): NavState {
  return {
    match: createMatchState(),
    routeAlong: null,
    progress: null,
    offRoute: createOffRouteState(),
    announced: new Map(),
    track: [],
    raw: [],
    movingSpeedMs: null,
    lastInstructionKey: null,
    arrived: false,
    startedAt: null,
    fixes: 0,
  };
}

const SPEED_EMA = 0.15;

export function navigationStep(state: NavState, ctx: NavContext, fix: GpsFix, now: number = fix.at): NavStep {
  const matched = matchFix(state.match, fix, ctx.graph, { activity: ctx.activity, route: ctx.route }, ctx.compassHeading ?? null, now);
  const output = matched.output;

  let movingSpeedMs = state.movingSpeedMs;
  if (output.speedMs !== null && output.speedMs >= 0.3) {
    movingSpeedMs = movingSpeedMs === null ? output.speedMs : movingSpeedMs + SPEED_EMA * (output.speedMs - movingSpeedMs);
  }

  // Trace brute : tout relevé est conservé tel quel, sans filtrage ni correction.
  const raw: RawPoint[] = [
    ...state.raw,
    { lat: fix.lat, lng: fix.lng, alt: fix.altitude, at: fix.at, accuracy: fix.accuracy, speed: fix.speed, heading: fix.heading },
  ];

  // Trace d'affichage : position retenue (rattachée au chemin quand la confiance est bonne).
  const last = state.track[state.track.length - 1] ?? null;
  const trackPointAdded = acceptTrackPoint(last, fix);
  const track = trackPointAdded ? [...state.track, toTrackPoint(fix, output.matched && output.confidence >= 0.5 ? output.position : output.raw)] : state.track;

  let progress: RouteProgress | null = null;
  let routeAlong = state.routeAlong;
  let offRoute = state.offRoute;
  let offRouteChange: NavStep["offRouteChange"] = null;
  let instruction: Instruction | null = null;
  let announceInstruction = false;
  let events: RouteEvent[] = [];
  let alerts: AheadAlert[] = [];
  let justArrived = false;
  let arrived = state.arrived;
  const announced = new Map(state.announced);

  if (ctx.route) {
    progress = projectOnRoute(ctx.route, output.position, state.routeAlong);
    if (progress) {
      // On ne recule pas sur l'itinéraire pour un simple bruit (< 15 m), sauf vrai retour.
      routeAlong = progress.along;
      const threshold = offRouteThresholdM({
        accuracy: fix.accuracy,
        density: pathDensity(ctx.graph, output.position, 100),
        widthM: output.segment?.widthM ?? null,
        quality: output.quality,
      });
      const next = updateOffRoute(state.offRoute, progress.distanceToRouteM, threshold, now);
      if (next.offRoute !== state.offRoute.offRoute) offRouteChange = next.offRoute ? "left" : "back";
      offRoute = next;

      if (!arrived && progress.remainingM <= (ctx.arrivalM ?? 25) && progress.fraction > 0.9) {
        arrived = true;
        justArrived = true;
      }
      instruction = currentInstruction(ctx.maneuvers, progress.along);
      if (instruction && instruction.key !== state.lastInstructionKey && !offRoute.offRoute) announceInstruction = true;
      events = ctx.events as RouteEvent[];
      if (!offRoute.offRoute) alerts = computeAheadAlerts(events, progress.along, announced);
    }
  } else {
    events = collectFreeEvents(output.position, output.heading, { reports: ctx.reports, officialAlerts: ctx.officialAlerts, waterPoints: ctx.waterPoints, now });
    alerts = computeAheadAlerts(events, 0, announced);
  }
  for (const a of alerts) announced.set(a.key, a.level);

  const nextEvent = ctx.route && progress ? nextEventAhead(events, progress.along) : events.length ? { event: events[0], distanceM: Math.round(events[0].along) } : null;

  const nextState: NavState = {
    match: matched.state,
    routeAlong,
    progress,
    offRoute,
    announced,
    track,
    raw,
    movingSpeedMs,
    lastInstructionKey: announceInstruction && instruction ? instruction.key : state.lastInstructionKey,
    arrived,
    startedAt: state.startedAt ?? fix.at,
    fixes: state.fixes + 1,
  };
  return { state: nextState, output, progress, instruction, announceInstruction, alerts, offRouteChange, justArrived, trackPointAdded, nextEvent, events };
}

/**
 * Cadence des relevés par mode de suivi (section 2).
 *
 * - `highAccuracy` est toujours vrai : en montagne, sans réseau mobile ni
 *   Wi-Fi, la localisation approchée ne donne rien ; l'économie de batterie
 *   vient de l'espacement des relevés (`intervalMs`), pas de la dégradation
 *   du récepteur.
 * - `maximumAgeMs` reste à 0 : une position en cache renvoyée plusieurs fois
 *   ferait croire à un signal figé.
 * - `staleAfterMs` : silence au-delà duquel le signal est déclaré perdu et la
 *   veille relance l'écoute (trois relevés manqués, au moins 20 s).
 */
export const TRACKING_PROFILES = {
  eco: { intervalMs: 15_000, highAccuracy: true, maximumAgeMs: 0, staleAfterMs: 45_000 },
  normal: { intervalMs: 5_000, highAccuracy: true, maximumAgeMs: 0, staleAfterMs: 25_000 },
  precise: { intervalMs: 1_000, highAccuracy: true, maximumAgeMs: 0, staleAfterMs: 20_000 },
} as const;
