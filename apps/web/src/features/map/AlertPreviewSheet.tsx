/**
 * Aperçu d'une alerte officielle (sections 7 et 27) : badge « Source
 * officielle », organisation, sévérité, période, texte et lien éventuel.
 */
import { ExternalLink, X } from "lucide-react";
import { CATEGORY_BY_ID, formatDateTime, formatUntil, fr, type OfficialAlert } from "@mountain-live/core";
import { BottomSheet, CategoryIcon, DangerPill, IconButton, SourceBadge, buttonClasses } from "@/components/ui";

export interface AlertPreviewSheetProps {
  alert: OfficialAlert | null;
  onClose: () => void;
}

export const ALERT_PEEK_HEIGHT = 300;

export function AlertPreviewSheet({ alert, onClose }: AlertPreviewSheetProps) {
  if (!alert) return null;
  const category = CATEGORY_BY_ID[alert.category];
  const ongoing = new Date(alert.startsAt).getTime() <= Date.now();

  return (
    <BottomSheet
      open
      onClose={onClose}
      defaultSnap="peek"
      snaps={["peek", "half"]}
      snapPoints={{ peek: ALERT_PEEK_HEIGHT, half: 0.62 }}
      backdrop="none"
      aria-label={`${fr.mapUi.officialAlert} : ${alert.title}`}
      header={
        <div className="flex items-start gap-3 px-4 pb-2">
          <span
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-full text-white [&_svg]:size-6"
            style={{ background: category?.color ?? "var(--danger)", boxShadow: "0 0 0 3px var(--gold)" }}
            aria-hidden="true"
          >
            <CategoryIcon category={alert.category} strokeWidth={2.4} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-[18px] font-bold leading-tight text-fg">{alert.title}</h2>
            <p className="mt-0.5 truncate text-[14px] text-muted">{alert.organisation}</p>
          </div>
          <IconButton aria-label={fr.common.close} size={44} variant="ghost" onClick={onClose} className="-mr-2 -mt-1">
            <X />
          </IconButton>
        </div>
      }
      footer={
        alert.url ? (
          <a href={alert.url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: "primary", size: "lg", fullWidth: true })}>
            <span className="truncate">Consulter la source officielle</span>
            <ExternalLink className="size-5 shrink-0" aria-hidden="true" />
          </a>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceBadge source="official" long />
          <DangerPill level={alert.severity} withPrefix />
        </div>
        <p className="text-[15px] leading-snug text-fg">
          <span className="font-semibold">{ongoing ? "En cours" : `À partir du ${formatDateTime(alert.startsAt)}`}</span>
          {alert.endsAt ? ` · ${formatUntil(alert.endsAt)}` : " · sans date de fin annoncée"}
        </p>
        <p className="whitespace-pre-line text-[15px] leading-snug text-fg">{alert.body}</p>
        <p className="text-[13px] text-muted">{fr.safetyNotice.priority}</p>
      </div>
    </BottomSheet>
  );
}
