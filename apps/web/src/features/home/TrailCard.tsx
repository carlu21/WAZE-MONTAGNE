/**
 * Carte d'une randonnée proche (sections 11, 19, 20 du cahier des charges).
 *
 * Hiérarchie de lecture, dans cet ordre : le nom, puis **à quelle distance de
 * moi est le départ**, puis les caractéristiques de la randonnée elle-même.
 * Les deux distances ne se touchent jamais dans la mise en page — l'approche
 * est sur sa propre ligne, avec son icône et sa couleur ; la longueur vit dans
 * la ligne des chiffres du parcours.
 *
 * Un signalement actif remonte en haut de la carte : c'est ce qui distingue
 * cette application d'une application de randonnée ordinaire (section 20).
 */
import { MapPin, Mountain, TriangleAlert, Users } from "lucide-react";
import type { NearbyTrail } from "@mountain-live/core";
import { Badge, cn } from "@/components/ui";
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_TONE,
  SHAPE_LABELS,
  approachLabel,
  durationLabel,
  elevationLabel,
  frequentationLabel,
  lengthLabel,
} from "./format";

export interface TrailCardProps {
  trail: NearbyTrail;
  selected?: boolean;
  onSelect: (id: string) => void;
  /** Disposition : carte du carrousel horizontal, ou ligne de la liste développée. */
  layout?: "card" | "row";
}

export function TrailCard({ trail, selected = false, onSelect, layout = "card" }: TrailCardProps) {
  const frequentation = frequentationLabel(trail.frequentation, trail.passagesToday);
  return (
    <button
      type="button"
      onClick={() => onSelect(trail.id)}
      aria-pressed={selected}
      data-testid={`trail-card-${trail.id}`}
      className={cn(
        "flex flex-col rounded-2xl border bg-surface text-left transition-shadow",
        layout === "card" ? "gap-1 p-2.5" : "gap-1.5 p-3",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
        selected ? "border-primary shadow-md" : "border-line/70 shadow-sm",
        layout === "card" ? "w-[264px] shrink-0 snap-start" : "w-full",
      )}
    >
      {trail.activeReports > 0 && (
        <Badge tone="accent" size="sm" className="self-start" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
          {trail.reportHint ?? `${trail.activeReports} signalement${trail.activeReports > 1 ? "s" : ""}`}
        </Badge>
      )}

      <h3 className={cn("font-bold leading-tight text-fg", layout === "card" ? "line-clamp-1 text-[15px]" : "line-clamp-2 text-[16px]")}>
        {trail.name}
      </h3>

      {/* DISTANCE 1 — de vous au départ. Sa ligne, son icône, sa couleur. */}
      <p className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-primary">
        <MapPin className="size-3.5 shrink-0" aria-hidden />
        {approachLabel(trail.approachM)}
      </p>

      {/* DISTANCE 2 et le reste du parcours. */}
      <p className="tabular flex flex-wrap items-baseline gap-x-1.5 text-[13.5px] text-fg">
        <span className="font-bold">{lengthLabel(trail.lengthM)}</span>
        <span className="text-muted" aria-hidden>·</span>
        <span>{durationLabel(trail.durationMs, trail.durationObserved)}</span>
        <span className="text-muted" aria-hidden>·</span>
        <span className="inline-flex items-center gap-0.5">
          <Mountain className="size-3.5 text-muted" aria-hidden />
          {elevationLabel(trail.elevationGainM)}
        </span>
      </p>

      <p className="flex flex-wrap items-center gap-1.5">
        <Badge tone={DIFFICULTY_TONE[trail.difficulty]} size="sm">
          {DIFFICULTY_LABELS[trail.difficulty]}
        </Badge>
        <span className="text-[12px] text-muted">{SHAPE_LABELS[trail.shape]}</span>
        {frequentation && (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted">
            <Users className="size-3.5" aria-hidden />
            {frequentation}
          </span>
        )}
      </p>
    </button>
  );
}
