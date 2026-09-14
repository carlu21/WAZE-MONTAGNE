/**
 * Fiche détaillée d'un signalement (section 14) : icône, distance, lieu, date,
 * photo, description, niveau, confirmations, dernière confirmation, source ;
 * actions Confirmer / Plus présent / Ajouter une photo / Commenter / Partager,
 * contestation, résolution par l'auteur, signalement d'un problème.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Camera, ChevronDown, ChevronLeft, ChevronUp, CircleCheck, Flag, MapPin, Pencil, Share2 } from "lucide-react";
import {
  CATEGORY_BY_ID,
  CONFIRMATION_KINDS,
  SOURCE_LABELS,
  SUBTYPE_BY_ID,
  formatUntil,
  fr,
  haversineM,
  phrases,
  type ConfirmationKind,
  type Report,
} from "@mountain-live/core";
import {
  Avatar,
  Badge,
  Button,
  CategoryIcon,
  ConfidenceBadge,
  DangerPill,
  Distance,
  EmptyState,
  IconButton,
  Modal,
  RelativeTime,
  ReliabilityLevel,
  SafetyNotice,
  SkeletonGroup,
  SkeletonText,
  SourceBadge,
  StatusPill,
  Textarea,
  TopBar,
  toast,
} from "@/components/ui";
import { photoUrl } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { StaticMap } from "@/features/report-detail/StaticMap";
import { ConfirmationBar } from "@/features/report-detail/ConfirmationBar";
import { CommentsSection } from "@/features/report-detail/CommentsSection";
import { useReportActions, useReportDetail } from "@/features/report-detail/useReportDetail";
import { reportUrl, shareReport, shareTitle } from "@/features/report-detail/share";
import { resizeImage } from "@/features/report/photo";

const KIND_LABEL: Record<ConfirmationKind, string> = Object.fromEntries(CONFIRMATION_KINDS.map((k) => [k.id, k.label])) as Record<ConfirmationKind, string>;
const CLOSED_STATUSES = new Set<Report["status"]>(["resolved", "expired", "deleted"]);

export default function ReportDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const position = useUiStore((s) => s.position);
  const setView = useUiStore((s) => s.setView);
  const query = useReportDetail(id);
  const actions = useReportActions(id);

  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeText, setDisputeText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const data = query.data;
  const report = data?.report ?? null;

  useEffect(() => {
    if (report) setEditText(report.description ?? "");
  }, [report?.id, report?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  const distanceM = useMemo(() => {
    if (!report) return null;
    if (position) return Math.round(haversineM(position, report));
    return report.distanceM ?? null;
  }, [report, position]);

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-4">
        <SkeletonGroup label={fr.common.loading}>
          <SkeletonText lines={2} />
          <div className="ml-skeleton mt-4 h-40 w-full rounded-xl" />
          <SkeletonText lines={4} />
        </SkeletonGroup>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex h-full flex-col">
        <TopBar variant="solid" title={fr.nav.map} leading={<BackButton />} />
        <EmptyState icon={<MapPin />} title="Signalement introuvable" description={fr.errors.notFound} action={<Button onClick={() => navigate("/map")}>{fr.common.seeOnMap}</Button>} />
      </div>
    );
  }

  const subtype = SUBTYPE_BY_ID[report.subtype];
  const category = CATEGORY_BY_ID[report.category];
  const label = subtype?.label ?? category?.label ?? fr.common.unknown;
  const isAuthor = Boolean(user && report.userId && user.id === report.userId);
  const closed = CLOSED_STATUSES.has(report.status);
  const photos = report.photos?.length ? report.photos : report.photoUrl ? [{ id: "main", url: report.photoUrl }] : [];
  const validUntil = report.endsAt ?? report.expiresAt;

  const seeOnMap = () => {
    setView({ lat: report.lat, lng: report.lng, zoom: 15 });
    navigate("/map", { state: { focus: { lat: report.lat, lng: report.lng }, publishedReportId: report.id } });
  };

  const onShare = async () => {
    const r = await shareReport({ title: shareTitle(label), url: reportUrl(report.id), text: report.zone ?? undefined });
    if (r === "copied") toast.success(fr.sheet.linkCopied);
    else if (r === "failed") toast.warning(fr.errors.generic);
  };

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!actions.requireLogin()) return;
    setUploading(true);
    try {
      const blob = await resizeImage(file);
      await actions.photo.mutateAsync(blob);
    } catch {
      /* erreur déjà notifiée par la mutation */
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submitDispute = async () => {
    setDisputeOpen(false);
    await actions.voteOrQueue("disputed", disputeText.trim() || null);
    setDisputeText("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        variant="solid"
        title={label}
        subtitle={report.zone ?? undefined}
        leading={<BackButton />}
        actions={
          <IconButton aria-label={fr.common.share} variant="ghost" size={44} onClick={() => void onShare()}>
            <Share2 />
          </IconButton>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <article className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-10 pt-4">
          {/* En-tête coloré */}
          <header className="flex items-start gap-3 rounded-2xl p-4 text-white" style={{ background: category?.color ?? "var(--primary)" }}>
            <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-white/20 [&_svg]:size-7" aria-hidden="true">
              <CategoryIconSafe subtype={report.subtype} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[22px] font-extrabold uppercase leading-tight tracking-wide">{label}</h1>
              <p className="mt-1 text-[14px] opacity-90">
                {phrases.reportedAgo(report.createdAt)}
                {report.authorPseudo ? ` · ${report.authorPseudo}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <SourceBadge source={report.source} />
                <StatusPill status={report.status} />
                {report.dangerLevel ? <DangerPill level={report.dangerLevel} /> : null}
              </div>
            </div>
          </header>

          {data?.fromCache ? <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-fg">{fr.offline.mode} — informations issues du cache local.</p> : null}
          {closed ? (
            <p className="rounded-lg bg-surface-2 px-3 py-2 text-[14px] text-muted">
              Ce signalement est {report.status === "resolved" ? "résolu" : "expiré"} : il n'apparaît plus sur la carte.
            </p>
          ) : null}

          {/* Carte de situation */}
          <section className="flex flex-col gap-2">
            <StaticMap lat={report.lat} lng={report.lng} color={category?.color} blurRadiusM={report.blurred ? 400 : null} aria-label={`Position : ${label}`} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px] text-muted">
                {report.blurred ? fr.sheet.blurred : report.zone ? `${fr.sheet.place} : ${report.zone}` : ""}
              </p>
              <Button size="md" variant="outline" leftIcon={<MapPin />} onClick={seeOnMap}>
                {fr.common.seeOnMap}
              </Button>
            </div>
          </section>

          {/* Informations clés */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-surface p-4 shadow-sm sm:grid-cols-3">
            <Info label="Distance">{distanceM != null ? <Distance meters={distanceM} /> : "—"}</Info>
            <Info label={fr.sheet.date}>{formatDateTime(report.createdAt)}</Info>
            <Info label={fr.sheet.expiresIn.replace(" {in}", "")}>
              {report.endsAt ? formatUntil(report.endsAt) : validUntil ? <RelativeTime date={validUntil} /> : "—"}
            </Info>
            <Info label={fr.sheet.level}>{report.dangerLevel ? <DangerPill level={report.dangerLevel} /> : "—"}</Info>
            <Info label={fr.sheet.confidence}>
              <ConfidenceBadge label={report.confidenceLabel} score={report.confidenceScore} />
            </Info>
            <Info label={fr.sheet.source}>{SOURCE_LABELS[report.source].label}</Info>
          </dl>

          {/* Photos */}
          {photos.length ? (
            <section aria-label={fr.sheet.photos} className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4">
              {photos.map((p) => (
                <img key={p.id} src={photoUrl(p.url)} alt={`${label} — photo`} loading="lazy" className="h-56 w-auto max-w-[90%] shrink-0 snap-center rounded-xl object-cover" />
              ))}
            </section>
          ) : null}

          {/* Description */}
          {report.description || isAuthor ? (
            <section className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-bold text-fg">{fr.sheet.description}</h2>
                {isAuthor && !closed ? (
                  <Button size="md" variant="ghost" leftIcon={<Pencil />} onClick={() => setEditOpen(true)}>
                    {fr.common.edit}
                  </Button>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap break-words text-[16px] leading-relaxed text-fg">{report.description || "Aucune description."}</p>
            </section>
          ) : null}

          {/* Confiance communautaire */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[15px] font-semibold text-fg">{phrases.confirmedBy(report.confirmationsCount)}</p>
            <p className="text-[13px] text-muted">
              {report.lastConfirmationAt ? phrases.lastConfirmation(report.lastConfirmationAt) : fr.sheet.noConfirmation}
              {report.disputesCount ? ` · contesté par ${report.disputesCount}` : ""}
              {report.resolvedVotesCount ? ` · « plus présent » selon ${report.resolvedVotesCount}` : ""}
            </p>
            {data?.author ? (
              <div className="mt-3 flex items-center gap-3">
                <Avatar name={data.author.pseudo} src={data.author.avatarUrl ?? undefined} size={40} role={data.author.role} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-fg">{data.author.pseudo}</p>
                  <ReliabilityLevel level={data.author.reliabilityLevel} size="sm" showLabel />
                </div>
                {data.author.role === "partner" || data.author.role === "official" ? <Badge tone="gold">{SOURCE_LABELS[data.author.role === "official" ? "official" : "partner"].badge}</Badge> : null}
              </div>
            ) : null}
          </section>

          {/* Votes */}
          <ConfirmationBar
            current={report.myConfirmation}
            onVote={(kind) => void actions.voteOrQueue(kind)}
            onDispute={() => (actions.requireLogin() ? setDisputeOpen(true) : undefined)}
            pending={actions.vote.isPending}
            isAuthor={isAuthor}
            closed={closed}
          />
          {isAuthor && !closed ? (
            <Button size="lg" variant="outline" leftIcon={<CircleCheck />} loading={actions.resolve.isPending} onClick={() => actions.resolve.mutate()}>
              {fr.sheet.actions.resolve}
            </Button>
          ) : null}

          {/* Actions secondaires */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-hidden="true" tabIndex={-1} onChange={(e) => void onPickPhoto(e.target.files?.[0])} />
            <Button size="md" variant="secondary" leftIcon={<Camera />} loading={uploading} disabled={closed} onClick={() => (actions.requireLogin() ? fileRef.current?.click() : undefined)}>
              {fr.sheet.actions.addPhoto}
            </Button>
            <Button size="md" variant="secondary" onClick={() => (actions.requireLogin() ? setComposeOpen(true) : undefined)}>
              {fr.sheet.actions.comment}
            </Button>
            <Button size="md" variant="secondary" leftIcon={<Share2 />} onClick={() => void onShare()}>
              {fr.sheet.actions.share}
            </Button>
            <Button size="md" variant="ghost" leftIcon={<Flag />} onClick={() => (actions.requireLogin() ? navigate(`/flag/${report.id}`) : undefined)}>
              {fr.sheet.actions.flag}
            </Button>
          </div>

          {/* Commentaires */}
          <CommentsSection
            comments={data?.comments ?? []}
            canComment={Boolean(user)}
            pending={actions.comment.isPending}
            onSubmit={(body) => actions.comment.mutate(body)}
            onRequireLogin={() => actions.requireLogin()}
            composeOpen={composeOpen}
            onComposeOpen={setComposeOpen}
          />

          {/* Historique */}
          {data?.confirmations?.length ? (
            <section>
              <button type="button" className="inline-flex min-h-12 items-center gap-2 text-[15px] font-semibold text-fg" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
                {historyOpen ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
                Voir l'historique ({data.confirmations.length})
              </button>
              {historyOpen ? (
                <ul className="mt-2 flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
                  {data.confirmations
                    .slice()
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[14px]">
                        <span className="font-medium text-fg">{KIND_LABEL[c.kind]}</span>
                        <RelativeTime date={c.createdAt} className="text-muted" />
                      </li>
                    ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <SafetyNotice variant="compact">
            <Link to="/legal" className="font-semibold text-primary underline-offset-2 hover:underline">
              {fr.profilePage.privacy}
            </Link>
          </SafetyNotice>
        </article>
      </main>

      <Modal
        open={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        title={fr.confirmations.dispute}
        description={fr.confirmations.disputeHint}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisputeOpen(false)}>
              {fr.common.cancel}
            </Button>
            <Button variant="danger" onClick={() => void submitDispute()}>
              {fr.confirmations.dispute}
            </Button>
          </>
        }
      >
        <Textarea value={disputeText} onChange={(e) => setDisputeText(e.target.value)} maxLength={300} placeholder="Pourquoi contestez-vous ce signalement ? (facultatif)" aria-label={fr.confirmations.dispute} />
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`${fr.common.edit} — ${fr.sheet.description}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              {fr.common.cancel}
            </Button>
            <Button
              loading={actions.updateDescription.isPending}
              onClick={() => {
                actions.updateDescription.mutate(editText);
                setEditOpen(false);
              }}
            >
              {fr.common.save}
            </Button>
          </>
        }
      >
        <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={600} aria-label={fr.sheet.description} />
      </Modal>
    </div>
  );
}

function BackButton() {
  const navigate = useNavigate();
  return (
    <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/map"))}>
      <ChevronLeft />
    </IconButton>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-medium text-fg">{children}</dd>
    </div>
  );
}

function CategoryIconSafe({ subtype }: { subtype: Report["subtype"] }) {
  return <CategoryIcon subtype={subtype} strokeWidth={2.4} />;
}
