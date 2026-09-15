/**
 * MODE ACTIVITÉ — l'affichage tête haute pendant une sortie (section 19).
 *
 * C'est un mode à part entière, pas une page parmi d'autres : la barre de
 * navigation à quatre onglets disparaît, la carte occupe tout l'écran, et il ne
 * reste que ce dont on a besoin en marchant, gants aux mains :
 *
 *   ┌─────────────────────────────┐
 *   │ instruction / état          │  UN SEUL indicateur GPS, qui s'efface
 *   │                             │  quand le signal est bon
 *   │           CARTE             │
 *   │                             │
 *   │ [Couches] (SIGNALER) [Recentrer]
 *   ├─────────────────────────────┤
 *   │ DISTANCE DURÉE VITESSE  D+  │
 *   │   ⏸ Pause      ■ Terminer   │  « Terminer » écrit en toutes lettres,
 *   └─────────────────────────────┘  et confirmé avant d'arrêter quoi que ce soit
 *
 * Un carré rouge n'est pas une consigne : on ne devine pas qu'il termine une
 * randonnée de six heures. Le bouton porte donc son nom.
 */
import { Layers, LocateFixed, Pause, Play, Square, Undo2 } from "lucide-react";
import {
  estimateEta,
  formatClock,
  formatDistance,
  formatDurationShort,
  formatSpeedKmh,
  fr,
  interpolate,
  positionTrust,
  type NavRoute,
} from "@mountain-live/core";
import { Button, Fab, IconButton } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { GpsStatus, GpsWaiting } from "./GpsStatus";
import { formatAltitude, instructionOrDefault, maneuverIcon, trailLabel } from "./format";
import { useNavigationStore } from "./store";

export interface NavHudProps {
  route: NavRoute | null;
  /** L'itinéraire suit-il un réseau réel ? Sinon aucune consigne de suivi n'est affichée. */
  routeDrawable?: boolean;
  returnGuidanceText: string | null;
  onRecenter: () => void;
  onReport: () => void;
  onBacktrack: () => void;
  onLayers: () => void;
  onPauseToggle: () => void;
  onStop: () => void;
}

export function NavHud({ route, routeDrawable = true, returnGuidanceText, onRecenter, onReport, onBacktrack, onLayers, onPauseToggle, onStop }: NavHudProps) {
  const status = useNavigationStore((s) => s.status);
  const live = useNavigationStore((s) => s.live);
  const activity = useNavigationStore((s) => s.activity);
  const follow = useNavigationStore((s) => s.follow);
  const session = useNavigationStore((s) => s.session);
  const { output, progress, instruction, nextEvent, quality, stats, movingSpeedMs, offRoute, arrived, searching } = live;

  /*
   * Confiance dans la position : c'est elle, et elle seule, qui autorise les
   * phrases catégoriques. Tant qu'elle n'est pas « fiable », on n'annonce ni
   * sortie d'itinéraire ni « hors sentier ».
   */
  const trust = positionTrust({ accuracy: output?.accuracy ?? null, quality, fixes: live.fixes, searching });
  const reliable = trust === "reliable";
  const followable = route !== null && routeDrawable;
  const showOffRoute = offRoute && reliable && followable;

  const Icon = maneuverIcon(instruction?.type);
  const headline = showOffRoute
    ? (returnGuidanceText ?? fr.navigation.offRoute)
    : arrived
      ? fr.navigation.instructions.arrived
      : trust === "unavailable"
        ? fr.navigation.gpsAcquiring
        : instructionOrDefault(followable ? instruction : null, !followable);
  const path = trailLabel({ output, trust, networkSegments: live.networkSegments, consecutiveOffTrail: live.consecutiveOffTrail });
  const eta = followable && progress ? estimateEta({ remainingM: progress.remainingM, gainRemainingM: progress.gainRemainingM, activity, observedSpeedMs: movingSpeedMs }) : null;

  return (
    <>
      {/* Bandeau haut : UNE instruction, UN état. Rien en double. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[var(--z-overlay)] flex flex-col items-center gap-2 px-3" style={{ paddingTop: "calc(var(--safe-top) + 12px)" }}>
        <div
          className={cn(
            "glass-strong pointer-events-auto flex w-full max-w-xl items-center gap-3 rounded-2xl px-4 py-3 shadow-lg",
            showOffRoute && "ring-2 ring-danger/70",
            arrived && "ring-2 ring-success/70",
          )}
          role="status"
          aria-live="polite"
          data-testid="nav-instruction"
        >
          <span
            className={cn("inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-primary-fg [&_svg]:size-7", showOffRoute ? "bg-danger" : arrived ? "bg-success" : "bg-primary")}
            aria-hidden="true"
          >
            <Icon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[18px] font-bold leading-tight text-fg">{headline}</p>
            {followable && instruction && instruction.maneuver && !showOffRoute && !arrived ? (
              <p className="truncate text-[13px] text-muted">{route.name}</p>
            ) : path ? (
              <p className="truncate text-[13px] text-muted" data-testid="nav-onpath">
                {path}
              </p>
            ) : null}
          </div>
          {status === "paused" ? <span className="rounded-full bg-warning/20 px-2 py-1 text-[12px] font-bold text-warning">{fr.navigation.pause}</span> : null}
        </div>

        <div className="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-2">
          {/* L'unique indicateur GPS : il s'efface de lui-même quand le signal est bon. */}
          <GpsStatus trust={trust} accuracy={output?.accuracy ?? null} />
          {showOffRoute ? (
            <span className="glass inline-flex max-w-full items-center rounded-full px-3 py-1.5 text-[13px] font-semibold text-muted" data-testid="nav-direction-note">
              <span className="truncate">{fr.navigation.directionOnly}</span>
            </span>
          ) : null}
          {nextEvent ? (
            <span className="glass inline-flex max-w-full items-center rounded-full px-3 py-1.5 text-[13px] font-semibold text-accent" data-testid="nav-next-event">
              <span className="truncate">{interpolate(fr.navigation.events.infoIn, { label: nextEvent.event.label, distance: formatDistance(nextEvent.distanceM) })}</span>
            </span>
          ) : null}
          {live.altitude !== null ? (
            <span className="glass inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-semibold text-fg" data-testid="nav-altitude">
              {fr.navigation.stats.altitude} {formatAltitude(live.altitude)}
            </span>
          ) : null}
          {session?.simulate ? <span className="glass inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-semibold text-info">{fr.navigation.simulating}</span> : null}
        </div>
        {/* Aucun relevé encore reçu : on attend, on ne fabrique pas un déplacement. */}
        <GpsWaiting trust={trust} />
      </div>

      {/* Les trois actions de la carte, à portée de pouce : Couches · Signaler · Recentrer. */}
      <div className="pointer-events-none absolute inset-x-0 z-[var(--z-overlay)] flex items-end justify-between px-3" style={{ bottom: "calc(var(--safe-bottom) + 132px)" }}>
        <div className="pointer-events-auto flex flex-col gap-2">
          <IconButton aria-label={fr.mapUi.layers} title={fr.mapUi.layers} variant="glass" size={52} shape="round" onClick={onLayers} data-testid="nav-layers">
            <Layers />
          </IconButton>
          <IconButton aria-label={fr.navigation.backtrack} title={fr.navigation.backtrack} variant="glass" size={52} shape="round" onClick={onBacktrack} disabled={live.trackPoints < 2}>
            <Undo2 />
          </IconButton>
        </div>
        <span className="pointer-events-auto">
          <Fab label={fr.navigation.report} onClick={onReport} halo={false} />
        </span>
        <IconButton aria-label={fr.navigation.recenter} title={fr.navigation.recenter} variant="glass" size={52} shape="round" className="pointer-events-auto" pressed={follow} onClick={onRecenter}>
          <LocateFixed className={follow ? "text-info" : undefined} />
        </IconButton>
      </div>

      {/* Panneau bas : les quatre chiffres de la sortie, puis Pause et Terminer. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[var(--z-overlay)] px-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
        <div className="glass-strong pointer-events-auto mx-auto flex max-w-xl flex-col gap-2 rounded-2xl px-3 py-2 shadow-lg" data-testid="nav-stats">
          <div className="grid grid-cols-4 gap-1">
            <StatCell label={fr.navigation.stats.distance} value={formatDistance(stats?.distanceM ?? 0)} />
            <StatCell label={fr.navigation.stats.duration} value={formatDurationShort(stats?.durationMs ?? 0)} />
            <StatCell label={fr.navigation.stats.speed} value={formatSpeedKmh(movingSpeedMs)} />
            <StatCell label={fr.navigation.stats.gain} value={`${Math.round(stats?.gainM ?? 0)} m`} />
          </div>
          {followable && progress ? (
            <p className="tabular text-center text-[12px] text-muted" data-testid="nav-remaining">
              {fr.navigation.stats.remaining} {formatDistance(progress.remainingM)}
              {eta ? ` · ${fr.navigation.stats.eta} ${formatClock(eta.arrivalAt)} (${formatDurationShort(eta.remainingMs)})` : ""}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={onPauseToggle}
              leftIcon={status === "paused" ? <Play /> : <Pause />}
              data-testid="nav-pause"
            >
              {status === "paused" ? fr.navigation.resume : fr.navigation.pause}
            </Button>
            {/*
              « Terminer », écrit. Un carré rouge seul n'explique rien et se
              presse par erreur ; la confirmation est demandée ensuite.
            */}
            <Button variant="danger" size="lg" className="flex-1" onClick={onStop} leftIcon={<Square className="fill-current" />} data-testid="nav-stop">
              {fr.navigation.stop}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center text-center">
      <span className="tabular w-full truncate whitespace-nowrap text-[16px] font-bold leading-tight text-fg">{value}</span>
      <span className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}
