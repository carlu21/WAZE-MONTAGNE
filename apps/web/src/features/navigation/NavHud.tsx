/**
 * Affichage tête haute de la navigation (section 19) : instruction courante,
 * prochain événement, état du GPS et du chemin en haut ; distances, altitude,
 * vitesse, arrivée et boutons d'action en bas. Rien d'autre pendant l'activité.
 */
import { LocateFixed, Pause, Play, Square, Undo2 } from "lucide-react";
import { estimateEta, formatClock, formatDistance, formatDurationShort, formatSpeedKmh, fr, interpolate, type NavRoute } from "@mountain-live/core";
import { Fab, IconButton } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { describeMatch, formatAltitude, instructionOrDefault, maneuverIcon, qualityLabel, qualityTone } from "./format";
import { useNavigationStore } from "./store";

export interface NavHudProps {
  route: NavRoute | null;
  returnGuidanceText: string | null;
  onRecenter: () => void;
  onReport: () => void;
  onBacktrack: () => void;
  onPauseToggle: () => void;
  onStop: () => void;
}

const TONE_DOT: Record<ReturnType<typeof qualityTone>, string> = { success: "bg-success", warning: "bg-warning", danger: "bg-danger", muted: "bg-muted" };

export function NavHud({ route, returnGuidanceText, onRecenter, onReport, onBacktrack, onPauseToggle, onStop }: NavHudProps) {
  const status = useNavigationStore((s) => s.status);
  const live = useNavigationStore((s) => s.live);
  const activity = useNavigationStore((s) => s.activity);
  const follow = useNavigationStore((s) => s.follow);
  const session = useNavigationStore((s) => s.session);
  const { output, progress, instruction, nextEvent, quality, stats, movingSpeedMs, offRoute, arrived } = live;

  const Icon = maneuverIcon(instruction?.type);
  const headline = offRoute ? (returnGuidanceText ?? fr.navigation.offRoute) : arrived ? fr.navigation.instructions.arrived : instructionOrDefault(instruction, !route);
  const eta = route && progress ? estimateEta({ remainingM: progress.remainingM, gainRemainingM: progress.gainRemainingM, activity, observedSpeedMs: movingSpeedMs }) : null;
  const altText = formatAltitude(live.altitude);

  return (
    <>
      {/* Bandeau haut : instruction + état */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[var(--z-overlay)] flex flex-col items-center gap-2 px-3" style={{ paddingTop: "calc(var(--safe-top) + 12px)" }}>
        <div
          className={cn("glass-strong pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-2xl px-4 py-3 shadow-lg", offRoute && "ring-2 ring-danger/70", arrived && "ring-2 ring-success/70")}
          role="status"
          aria-live="polite"
          data-testid="nav-instruction"
        >
          <span className={cn("inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-primary-fg [&_svg]:size-7", offRoute ? "bg-danger" : arrived ? "bg-success" : "bg-primary")} aria-hidden="true">
            <Icon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[18px] font-bold leading-tight text-fg">{headline}</p>
            {route && instruction && instruction.maneuver && !offRoute && !arrived ? (
              <p className="text-[13px] text-muted">{route.name}</p>
            ) : !route ? (
              <p className="truncate text-[13px] text-muted">{describeMatch(output)}</p>
            ) : null}
          </div>
          {status === "paused" ? <span className="rounded-full bg-warning/20 px-2 py-1 text-[12px] font-bold text-warning">{fr.navigation.pause}</span> : null}
        </div>

        <div className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-2">
          <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-fg" data-testid="nav-gps">
            <span className={cn("size-2 rounded-full", TONE_DOT[qualityTone(quality)])} aria-hidden="true" />
            {qualityLabel(quality, output?.accuracy ?? null)}
          </span>
          {route ? (
            <span className="glass inline-flex max-w-full items-center rounded-full px-3 py-1.5 text-[13px] font-semibold text-fg" data-testid="nav-onpath">
              <span className="truncate">{describeMatch(output)}</span>
            </span>
          ) : null}
          {nextEvent ? (
            <span className="glass inline-flex max-w-full items-center rounded-full px-3 py-1.5 text-[13px] font-semibold text-accent" data-testid="nav-next-event">
              <span className="truncate">{interpolate(fr.navigation.events.infoIn, { label: nextEvent.event.label, distance: formatDistance(nextEvent.distanceM) })}</span>
            </span>
          ) : null}
          {session?.simulate ? <span className="glass inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-semibold text-info">{fr.navigation.simulating}</span> : null}
        </div>
        {quality === "poor" || quality === "lost" ? (
          <div className="glass pointer-events-auto w-full max-w-xl rounded-xl px-4 py-2 text-[13px] text-fg" role="status">
            <span className="font-semibold">{quality === "lost" ? fr.navigation.gpsLost : fr.navigation.gpsWeak}.</span> {fr.navigation.gpsWeakBody}
          </div>
        ) : null}
      </div>

      {/* Boutons flottants */}
      <div className="pointer-events-none absolute inset-x-0 z-[var(--z-overlay)] flex items-end justify-between px-3" style={{ bottom: "calc(var(--safe-bottom) + 112px)" }}>
        <IconButton aria-label={fr.navigation.backtrack} title={fr.navigation.backtrack} variant="glass" size={52} shape="round" className="pointer-events-auto" onClick={onBacktrack} disabled={live.trackPoints < 2}>
          <Undo2 />
        </IconButton>
        <span className="pointer-events-auto">
          <Fab label={fr.navigation.report} onClick={onReport} halo={false} />
        </span>
        <IconButton aria-label={fr.navigation.recenter} title={fr.navigation.recenter} variant="glass" size={52} shape="round" className="pointer-events-auto" pressed={follow} onClick={onRecenter}>
          <LocateFixed className={follow ? "text-info" : undefined} />
        </IconButton>
      </div>

      {/* Barre basse : statistiques */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[var(--z-overlay)] px-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
        <div className="glass-strong pointer-events-auto mx-auto flex max-w-xl items-center gap-2 rounded-2xl px-3 py-2 shadow-lg" data-testid="nav-stats">
          <div className="grid min-w-0 flex-1 grid-cols-4 gap-1">
            {route && progress ? (
              <>
                <StatCell label={fr.navigation.stats.remaining} value={formatDistance(progress.remainingM)} />
                <StatCell label={fr.navigation.stats.altitude} value={altText} />
                <StatCell label={fr.navigation.stats.speed} value={formatSpeedKmh(movingSpeedMs)} />
                <StatCell label={fr.navigation.stats.eta} value={eta ? `${formatClock(eta.arrivalAt)}` : "—"} sub={eta ? formatDurationShort(eta.remainingMs) : undefined} />
              </>
            ) : (
              <>
                <StatCell label={fr.navigation.stats.distance} value={formatDistance(stats?.distanceM ?? 0)} />
                <StatCell label={fr.navigation.stats.duration} value={formatDurationShort(stats?.durationMs ?? 0)} />
                <StatCell label={fr.navigation.stats.altitude} value={altText} />
                <StatCell label={fr.navigation.stats.speed} value={formatSpeedKmh(movingSpeedMs)} />
              </>
            )}
          </div>
          <IconButton aria-label={status === "paused" ? fr.navigation.resume : fr.navigation.pause} variant="ghost" size={44} shape="round" onClick={onPauseToggle}>
            {status === "paused" ? <Play /> : <Pause />}
          </IconButton>
          <IconButton aria-label={fr.navigation.stop} variant="ghost" size={44} shape="round" onClick={onStop} data-testid="nav-stop">
            <Square className="text-danger" />
          </IconButton>
        </div>
      </div>
    </>
  );
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <span className="tabular w-full truncate whitespace-nowrap text-[15px] font-bold leading-tight text-fg">{value}</span>
      {sub ? <span className="text-[11px] leading-none text-muted">{sub}</span> : null}
      <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}
