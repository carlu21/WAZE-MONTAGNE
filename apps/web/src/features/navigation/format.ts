/** Petits formatages de l'écran de navigation. */
import { CornerDownLeft, CornerDownRight, CornerUpLeft, CornerUpRight, Flag, MoveUp, Undo2, type LucideIcon } from "lucide-react";
import { fr, formatDistance, type Instruction, type MatchOutput, type ManeuverType, type GpsQuality } from "@mountain-live/core";

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

/** « Sur : Sentier de Grotelle » / « Sur un sentier » / « Hors sentier ». */
export function describeMatch(output: MatchOutput | null): string {
  if (!output || !output.matched || !output.segment) return fr.navigation.offPath;
  if (output.confidence < 0.35) return fr.navigation.matchedLow;
  if (output.segment.name) return fr.navigation.onPath.replace("{name}", output.segment.name);
  return fr.navigation.onKind.replace("{kind}", fr.navigation.kinds[output.segment.kind] ?? fr.navigation.kinds.unknown);
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
