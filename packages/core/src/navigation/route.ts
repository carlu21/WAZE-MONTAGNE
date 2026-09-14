/**
 * Itinéraire actif (section 5) : construction depuis un sentier, une trace
 * GPX ou une trace enregistrée ; progression (distance faite / restante,
 * dénivelés) ; détection de sortie de parcours avec seuil adaptatif et
 * hystérésis temporelle (section 7).
 */
import type { LatLng, Trail } from "../types";
import { bearing, haversineM, type LngLat } from "../geo";
import { cumulativeDistances, pointAtAlong, projectOnPolyline } from "./geometry";
import type { GpsQuality, NavRoute } from "./types";

export interface BuildRouteInput {
  id: string;
  name: string;
  coordinates: LngLat[];
  elevations?: (number | null)[] | null;
  elevationGainM?: number | null;
  source: NavRoute["source"];
}

/** Seuil de lissage des dénivelés (m) : filtre le bruit altimétrique. */
export const ELEVATION_HYSTERESIS_M = 5;

export function buildRoute(input: BuildRouteInput): NavRoute {
  const coordinates = input.coordinates.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]));
  const cumulative = cumulativeDistances(coordinates);
  const elevations = input.elevations && input.elevations.length === coordinates.length ? input.elevations : null;
  const computedGain = elevations ? elevationGain(elevations, 0, elevations.length - 1).gain : null;
  return {
    id: input.id,
    name: input.name,
    coordinates,
    elevations,
    cumulative,
    lengthM: cumulative[cumulative.length - 1] ?? 0,
    elevationGainM: input.elevationGainM ?? computedGain,
    source: input.source,
  };
}

export function routeFromTrail(trail: Pick<Trail, "id" | "name" | "geometry" | "elevationGainM">): NavRoute | null {
  if (trail.geometry.type !== "LineString" || trail.geometry.coordinates.length < 2) return null;
  return buildRoute({ id: trail.id, name: trail.name, coordinates: trail.geometry.coordinates.map((c) => [c[0], c[1]]), elevationGainM: trail.elevationGainM, source: "trail" });
}

/** Itinéraire inversé (retour au point de départ, section 8). */
export function reverseRoute(route: NavRoute, id = `${route.id}:retour`, name = `Retour — ${route.name}`): NavRoute {
  return buildRoute({
    id,
    name,
    coordinates: [...route.coordinates].reverse(),
    elevations: route.elevations ? [...route.elevations].reverse() : null,
    source: route.source,
  });
}

/** Dénivelés positif / négatif entre deux indices, avec hystérésis. */
export function elevationGain(elevations: readonly (number | null)[], from: number, to: number, hysteresisM = ELEVATION_HYSTERESIS_M): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  let ref: number | null = null;
  for (let i = Math.max(0, from); i <= Math.min(to, elevations.length - 1); i++) {
    const e = elevations[i];
    if (e === null || !Number.isFinite(e)) continue;
    if (ref === null) {
      ref = e;
      continue;
    }
    const d = e - ref;
    if (d >= hysteresisM) {
      gain += d;
      ref = e;
    } else if (d <= -hysteresisM) {
      loss += -d;
      ref = e;
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

export interface RouteProgress {
  /** Abscisse (m) sur l'itinéraire. */
  along: number;
  doneM: number;
  remainingM: number;
  /** Fraction parcourue 0..1. */
  fraction: number;
  distanceToRouteM: number;
  snapped: LatLng;
  /** Indice du sommet de départ du segment courant. */
  index: number;
  /** Position fractionnaire sur ce segment (0..1). */
  t: number;
  /** Cap de l'itinéraire à cet endroit (degrés). */
  routeBearing: number;
  gainDoneM: number | null;
  gainRemainingM: number | null;
  lossRemainingM: number | null;
}

/** Fenêtre de recherche autour de la progression connue (m) : gère boucles et allers-retours. */
const WINDOW_BACK_M = 300;
const WINDOW_AHEAD_M = 2000;
const WINDOW_ACCEPT_M = 60;

function indexAtAlong(cumulative: readonly number[], along: number): number {
  let lo = 0;
  let hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid] <= along) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Progression sur l'itinéraire. Si `lastAlong` est connu, la recherche
 * privilégie une fenêtre autour de la progression précédente afin de ne pas
 * sauter sur la branche retour d'une boucle ; sinon (ou si rien de proche
 * n'est trouvé dans la fenêtre), recherche globale.
 */
export function projectOnRoute(route: NavRoute, point: LatLng, lastAlong: number | null = null): RouteProgress | null {
  const { coordinates, cumulative } = route;
  if (coordinates.length < 2) return null;
  let proj = null;
  if (lastAlong !== null) {
    const from = indexAtAlong(cumulative, Math.max(0, lastAlong - WINDOW_BACK_M));
    const to = indexAtAlong(cumulative, Math.min(route.lengthM, lastAlong + WINDOW_AHEAD_M));
    const windowed = projectOnPolyline(point, coordinates, cumulative, { from, to: Math.max(from, to) });
    if (windowed && windowed.distanceM <= WINDOW_ACCEPT_M) proj = windowed;
    else {
      const global = projectOnPolyline(point, coordinates, cumulative);
      proj = global && windowed && global.distanceM >= windowed.distanceM * 0.5 ? windowed : global;
    }
  } else {
    proj = projectOnPolyline(point, coordinates, cumulative);
  }
  if (!proj) return null;
  const along = proj.along;
  const remainingM = Math.max(0, route.lengthM - along);
  const fraction = route.lengthM > 0 ? along / route.lengthM : 1;
  let gainDoneM: number | null = null;
  let gainRemainingM: number | null = null;
  let lossRemainingM: number | null = null;
  if (route.elevations) {
    const el = route.elevations;
    const done = elevationGain(el, 0, proj.index);
    const rest = elevationGain(el, proj.index + 1, el.length - 1);
    // Part du segment courant, interpolée (sans hystérésis).
    const e0 = el[proj.index];
    const e1 = el[proj.index + 1];
    const delta = e0 !== null && e1 !== null && e0 !== undefined && e1 !== undefined ? e1 - e0 : 0;
    gainDoneM = Math.round(done.gain + Math.max(0, delta) * proj.t);
    gainRemainingM = Math.round(rest.gain + Math.max(0, delta) * (1 - proj.t));
    lossRemainingM = Math.round(rest.loss + Math.max(0, -delta) * (1 - proj.t));
  } else if (route.elevationGainM !== null) {
    gainDoneM = Math.round(route.elevationGainM * fraction);
    gainRemainingM = Math.round(route.elevationGainM * (1 - fraction));
  }
  const aheadPoint = pointAtAlong(coordinates, cumulative, Math.min(route.lengthM, along + 20));
  const routeBearing = haversineM(proj.snapped, aheadPoint) > 1 ? bearing(proj.snapped, aheadPoint) : proj.segmentBearing;
  return {
    along,
    doneM: along,
    remainingM,
    fraction,
    distanceToRouteM: proj.distanceM,
    snapped: proj.snapped,
    index: proj.index,
    t: proj.t,
    routeBearing,
    gainDoneM,
    gainRemainingM,
    lossRemainingM,
  };
}

/* ------------------------------------------------------------------ */
/* Sortie d'itinéraire (section 7)                                     */
/* ------------------------------------------------------------------ */

export interface OffRouteState {
  offRoute: boolean;
  /** Relevés consécutifs au-delà du seuil (ou en deçà, quand on est hors parcours). */
  consecutive: number;
  /** Début de la série de relevés hors seuil. */
  sinceAt: number | null;
  /** Dernier seuil appliqué (affichage / débogage). */
  thresholdM: number;
}

export function createOffRouteState(): OffRouteState {
  return { offRoute: false, consecutive: 0, sinceAt: null, thresholdM: 30 };
}

export interface OffRouteThresholdInput {
  accuracy: number | null;
  /** Nombre de chemins à moins de 100 m (densité). */
  density: number;
  widthM: number | null;
  quality: GpsQuality;
}

/**
 * Seuil adaptatif (m) : 30 m de base, élargi par la précision GPS (au-delà de 10 m), la largeur
 * du chemin, la densité de sentiers (chemins parallèles) et un signal faible.
 */
export function offRouteThresholdM(input: OffRouteThresholdInput): number {
  let t = 30;
  if (input.accuracy !== null && Number.isFinite(input.accuracy)) t += Math.min(20, 0.5 * Math.max(0, input.accuracy - 10));
  if (input.widthM !== null && Number.isFinite(input.widthM)) t += input.widthM / 2;
  if (input.density >= 4) t += 10;
  if (input.quality === "poor") t += 15;
  return Math.round(Math.min(90, Math.max(30, t)));
}

export interface OffRouteOptions {
  /** Relevés consécutifs hors seuil avant l'alerte (défaut 3). */
  requiredFixes?: number;
  /** Durée minimale hors seuil avant l'alerte (défaut 12 s). */
  minDurationMs?: number;
}

/**
 * Met à jour l'état : on ne bascule « hors itinéraire » qu'après plusieurs
 * relevés consécutifs au-delà du seuil pendant une durée minimale ; le retour
 * est acquis dès deux relevés à moins de 70 % du seuil.
 */
export function updateOffRoute(state: OffRouteState, distanceM: number, thresholdM: number, now: number, opts: OffRouteOptions = {}): OffRouteState {
  const requiredFixes = opts.requiredFixes ?? 3;
  const minDurationMs = opts.minDurationMs ?? 12_000;
  if (!state.offRoute) {
    if (distanceM > thresholdM) {
      const consecutive = state.consecutive + 1;
      const sinceAt = state.sinceAt ?? now;
      const offRoute = consecutive >= requiredFixes && now - sinceAt >= minDurationMs;
      return { offRoute, consecutive: offRoute ? 0 : consecutive, sinceAt: offRoute ? null : sinceAt, thresholdM };
    }
    return { offRoute: false, consecutive: 0, sinceAt: null, thresholdM };
  }
  if (distanceM <= thresholdM * 0.7) {
    const consecutive = state.consecutive + 1;
    if (consecutive >= 2) return { offRoute: false, consecutive: 0, sinceAt: null, thresholdM };
    return { ...state, consecutive, thresholdM };
  }
  return { ...state, consecutive: 0, thresholdM };
}

/** Consigne de retour au parcours : point le plus proche, distance et cap. */
export function returnGuidance(route: NavRoute, point: LatLng, lastAlong: number | null): { target: LatLng; distanceM: number; bearing: number; along: number } | null {
  const p = projectOnRoute(route, point, lastAlong);
  if (!p) return null;
  return { target: p.snapped, distanceM: Math.round(p.distanceToRouteM), bearing: Math.round(bearing(point, p.snapped)), along: p.along };
}

/** « nord », « nord-est »… pour une consigne vocale. */
export function compassLabel(bearingDeg: number): string {
  const labels = ["le nord", "le nord-est", "l'est", "le sud-est", "le sud", "le sud-ouest", "l'ouest", "le nord-ouest"];
  const idx = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return labels[idx];
}
