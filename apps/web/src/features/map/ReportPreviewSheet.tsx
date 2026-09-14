/**
 * Aperçu d'un signalement au tap sur un marqueur (sections 6 et 14) :
 * feuille basse en mode « aperçu » (la carte reste utilisable), extensible.
 * Actions rapides « Toujours présent » / « Plus présent » (POST /reports/:id/confirm),
 * redirection vers la connexion si nécessaire, file d'attente hors connexion.
 */
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CircleCheck } from "lucide-react";
import {
  CATEGORY_BY_ID,
  SUBTYPE_BY_ID,
  formatUntil,
  fr,
  haversineM,
  phrases,
  type ConfirmationKind,
  type Report,
} from "@mountain-live/core";
import { api, ApiError, photoUrl } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { enqueueConfirmation } from "@/lib/outbox";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import {
  BottomSheet,
  Button,
  CategoryIcon,
  ConfidenceBadge,
  DangerPill,
  Distance,
  IconButton,
  LinkButton,
  RelativeTime,
  SourceBadge,
  cn,
  toast,
} from "@/components/ui";
import { X } from "lucide-react";

export interface ReportPreviewSheetProps {
  report: Report | null;
  onClose: () => void;
}

/** Hauteur du mode « aperçu » (px) : en-tête, badges, méta, actions rapides, bouton fiche. */
export const PREVIEW_PEEK_HEIGHT = 404;

const QUICK_VOTES: readonly { kind: ConfirmationKind; label: string; icon: React.ReactNode }[] = [
  { kind: "still_present", label: fr.confirmations.stillPresent, icon: <Check /> },
  { kind: "gone", label: fr.confirmations.gone, icon: <CircleCheck /> },
];

export function ReportPreviewSheet({ report, onClose }: ReportPreviewSheetProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useSessionStore((s) => s.user);
  const token = useSessionStore((s) => s.token);
  const online = useUiStore((s) => s.online);
  const position = useUiStore((s) => s.position);

  const confirm = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: ConfirmationKind }) => api.reports.confirm(id, { kind }),
    onSuccess: (_res, vars) => {
      toast.success(fr.confirmations.thanks);
      void queryClient.invalidateQueries({ queryKey: qk.reportsRoot });
      void queryClient.invalidateQueries({ queryKey: qk.report(vars.id) });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.code === "own_report") toast.warning(fr.confirmations.ownReport);
        else if (err.code === "report_closed") toast.warning(fr.errors.conflict);
        else if (err.status === 401) toast.warning(fr.confirmations.loginRequired);
        else toast.danger(err.message);
      } else {
        toast.danger(fr.errors.network);
      }
    },
  });

  if (!report) return null;

  const subtype = SUBTYPE_BY_ID[report.subtype];
  const category = CATEGORY_BY_ID[report.category];
  const label = subtype?.label ?? category?.label ?? fr.common.unknown;
  const isOwn = Boolean(user && report.userId && user.id === report.userId);
  const distanceM = position ? Math.round(haversineM(position, report)) : (report.distanceM ?? null);
  const photo = photoUrl(report.photoUrl);
  const validUntil = report.endsAt ?? report.expiresAt;

  const vote = async (kind: ConfirmationKind) => {
    if (!token || !user) {
      toast.info(fr.confirmations.loginRequired);
      navigate("/auth/login", { state: { from: "/map" } });
      return;
    }
    if (!online) {
      await enqueueConfirmation(report.id, kind);
      toast.info(fr.confirmations.offlineQueued);
      return;
    }
    confirm.mutate({ id: report.id, kind });
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      defaultSnap="peek"
      snaps={["peek", "half"]}
      snapPoints={{ peek: PREVIEW_PEEK_HEIGHT, half: 0.62 }}
      backdrop="none"
      aria-label={`Aperçu : ${label}`}
      header={
        <div className="flex items-start gap-3 px-4 pb-2">
          <span
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-full text-white [&_svg]:size-6"
            style={{ background: category?.color ?? "var(--primary)", boxShadow: report.source === "official" ? "0 0 0 3px var(--gold)" : undefined }}
            aria-hidden="true"
          >
            <CategoryIcon subtype={report.subtype} strokeWidth={2.4} />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="truncate text-[18px] font-bold leading-tight text-fg">{label}</h2>
            <p className="mt-0.5 truncate text-[14px] text-muted">
              {report.zone ? `${report.zone} · ` : ""}
              <RelativeTime date={report.createdAt} prefix="Signalé" />
            </p>
          </div>
          <IconButton aria-label={fr.common.close} size={44} variant="ghost" onClick={onClose} className="-mr-2 -mt-1">
            <X />
          </IconButton>
        </div>
      }
      footer={
        <LinkButton to={`/reports/${report.id}`} size="lg" fullWidth>
          Voir la fiche
        </LinkButton>
      }
    >
      <div className="flex flex-col gap-3 px-4 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {report.dangerLevel ? <DangerPill level={report.dangerLevel} /> : null}
          <SourceBadge source={report.source} long={report.source === "official"} />
          <ConfidenceBadge label={report.confidenceLabel} />
        </div>

        <p className="text-[15px] leading-snug text-fg">
          <span className="font-semibold">{phrases.confirmedBy(report.confirmationsCount)}</span>
          {distanceM !== null ? (
            <>
              {" · "}
              <Distance meters={distanceM} withPrefix />
            </>
          ) : null}
          {report.blurred ? <span className="block text-[14px] text-muted">{fr.sheet.blurred}</span> : null}
        </p>

        {isOwn ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[14px] text-muted">Votre signalement : la communauté peut le confirmer.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2" role="group" aria-label={fr.confirmations.question}>
            {QUICK_VOTES.map(({ kind, label: voteLabel, icon }) => {
              const active = report.myConfirmation === kind;
              return (
                <Button
                  key={kind}
                  variant={active ? "secondary" : "outline"}
                  className={cn("min-w-0 flex-1 px-3", active && "ring-2 ring-primary/40")}
                  leftIcon={icon}
                  aria-pressed={active}
                  disabled={confirm.isPending}
                  onClick={() => void vote(kind)}
                >
                  {voteLabel}
                </Button>
              );
            })}
          </div>
        )}

        {/* Détails visibles en agrandissant la feuille. */}
        {report.description ? <p className="text-[15px] leading-snug text-fg">{report.description}</p> : null}
        {photo ? (
          <img src={photo} alt={`Photo du signalement : ${label}`} loading="lazy" className="max-h-56 w-full rounded-xl object-cover" />
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
          {report.lastConfirmationAt ? (
            <>
              <dt className="text-muted">{fr.sheet.lastConfirmation.replace(" {ago}", "")}</dt>
              <dd>
                <RelativeTime date={report.lastConfirmationAt} />
              </dd>
            </>
          ) : null}
          <dt className="text-muted">Validité</dt>
          <dd>{formatUntil(validUntil)}</dd>
          {report.authorPseudo ? (
            <>
              <dt className="text-muted">Signalé par</dt>
              <dd>{report.authorPseudo}</dd>
            </>
          ) : null}
        </dl>
      </div>
    </BottomSheet>
  );
}
