/**
 * Fiche d'un chemin (section 33 du moteur cartographique) : ce que les
 * passages nous en apprennent — longueur, dénivelé, difficulté, temps par
 * activité, fréquentation, dernier passage, observations de terrain.
 *
 * Les temps affichés indiquent toujours sur quoi ils reposent : une estimation
 * théorique et une médiane de 486 passages ne se présentent pas de la même
 * façon (section 26).
 */
import { useQuery } from "@tanstack/react-query";
import { Clock, Footprints, Info, TriangleAlert, Users } from "lucide-react";
import {
  formatDistance,
  formatDurationShort,
  fr,
  type ActivityMode,
  type SegmentDetail,
  type SegmentTimeDto,
  type TimeConfidence,
} from "@mountain-live/core";
import { Badge, BottomSheet, Divider, RelativeTime, SkeletonText, type BadgeTone } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

/** Plus la confiance est élevée, plus le chiffre est mis en avant (section 26). */
const CONFIDENCE_TONE: Record<TimeConfidence, BadgeTone> = {
  very_low: "neutral",
  low: "neutral",
  medium: "info",
  high: "success",
  very_high: "success",
};

const DIFFICULTY: Record<string, string> = { easy: "Facile", moderate: "Modéré", hard: "Difficile", expert: "Expert" };

function TimeRow({ time }: { time: SegmentTimeDto }) {
  const label = fr.navigation.activities[time.activity as ActivityMode];
  const direction = time.direction === "forward" ? "aller" : "retour";
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[15px] text-fg">
        {label}
        <span className="ml-1 text-[13px] text-muted">({direction})</span>
      </span>
      <span className="flex items-baseline gap-2">
        <span className="tabular text-[16px] font-bold text-fg">{formatDurationShort(time.ms)}</span>
        <Badge tone={time.samples > 0 ? CONFIDENCE_TONE[time.confidence] : "neutral"} size="sm">
          {time.samples > 0 ? `${time.samples} passage${time.samples > 1 ? "s" : ""}` : fr.network.confidence.theoretical.replace("Estimation théorique, sans passage observé.", "Estimé")}
        </Badge>
      </span>
    </li>
  );
}

export interface SegmentSheetProps {
  segmentId: string | null;
  onClose: () => void;
}

export function SegmentSheet({ segmentId, onClose }: SegmentSheetProps) {
  const { data, isLoading } = useQuery<SegmentDetail>({
    queryKey: qk.networkSegment(segmentId ?? ""),
    queryFn: () => api.network.segment(segmentId!),
    enabled: Boolean(segmentId),
    staleTime: 5 * 60_000,
  });

  const segment = data?.segment;
  const title = segment?.name ?? data?.trailName ?? fr.network.segment.title;

  return (
    <BottomSheet open={Boolean(segmentId)} onClose={onClose} title={title} defaultSnap="half" aria-label={fr.network.segment.title}>
      <div className="flex flex-col gap-3 px-4 pb-6" data-testid="segment-sheet">
        {isLoading || !data ? (
          <SkeletonText lines={5} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="tabular text-[18px] font-bold text-fg">{formatDistance(data.segment.lengthM)}</p>
                <p className="text-[12px] uppercase tracking-wide text-muted">{fr.network.segment.length}</p>
              </div>
              <div>
                <p className="tabular text-[18px] font-bold text-fg">
                  +{Math.round(data.profile.elevationGainM)} / −{Math.round(data.profile.elevationLossM)} m
                </p>
                <p className="text-[12px] uppercase tracking-wide text-muted">{fr.network.segment.elevation}</p>
              </div>
              <div>
                <p className="text-[18px] font-bold text-fg">{data.segment.status === "closed" ? fr.network.segment.openStatus.closed : fr.network.segment.openStatus.open}</p>
                <p className="text-[12px] uppercase tracking-wide text-muted">{fr.network.segment.state}</p>
              </div>
            </div>

            <Divider />

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">{data.frequentationLabel}</Badge>
              {data.overall.passages.last30 > 0 ? (
                <Badge tone="neutral">
                  <Users className="mr-1 inline size-3.5" aria-hidden="true" />
                  {fr.network.frequentation.recent.replace("{n}", String(data.overall.passages.last30))}
                </Badge>
              ) : null}
              {data.overall.lastPassageAt ? (
                <span className="text-[13px] text-muted">
                  {fr.network.segment.lastPassage} : <RelativeTime date={new Date(data.overall.lastPassageAt).toISOString()} />
                </span>
              ) : null}
              {data.segment.sacScale ? <Badge tone="neutral">{data.segment.sacScale}</Badge> : null}
              {data.segment.surface ? <Badge tone="neutral">{data.segment.surface}</Badge> : null}
              {data.segment.sacScale && DIFFICULTY[data.segment.sacScale] ? <Badge tone="neutral">{DIFFICULTY[data.segment.sacScale]}</Badge> : null}
            </div>

            {data.overall.insufficientData ? (
              <p className="inline-flex items-start gap-2 rounded-lg bg-surface-2 p-2 text-[13px] leading-snug text-muted">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {fr.network.frequentation.insufficientHint}
              </p>
            ) : null}

            <section>
              <h3 className="mb-1 inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-muted">
                <Clock className="size-4" aria-hidden="true" /> {fr.network.segment.times}
              </h3>
              {data.times.length === 0 ? (
                <p className="text-[14px] text-muted">{fr.network.segment.noTimes}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.times.map((t) => (
                    <TimeRow key={`${t.activity}:${t.direction}`} time={t} />
                  ))}
                </ul>
              )}
            </section>

            {data.notes.length > 0 ? (
              <section>
                <h3 className="mb-1 inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-muted">
                  <TriangleAlert className="size-4" aria-hidden="true" /> Observations de terrain
                </h3>
                <ul className="flex flex-col gap-1">
                  {data.notes.map((n, i) => (
                    <li key={`${n.kind}:${i}`} className="text-[14px] text-fg">
                      <span className="font-semibold">{n.label}.</span> <span className="text-muted">{n.detail}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.reportCount > 0 ? (
              <p className="inline-flex items-center gap-2 text-[14px] text-fg">
                <Footprints className="size-4 text-accent" aria-hidden="true" />
                {data.reportCount} {fr.network.segment.reports.toLowerCase()} à proximité
              </p>
            ) : null}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
