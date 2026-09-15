/** Petits formatages de l'écran de navigation. */
import { CornerDownLeft, CornerDownRight, CornerUpLeft, CornerUpRight, Flag, MoveUp, Undo2, type LucideIcon } from "lucide-react";
import {
  fr,
  formatDistance,
  trailVerdict,
  type GpsQuality,
  type Instruction,
  type ManeuverType,
  type MatchOutput,
  type PositionTrust,
  type TrailVerdict,
} from "@mountain-live/core";

export function maneuverIcon(type: ManeuverType | null | undefined): LucideIcon {
  switch (type) {
    case "left":
    case "slight_left":
      return CornerUpLeft;
    case "right":
    case "slight_right":
      return CornerUpRight;
    case "sharp_left":
      return CornerDownLeft;
    case "sharp_right":
      return CornerDownRight;
    case "uturn":
      return Undo2;
    case "arrive":
      return Flag;
    default:
      return MoveUp;
  }
}

export interface TrailLabelInput {
  output: MatchOutput | null;
  trust: PositionTrust;
  /** Segments du réseau chargés autour : sans réseau, aucun jugement possible. */
  networkSegments: number;
  /** Relevés successifs loin de tout chemin. */
  consecutiveOffTrail: number;
}

/**
 * Rattachement au sentier — et rien de plus que ce que l'on sait.
 *
 * « Hors sentier » n'apparaît JAMAIS tant que les trois conditions ne sont pas
 * réunies (GPS précis, réseau chargé, matching effectué) ET que plusieurs
 * relevés successifs ne concordent pas. Tant que le doute subsiste, la phrase
 * est « Position en cours d'acquisition » — pas une accusation.
 *
 * `null` = on n'affiche rien du tout : une puce vide vaut mieux qu'une
 * affirmation fausse.
 */
export function trailLabel(input: TrailLabelInput): string | null {
  const { output } = input;
  const verdict: TrailVerdict = trailVerdict({
    trust: input.trust,
    networkSegments: input.networkSegments,
    matchAttempted: output !== null,
    matched: output?.matched ?? false,
    confidence: output?.confidence ?? 0,
    distanceToPathM: output?.distanceToPathM ?? Infinity,
    consecutiveOff: input.consecutiveOffTrail,
  });
  switch (verdict) {
    case "unknown":
      return input.trust === "reliable" ? null : fr.navigation.positionAcquiring;
    case "off_trail":
      return fr.navigation.leftTrail;
    case "uncertain":
      return output?.matched ? fr.navigation.matchedLow : null;
    case "on_trail":
      if (output?.segment?.name) return fr.navigation.onPath.replace("{name}", output.segment.name);
      return fr.navigation.onKind.replace("{kind}", fr.navigation.kinds[output?.segment?.kind ?? "unknown"] ?? fr.navigation.kinds.unknown);
  }
}

/** Précision, dite discrètement : « ± 6 m ». Jamais une promesse de certitude. */
export function accuracyLabel(accuracy: number | null): string {
  if (accuracy === null || !Number.isFinite(accuracy)) return "GPS";
  return `GPS ± ${Math.round(accuracy)} m`;
}

export function qualityLabel(q: GpsQuality, accuracy: number | null): string {
  if (q === "lost") return fr.navigation.gpsLost;
  if (q === "poor") return fr.navigation.gpsWeak;
  return accuracy !== null ? fr.navigation.accuracy.replace("{distance}", formatDistance(accuracy).replace(/^10 m$/, `${Math.round(accuracy)} m`)) : "GPS";
}

export function qualityTone(q: GpsQuality): "success" | "warning" | "danger" | "muted" {
  return q === "good" ? "success" : q === "fair" ? "warning" : q === "poor" ? "danger" : "muted";
}

export function instructionOrDefault(instruction: Instruction | null, freeMode: boolean): string {
  if (instruction) return instruction.text;
  return freeMode ? fr.navigation.instructions.freeMode : fr.navigation.gpsWaiting;
}

export function formatAltitude(m: number | null | undefined): string {
  return m === null || m === undefined || !Number.isFinite(m) ? "—" : `${Math.round(m)} m`;
}
