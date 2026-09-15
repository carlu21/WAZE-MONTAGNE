/**
 * Réglages de la carte de fréquentation (section 12) : période, activité,
 * légende. Panneau compact posé sur la carte, refermable d'un tap.
 */
import { Activity, X } from "lucide-react";
import { fr, type ActivityMode, type HeatmapPeriod, type HeatmapResponse } from "@mountain-live/core";
import { Chip, IconButton } from "@/components/ui";
import { useUiStore } from "@/store/ui";
import { FREQUENTATION_COLORS } from "./heatmap";
import { HEATMAP_MIN_ZOOM } from "./useHeatmap";

const PERIODS: { value: HeatmapPeriod; label: string }[] = [
  { value: "today", label: fr.network.frequentation.periods.today },
  { value: "week", label: fr.network.frequentation.periods.week },
  { value: "month", label: fr.network.frequentation.periods.month },
  { value: "year", label: fr.network.frequentation.periods.year },
  { value: "all", label: fr.network.frequentation.periods.all },
];

const ACTIVITIES: { value: ActivityMode | "all"; label: string }[] = [
  { value: "all", label: fr.common.all },
  { value: "hiking", label: fr.navigation.activities.hiking },
  { value: "trail", label: fr.navigation.activities.trail },
  { value: "mtb", label: fr.navigation.activities.mtb },
  { value: "equestrian", label: fr.navigation.activities.equestrian },
];

export interface HeatmapControlsProps {
  data: HeatmapResponse | null;
  loading: boolean;
  zoomedOut: boolean;
  onClose: () => void;
}

export function HeatmapControls({ data, loading, zoomedOut, onClose }: HeatmapControlsProps) {
  const { period, activity } = useUiStore((s) => s.heatmap);
  const setHeatmap = useUiStore((s) => s.setHeatmap);
  const coverage = data ? Math.round(data.coverage * 100) : null;

  return (
    <div className="glass-strong pointer-events-auto w-[min(360px,calc(100vw-24px))] rounded-2xl p-3 shadow-lg" data-testid="heatmap-controls">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-[15px] font-bold text-fg">
          <Activity className="size-4 text-accent" aria-hidden="true" />
          {fr.network.title}
        </h2>
        <IconButton aria-label={fr.common.close} variant="ghost" size={44} onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <p className="mb-2 text-[13px] leading-snug text-muted">{fr.network.frequentation.legend}</p>

      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={fr.network.frequentation.title}>
        {PERIODS.map((p) => (
          <Chip key={p.value} selected={period === p.value} onClick={() => setHeatmap({ period: p.value })} data-testid={`heat-period-${p.value}`}>
            {p.label}
          </Chip>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={fr.navigation.activity}>
        {ACTIVITIES.map((a) => (
          <Chip key={a.value} selected={activity === a.value} onClick={() => setHeatmap({ activity: a.value })} data-testid={`heat-activity-${a.value}`}>
            {a.label}
          </Chip>
        ))}
      </div>

      <div className="flex items-center gap-1.5" aria-hidden="true">
        {(["very_low", "low", "moderate", "high", "very_high"] as const).map((level) => (
          <span key={level} className="h-2 flex-1 rounded-full" style={{ background: FREQUENTATION_COLORS[level] }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span>{fr.network.frequentation.levels.very_low}</span>
        <span>{fr.network.frequentation.levels.very_high}</span>
      </div>

      <p className="mt-2 text-[12px] leading-snug text-muted" aria-live="polite">
        {zoomedOut
          ? `Zoomez (niveau ${HEATMAP_MIN_ZOOM}) pour voir la fréquentation des chemins.`
          : loading
            ? fr.common.loading
            : coverage !== null
              ? `${data?.segments.length ?? 0} chemins · ${coverage} % du réseau visible dispose de passages enregistrés.`
              : fr.network.frequentation.insufficient}
      </p>
    </div>
  );
}
