/**
 * Navigation pas à pas (sections 4 et 6) : manœuvres déduites de la
 * géométrie de l'itinéraire (changements de cap) et du graphe des chemins
 * (intersections), puis instruction courante selon la progression.
 */
import { formatDistance } from "../geo";
import { fr, interpolate } from "../i18n";
import type { LatLng } from "../types";
import { bearingBetweenAlong, headingDelta, pointAtAlong } from "./geometry";
import { junctionsNear, type PathGraph } from "./graph";
import type { NavRoute } from "./types";

export type ManeuverType =
  | "depart"
  | "straight"
  | "slight_left"
  | "slight_right"
  | "left"
  | "right"
  | "sharp_left"
  | "sharp_right"
  | "uturn"
  | "arrive";

export interface Maneuver {
  along: number;
  type: ManeuverType;
  /** Manœuvre à une intersection du réseau (sinon : virage naturel du sentier). */
  atJunction: boolean;
  position: LatLng;
  /** Changement de cap signé (degrés, gauche < 0). */
  angle: number;
}

export interface ManeuverOptions {
  /** Longueur (m) sur laquelle les caps avant / après sont mesurés. */
  lookM?: number;
  /** Rayon (m) de détection d'une intersection autour d'un sommet. */
  junctionRadiusM?: number;
  /** Angle minimal (degrés) d'un virage naturel sans intersection. */
  bendMinAngle?: number;
  /** Angle minimal (degrés) d'un virage à une intersection. */
  junctionMinAngle?: number;
}

const DEFAULTS: Required<ManeuverOptions> = { lookM: 15, junctionRadiusM: 12, bendMinAngle: 70, junctionMinAngle: 25 };

function classify(angle: number, atJunction: boolean): ManeuverType | null {
  const a = Math.abs(angle);
  const left = angle < 0;
  if (a >= 150) return "uturn";
  if (atJunction) {
    if (a < 25) return "straight";
    if (a < 60) return left ? "slight_left" : "slight_right";
    if (a < 135) return left ? "left" : "right";
    return left ? "sharp_left" : "sharp_right";
  }
  if (a < 135) return left ? "left" : "right";
  return left ? "sharp_left" : "sharp_right";
}

/**
 * Manœuvres le long de l'itinéraire. À chaque sommet, le cap « avant » et le
 * cap « après » sont mesurés sur `lookM` mètres (robuste aux petits segments).
 * Avec un graphe, une intersection à proximité du sommet rend la manœuvre
 * explicite même pour un angle modéré, et « tout droit » est signalé pour ne
 * pas s'engager sur la branche. Les manœuvres à moins de 20 m sont fusionnées.
 */
export function computeManeuvers(route: NavRoute, graph: PathGraph | null = null, options: ManeuverOptions = {}): Maneuver[] {
  const o = { ...DEFAULTS, ...options };
  const { coordinates, cumulative, lengthM } = route;
  const out: Maneuver[] = [];
  if (coordinates.length < 2) return out;
  out.push({ along: 0, type: "depart", atJunction: false, position: { lng: coordinates[0][0], lat: coordinates[0][1] }, angle: 0 });

  const seenJunctions = new Set<string>();
  for (let i = 1; i < coordinates.length - 1; i++) {
    const along = cumulative[i];
    if (along < o.lookM || lengthM - along < o.lookM) continue;
    const before = bearingBetweenAlong(coordinates, cumulative, along - o.lookM, along);
    const after = bearingBetweenAlong(coordinates, cumulative, along, along + o.lookM);
    const angle = headingDelta(before, after);
    const position = { lng: coordinates[i][0], lat: coordinates[i][1] };
    let atJunction = false;
    if (graph) {
      const js = junctionsNear(graph, position, o.junctionRadiusM);
      const fresh = js.find((j) => !seenJunctions.has(j.key));
      if (fresh) {
        atJunction = true;
        for (const j of js) seenJunctions.add(j.key);
      }
    }
    const a = Math.abs(angle);
    if (!atJunction && a < o.bendMinAngle) continue;
    if (atJunction && a < o.junctionMinAngle) {
      out.push({ along, type: "straight", atJunction: true, position, angle });
      continue;
    }
    const type = classify(angle, atJunction);
    if (!type) continue;
    out.push({ along, type, atJunction, position, angle });
  }
  out.push({ along: lengthM, type: "arrive", atJunction: false, position: pointAtAlong(coordinates, cumulative, lengthM), angle: 0 });

  // Fusion des manœuvres trop proches : on garde l'angle le plus marqué.
  const merged: Maneuver[] = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && m.along - last.along < 20 && last.type !== "depart" && m.type !== "arrive") {
      if (Math.abs(m.angle) > Math.abs(last.angle)) merged[merged.length - 1] = m;
      continue;
    }
    merged.push(m);
  }
  return merged;
}

export interface Instruction {
  /** Phrase complète (« Tournez à gauche dans 80 m »). */
  text: string;
  /** Distance jusqu'à la manœuvre (m). */
  distanceM: number;
  type: ManeuverType;
  /** Clé de dédoublonnage vocal (manœuvre + palier). */
  key: string;
  maneuver: Maneuver | null;
}

/** Distance (m) sous laquelle la consigne devient immédiate (« Prenez le sentier à gauche »). */
export const NOW_DISTANCE_M = 25;
/** Distance (m) au-delà de laquelle on annonce « Continuez sur ce sentier pendant … ». */
export const FAR_DISTANCE_M = 150;

function dirLabel(type: ManeuverType): string {
  return type.endsWith("left") ? fr.navigation.instructions.left : fr.navigation.instructions.right;
}

export function maneuverText(m: Maneuver, distanceM: number): string {
  const I = fr.navigation.instructions;
  const near = distanceM <= NOW_DISTANCE_M;
  const distance = formatDistance(distanceM);
  const dir = dirLabel(m.type);
  switch (m.type) {
    case "arrive":
      return near ? I.arrived : interpolate(I.arriveIn, { distance });
    case "uturn":
      return near ? I.uturnNow : interpolate(I.uturnIn, { distance });
    case "straight":
      return near ? I.straightJunctionNow : interpolate(I.straightJunctionIn, { distance });
    case "slight_left":
    case "slight_right":
      return near ? interpolate(I.slightNow, { dir }) : interpolate(I.slightIn, { dir, distance });
    case "sharp_left":
    case "sharp_right":
      return near ? interpolate(I.sharpNow, { dir }) : interpolate(I.sharpIn, { dir, distance });
    case "left":
    case "right":
      if (!m.atJunction) return near ? interpolate(I.bendNow, { dir }) : interpolate(I.bendIn, { dir, distance });
      return near ? interpolate(I.turnNow, { dir }) : interpolate(I.turnIn, { dir, distance });
    default:
      return interpolate(I.continueFor, { distance });
  }
}

/** Palier d'annonce d'une manœuvre selon la distance (dédoublonnage vocal). */
export function announcementStep(distanceM: number): number {
  if (distanceM <= NOW_DISTANCE_M) return 3;
  if (distanceM <= 80) return 2;
  if (distanceM <= 200) return 1;
  return 0;
}

/**
 * Instruction courante : prochaine manœuvre devant soi (les manœuvres
 * dépassées de plus de 10 m sont ignorées). Loin de toute manœuvre :
 * « Continuez sur ce sentier pendant X ».
 */
export function currentInstruction(maneuvers: readonly Maneuver[], along: number): Instruction | null {
  const next = maneuvers.find((m) => m.type !== "depart" && m.along - along >= -10);
  if (!next) return null;
  const distanceM = Math.max(0, Math.round(next.along - along));
  const step = announcementStep(distanceM);
  if (next.type !== "arrive" && distanceM > FAR_DISTANCE_M) {
    return { text: interpolate(fr.navigation.instructions.continueFor, { distance: formatDistance(distanceM) }), distanceM, type: "straight", key: `far:${Math.round(next.along)}`, maneuver: next };
  }
  return { text: maneuverText(next, distanceM), distanceM, type: next.type, key: `${Math.round(next.along)}:${next.type}:${step}`, maneuver: next };
}
