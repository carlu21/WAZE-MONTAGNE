/**
 * Back-office de modération (section 17) : tableau de bord, signalements
 * (modifier catégorie / statut, supprimer), litiges (examiner, rejeter, supprimer
 * le contenu, suspendre l'auteur), utilisateurs (suspendre), alertes officielles.
 */
import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, Trash2 } from "lucide-react";
import {
  CATEGORIES,
  DANGER_LEVELS,
  STATUS_LABELS,
  SUBTYPE_BY_ID,
  fr,
  officialAlertSchema,
  subtypesOf,
  type AdminStats,
  type ContentFlag,
  type DangerLevel,
  type OfficialAlertInput,
  type Report,
  type ReportCategory,
  type ReportSource,
  type ReportStatus,
} from "@mountain-live/core";
import { Avatar, Badge, Button, CategoryIcon, ConfidenceBadge, EmptyState, Field, IconButton, Input, Modal, Select, SourceBadge, Stat, StatusPill, Textarea, TopBar, cn, toast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatDateTime } from "@/lib/format";
import { BarChart } from "@/features/admin/charts";
import { GeometryPicker, type AlertGeometry } from "@/features/admin/GeometryPicker";

const TABS = [
  { to: "", label: "Tableau de bord", end: true },
  { to: "reports", label: fr.moderation.admin.reports },
  { to: "flags", label: fr.moderation.admin.flags },
  { to: "users", label: fr.moderation.admin.users },
  { to: "alerts", label: fr.moderation.admin.alerts },
];
const PAGE_SIZE = 20;
const STATUSES = Object.keys(STATUS_LABELS) as ReportStatus[];

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : fr.errors.network;
}

export default function AdminPage() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" style={{ paddingTop: "var(--safe-top)" }}>
      <TopBar
        variant="solid"
        title={fr.moderation.admin.title}
        subtitle="Back-office"
        leading={
          <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => navigate("/profile")}>
            <ChevronLeft />
          </IconButton>
        }
      >
        <nav aria-label="Sections du back-office" className="flex gap-1 overflow-x-auto px-1 pb-2">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn("ml-chip inline-flex min-h-11 shrink-0 items-center rounded-full border border-line px-4 text-[14px] font-semibold", isActive ? "bg-primary text-primary-fg" : "bg-surface text-fg")}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      </TopBar>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-4">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="reports" element={<ReportsTab />} />
            <Route path="flags" element={<FlagsTab />} />
            <Route path="users" element={<UsersTab />} />
            <Route path="alerts" element={<AlertsTab />} />
            <Route path="*" element={<Navigate to="" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Dashboard() {
  const q = useQuery({ queryKey: qk.adminStats, queryFn: api.admin.stats, refetchInterval: 60_000 });
  const s: AdminStats | undefined = q.data;
  if (q.isError) return <EmptyState title={fr.errors.forbidden} description={errMsg(q.error)} />;
  if (!s) return <p className="text-muted">{fr.common.loading}</p>;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <Stat value={s.reportsTotal} label="Signalements" />
        <Stat value={s.reportsActive} label="Actifs" />
        <Stat value={s.reportsLast24h} label="Dernières 24 h" />
        <Stat value={s.usersTotal} label="Utilisateurs" />
        <Stat value={s.flagsOpen} label={fr.moderation.admin.openFlags} tone={s.flagsOpen > 0 ? "accent" : undefined} />
        <Stat value={s.avgResolutionHours == null ? "—" : `${Math.round(s.avgResolutionHours)} h`} label="Délai moyen de résolution" />
      </div>
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-[16px] font-bold text-fg">Signalements par catégorie</h2>
        <BarChart data={CATEGORIES.map((c) => ({ label: c.shortLabel, value: s.reportsByCategory[c.id] ?? 0, color: c.color }))} aria-label="Signalements par catégorie" />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between text-[14px] text-muted">
      <span>
        {total} résultat{total > 1 ? "s" : ""} · page {page}/{pages}
      </span>
      <div className="flex gap-1">
        <IconButton aria-label="Page précédente" variant="outline" size={44} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </IconButton>
        <IconButton aria-label="Page suivante" variant="outline" size={44} disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </IconButton>
      </div>
    </div>
  );
}

function ReportsTab() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Report | null>(null);
  const [deleting, setDeleting] = useState<Report | null>(null);
  const params = { status: status || undefined, category: category || undefined, q: search || undefined, page, includeInactive: !status };
  const q = useQuery({ queryKey: qk.adminReports(params), queryFn: () => api.admin.reports(params), placeholderData: (prev) => prev });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
    void queryClient.invalidateQueries({ queryKey: qk.reportsRoot });
  };
  const del = useMutation({
    mutationFn: (id: string) => api.admin.deleteReport(id),
    onSuccess: () => {
      toast.success("Signalement supprimé.");
      setDeleting(null);
      invalidate();
    },
    onError: (e) => toast.danger(errMsg(e)),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input size="md" leftIcon={<Search />} placeholder="Rechercher (texte, zone, sous-type, id)" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label={fr.common.search} />
        <Select size="md" aria-label="Statut" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="Tous les statuts" options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
        <Select size="md" aria-label="Catégorie" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} placeholder="Toutes les catégories" options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} />
      </div>
      {q.isError ? <EmptyState title={fr.errors.forbidden} description={errMsg(q.error)} /> : null}
      <ul className="flex flex-col gap-2">
        {(q.data?.reports ?? []).map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 md:flex-row md:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white" style={{ background: CATEGORIES.find((c) => c.id === r.category)?.color }} aria-hidden="true">
                <CategoryIcon subtype={r.subtype} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold text-fg">
                  {SUBTYPE_BY_ID[r.subtype]?.label ?? r.subtype} <span className="font-normal text-muted">· {r.zone ?? "—"}</span>
                </p>
                <p className="truncate text-[13px] text-muted">
                  {r.authorPseudo ?? "Anonyme"} · {formatDateTime(r.createdAt)} · {r.confirmationsCount} conf. · {r.disputesCount} contest.
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <StatusPill status={r.status} />
                  <ConfidenceBadge label={r.confidenceLabel} score={r.confidenceScore} />
                  <SourceBadge source={r.source} />
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <Button size="md" variant="secondary" onClick={() => navigate(`/reports/${r.id}`)}>
                Voir
              </Button>
              <Button size="md" variant="outline" onClick={() => setEditing(r)}>
                {fr.common.edit}
              </Button>
              <Button size="md" variant="danger" leftIcon={<Trash2 />} onClick={() => setDeleting(r)}>
                {fr.moderation.admin.delete}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {q.data ? <Pager page={page} total={q.data.total} onPage={setPage} /> : null}
      <EditReportModal report={editing} onClose={() => setEditing(null)} onSaved={invalidate} />
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        tone="danger"
        title={fr.moderation.admin.delete}
        description={fr.moderation.admin.confirmDelete}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>{fr.common.cancel}</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => deleting && del.mutate(deleting.id)}>{fr.common.delete}</Button>
          </>
        }
      />
    </div>
  );
}

function EditReportModal({ report, onClose, onSaved }: { report: Report | null; onClose: () => void; onSaved: () => void }) {
  const [subtype, setSubtype] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [danger, setDanger] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [description, setDescription] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (report && loadedFor !== report.id) {
    setLoadedFor(report.id);
    setSubtype(report.subtype);
    setStatus(report.status);
    setDanger(report.dangerLevel ?? "");
    setSource(report.source);
    setDescription(report.description ?? "");
  }
  const save = useMutation({
    mutationFn: () =>
      api.admin.updateReport(report!.id, {
        subtype,
        status: status as ReportStatus,
        dangerLevel: (danger || null) as DangerLevel | null,
        source: source as ReportSource,
        description: description.trim() || null,
      }),
    onSuccess: () => {
      toast.success(fr.profilePage.saved);
      onSaved();
      onClose();
    },
    onError: (e) => toast.danger(errMsg(e)),
  });
  const grouped = CATEGORIES.map((c) => ({ c, items: subtypesOf(c.id) }));
  return (
    <Modal
      open={Boolean(report)}
      onClose={onClose}
      title={`${fr.common.edit} — ${report ? (SUBTYPE_BY_ID[report.subtype]?.label ?? "") : ""}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{fr.common.cancel}</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>{fr.common.save}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={fr.moderation.admin.changeCategory}>
          <Select value={subtype} onChange={(e) => setSubtype(e.target.value)}>
            {grouped.map(({ c, items }) => (
              <optgroup key={c.id} label={c.label}>
                {items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label={fr.moderation.admin.changeStatus}>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))} />
        </Field>
        <Field label={fr.wizard.dangerLevel}>
          <Select value={danger} onChange={(e) => setDanger(e.target.value)} placeholder="Aucun" options={DANGER_LEVELS.map((d) => ({ value: d.id, label: d.label }))} />
        </Field>
        <Field label={fr.sheet.source}>
          <Select value={source} onChange={(e) => setSource(e.target.value)} options={[{ value: "community", label: "Communauté" }, { value: "partner", label: "Partenaire vérifié" }, { value: "official", label: "Source officielle" }]} />
        </Field>
        <Field label={fr.sheet.description} optional>
          <Textarea value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
function FlagsTab() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"open" | "reviewing" | "resolved" | "rejected" | "">("open");
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState<(ContentFlag & { report: Report | null }) | null>(null);
  const [note, setNote] = useState("");
  const [action, setAction] = useState<"none" | "delete_content" | "suspend_author">("none");
  const [nextStatus, setNextStatus] = useState<"resolved" | "rejected" | "reviewing">("resolved");
  const params = { status: status || undefined, page };
  const q = useQuery({ queryKey: qk.adminFlags(params), queryFn: () => api.admin.flags(params), placeholderData: (prev) => prev });
  const update = useMutation({
    mutationFn: (p: { id: string; status: string; resolutionNote?: string | null; action?: string }) => api.admin.updateFlag(p.id, { status: p.status, resolutionNote: p.resolutionNote, action: p.action }),
    onSuccess: () => {
      toast.success("Litige mis à jour.");
      setActing(null);
      setNote("");
      setAction("none");
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
      void queryClient.invalidateQueries({ queryKey: qk.reportsRoot });
    },
    onError: (e) => toast.danger(errMsg(e)),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {([
          ["open", "Ouverts"],
          ["reviewing", "En cours"],
          ["resolved", "Traités"],
          ["rejected", "Rejetés"],
        ] as const).map(([v, l]) => (
          <button key={v} type="button" onClick={() => { setStatus(v); setPage(1); }} className={cn("min-h-11 rounded-full border border-line px-4 text-[14px] font-semibold", status === v ? "bg-primary text-primary-fg" : "bg-surface text-fg")}>
            {l}
          </button>
        ))}
      </div>
      {q.isError ? <EmptyState title={fr.errors.forbidden} description={errMsg(q.error)} /> : null}
      {q.data && q.data.flags.length === 0 ? <EmptyState compact title="Aucun litige dans cette file." /> : null}
      <ul className="flex flex-col gap-2">
        {(q.data?.flags ?? []).map((f) => (
          <li key={f.id} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={f.status === "open" ? "accent" : f.status === "reviewing" ? "info" : "neutral"}>{{ open: "Ouvert", reviewing: "En cours", resolved: "Traité", rejected: "Rejeté" }[f.status]}</Badge>
              <span className="text-[15px] font-bold text-fg">{fr.moderation.reasons[f.reason]}</span>
              <span className="text-[13px] text-muted">· {formatDateTime(f.createdAt)}</span>
            </div>
            {f.details ? <p className="mt-1 text-[14px] text-fg">{f.details}</p> : null}
            {f.report ? (
              <button type="button" onClick={() => navigate(`/reports/${f.report!.id}`)} className="mt-2 flex w-full items-center gap-2 rounded-lg bg-surface-2 p-2 text-left">
                <CategoryIcon subtype={f.report.subtype} className="size-5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[14px] text-fg">
                  {SUBTYPE_BY_ID[f.report.subtype]?.label} · {f.report.zone ?? "—"} · {f.report.authorPseudo ?? "Anonyme"}
                </span>
                <StatusPill status={f.report.status} />
              </button>
            ) : (
              <p className="mt-2 text-[13px] text-muted">Contenu visé : {f.commentId ? "commentaire" : f.photoId ? "photo" : "signalement supprimé"}</p>
            )}
            {f.resolutionNote ? <p className="mt-1 text-[13px] text-muted">Note : {f.resolutionNote}</p> : null}
            {f.status === "open" || f.status === "reviewing" ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {f.status === "open" ? (
                  <Button size="md" variant="secondary" onClick={() => update.mutate({ id: f.id, status: "reviewing" })}>
                    {fr.moderation.admin.review}
                  </Button>
                ) : null}
                <Button size="md" variant="outline" onClick={() => { setActing(f); setNextStatus("rejected"); setAction("none"); }}>
                  {fr.moderation.admin.rejectFlag}
                </Button>
                <Button size="md" onClick={() => { setActing(f); setNextStatus("resolved"); setAction("none"); }}>
                  {fr.moderation.admin.resolveFlag}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {q.data ? <Pager page={page} total={q.data.total} onPage={setPage} /> : null}
      <Modal
        open={Boolean(acting)}
        onClose={() => setActing(null)}
        title={nextStatus === "rejected" ? fr.moderation.admin.rejectFlag : fr.moderation.admin.resolveFlag}
        footer={
          <>
            <Button variant="ghost" onClick={() => setActing(null)}>{fr.common.cancel}</Button>
            <Button loading={update.isPending} variant={action === "none" ? "primary" : "danger"} onClick={() => acting && update.mutate({ id: acting.id, status: nextStatus, resolutionNote: note.trim() || null, action })}>
              {fr.common.validate}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {nextStatus === "resolved" ? (
            <Field label="Action">
              <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)} options={[{ value: "none", label: fr.moderation.admin.actionNone }, { value: "delete_content", label: fr.moderation.admin.actionDelete }, { value: "suspend_author", label: `${fr.moderation.admin.actionSuspend} (7 jours)` }]} />
            </Field>
          ) : null}
          <Field label={fr.moderation.admin.resolutionNote} optional>
            <Textarea value={note} maxLength={600} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function UsersTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const params = { q: search || undefined, page };
  const q = useQuery({ queryKey: qk.adminUsers(params), queryFn: () => api.admin.users(params), placeholderData: (prev) => prev });
  const suspend = useMutation({
    mutationFn: (p: { id: string; hours: number }) => api.admin.suspendUser(p.id, { hours: p.hours, reason: p.hours ? "Décision de modération" : undefined }),
    onSuccess: (_r, v) => {
      toast.success(v.hours ? "Compte suspendu." : "Suspension levée.");
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (e) => toast.danger(errMsg(e)),
  });
  return (
    <div className="flex flex-col gap-3">
      <Input size="md" leftIcon={<Search />} placeholder="Pseudo, e-mail ou identifiant" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label={fr.common.search} />
      {q.isError ? <EmptyState title={fr.errors.forbidden} description={errMsg(q.error)} /> : null}
      <ul className="flex flex-col gap-2">
        {(q.data?.users ?? []).map((u) => {
          const suspended = u.suspendedUntil && new Date(u.suspendedUntil).getTime() > Date.now();
          return (
            <li key={u.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 md:flex-row md:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={u.pseudo} size={40} role={u.role} />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-bold text-fg">
                    {u.pseudo} <Badge tone={u.role === "admin" || u.role === "moderator" ? "primary" : u.role === "official" ? "gold" : u.role === "partner" ? "success" : "neutral"}>{u.role}</Badge>
                  </p>
                  <p className="truncate text-[13px] text-muted">
                    {u.email} · niveau {u.reliabilityLevel}/5 · {u.reportsCount} signalements · {u.confirmationsCount} confirmations
                  </p>
                  {suspended ? <p className="text-[13px] font-semibold text-danger">Suspendu jusqu'au {formatDateTime(u.suspendedUntil!)}</p> : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                {suspended ? (
                  <Button size="md" variant="outline" onClick={() => suspend.mutate({ id: u.id, hours: 0 })}>{fr.moderation.admin.unsuspend}</Button>
                ) : (
                  <>
                    <Button size="md" variant="outline" onClick={() => suspend.mutate({ id: u.id, hours: 24 })}>24 h</Button>
                    <Button size="md" variant="outline" onClick={() => suspend.mutate({ id: u.id, hours: 24 * 7 })}>7 j</Button>
                    <Button size="md" variant="danger" onClick={() => suspend.mutate({ id: u.id, hours: 24 * 30 })}>30 j</Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {q.data ? <Pager page={page} total={q.data.total} onPage={setPage} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
const CORSICA_BBOX = { west: 8.5, south: 41.3, east: 9.6, north: 43.1 };

function AlertsTab() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ organisation: "", title: "", body: "", category: "danger" as ReportCategory, severity: "high" as DangerLevel, startsAt: new Date().toISOString().slice(0, 16), endsAt: "", url: "" });
  const [geometry, setGeometry] = useState<AlertGeometry | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => api.officialAlerts(CORSICA_BBOX) });
  const create = useMutation({
    mutationFn: (input: OfficialAlertInput) => api.admin.createAlert(input),
    onSuccess: () => {
      toast.success("Alerte officielle publiée.");
      setOpen(false);
      setGeometry(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "alerts"] });
      void queryClient.invalidateQueries({ queryKey: qk.reportsRoot });
    },
    onError: (e) => toast.danger(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.admin.deleteAlert(id),
    onSuccess: () => {
      toast.success("Alerte supprimée.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "alerts"] });
      void queryClient.invalidateQueries({ queryKey: qk.reportsRoot });
    },
    onError: (e) => toast.danger(errMsg(e)),
  });
  const submit = () => {
    const parsed = officialAlertSchema.safeParse({
      ...form,
      geometry,
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : undefined,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      url: form.url.trim() || null,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0] ?? "form")] = i.message;
      if (!geometry) next.geometry = "Placez un point ou dessinez une zone.";
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };
  const set = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });

  return (
    <div className="flex flex-col gap-3">
      <Button size="lg" leftIcon={<Plus />} onClick={() => setOpen(true)}>
        {fr.moderation.admin.publishAlert}
      </Button>
      <ul className="flex flex-col gap-2">
        {(list.data?.officialAlerts ?? []).map((a) => (
          <li key={a.id} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-fg">{a.title}</p>
              <p className="text-[13px] text-muted">
                {a.organisation} · {formatDateTime(a.startsAt)} → {a.endsAt ? formatDateTime(a.endsAt) : "sans fin"} · {a.geometry.type === "Polygon" ? "zone" : "point"}
              </p>
              <p className="mt-1 text-[14px] text-fg">{a.body}</p>
            </div>
            <Button size="md" variant="danger" leftIcon={<Trash2 />} loading={del.isPending} onClick={() => del.mutate(a.id)}>
              {fr.common.delete}
            </Button>
          </li>
        ))}
        {list.data && list.data.officialAlerts.length === 0 ? <EmptyState compact title="Aucune alerte officielle en cours." /> : null}
      </ul>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={fr.moderation.admin.publishAlert}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{fr.common.cancel}</Button>
            <Button loading={create.isPending} onClick={submit}>{fr.common.publish}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Organisation" required error={errors.organisation}>
            <Input value={form.organisation} onChange={(e) => set("organisation", e.target.value)} placeholder="Préfecture de Haute-Corse, Mairie de Corte…" />
          </Field>
          <Field label="Titre" required error={errors.title}>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <Field label="Texte" error={errors.body}>
            <Textarea value={form.body} maxLength={2000} onChange={(e) => set("body", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Catégorie">
              <Select value={form.category} onChange={(e) => set("category", e.target.value)} options={CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} />
            </Field>
            <Field label="Sévérité">
              <Select value={form.severity} onChange={(e) => set("severity", e.target.value)} options={DANGER_LEVELS.map((d) => ({ value: d.id, label: d.label }))} />
            </Field>
            <Field label="Début" error={errors.startsAt}>
              <Input type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
            </Field>
            <Field label="Fin" optional error={errors.endsAt}>
              <Input type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
            </Field>
          </div>
          <Field label="Lien officiel" optional error={errors.url}>
            <Input type="url" value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Géométrie" required error={errors.geometry}>
            <GeometryPicker value={geometry} onChange={setGeometry} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

