/**
 * Registre des sources (sections 4 et 5 du cahier des charges GPX).
 *
 * Ce que l'écran doit rendre évident : **rien n'est exploitable tant qu'une
 * personne n'a pas ouvert les conditions d'utilisation**. Une source non
 * vérifiée est affichée comme telle, et le bouton qui l'approuve demande la
 * licence constatée — on ne peut pas approuver « on ne sait pas ».
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { fr, type DataSourceDto, type LicenceId, type ReuseStatus } from "@mountain-live/core";
import { Badge, Button, Chip, EmptyState, Field, Input, Select, Textarea, toast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatDateTime } from "@/lib/format";
import { LICENCE_LABELS, REUSE_LABELS, REUSE_TONE, SOURCE_TYPE_LABELS } from "./labels";

const LICENCES = Object.keys(LICENCE_LABELS) as LicenceId[];
const STATUSES: ReuseStatus[] = ["review_required", "approved", "forbidden"];

const STATUS_ICON = {
  approved: <ShieldCheck className="h-4 w-4" aria-hidden />,
  review_required: <ShieldQuestion className="h-4 w-4" aria-hidden />,
  forbidden: <ShieldX className="h-4 w-4" aria-hidden />,
} as const;

export function SourcesTab() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReuseStatus | null>(null);
  const [adding, setAdding] = useState(false);
  const [review, setReview] = useState<Record<string, { licence: LicenceId; notes: string }>>({});

  const sources = useQuery({
    queryKey: qk.collectSources({ status }),
    queryFn: () => api.collect.sources({ status: status ?? undefined, limit: 200 }),
    staleTime: 30_000,
  });

  const decide = useMutation({
    mutationFn: (p: { id: string; status: ReuseStatus; licence?: LicenceId; notes?: string | null }) =>
      api.collect.reviewSource(p.id, { status: p.status, licence: p.licence, notes: p.notes ?? null }),
    onSuccess: () => {
      toast.success("Vérification enregistrée.");
      void queryClient.invalidateQueries({ queryKey: ["collectSources"] });
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  const list = sources.data?.sources ?? [];

  return (
    <section className="space-y-4" aria-label="Registre des sources">
      <header className="space-y-2">
        <p className="text-[14px] text-muted">
          Une source n'alimente la carte qu'après vérification humaine de ses conditions d'utilisation. Un bouton
          « Télécharger GPX » ne vaut pas autorisation de réutilisation.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Chip selected={status === null} onClick={() => setStatus(null)}>
            Toutes ({sources.data ? Object.values(sources.data.byStatus).reduce((n, v) => n + v, 0) : 0})
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>
              {REUSE_LABELS[s]} ({sources.data?.byStatus[s] ?? 0})
            </Chip>
          ))}
          <Button size="md" variant="secondary" className="ml-auto" onClick={() => setAdding((v) => !v)}>
            <Plus className="h-4 w-4" aria-hidden /> Ajouter une source
          </Button>
        </div>
      </header>

      {adding && <AddSource onDone={() => setAdding(false)} />}

      {sources.isLoading && <p className="text-[14px] text-muted">Chargement…</p>}
      {!sources.isLoading && list.length === 0 && (
        <EmptyState title="Aucune source enregistrée" description="Amorcez le registre ou ajoutez une source à vérifier." />
      )}

      <ul className="space-y-3">
        {list.map((source) => {
          const draft = review[source.id] ?? { licence: source.licence, notes: "" };
          return (
            <li key={source.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[16px] font-bold text-fg">{source.name}</h3>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                    <span>{SOURCE_TYPE_LABELS[source.type]}</span>
                    {source.territory && <span>· {source.territory}</span>}
                    {source.apiAvailable && <span>· API disponible</span>}
                  </p>
                </div>
                <Badge tone={REUSE_TONE[source.status]} icon={STATUS_ICON[source.status]}>
                  {REUSE_LABELS[source.status]}
                </Badge>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                <div>
                  <dt className="text-muted">Licence</dt>
                  <dd className="font-semibold text-fg">{LICENCE_LABELS[source.licence]}</dd>
                </div>
                <div>
                  <dt className="text-muted">Vérifiée le</dt>
                  <dd className="font-semibold text-fg">
                    {source.lastCheckedAt ? formatDateTime(source.lastCheckedAt) : "jamais"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Fiabilité</dt>
                  <dd className="font-semibold text-fg">{Math.round(source.reliabilityScore)} / 100</dd>
                </div>
                <div>
                  <dt className="text-muted">Traces importées</dt>
                  <dd className="font-semibold text-fg">{source.traceCount}</dd>
                </div>
              </dl>

              <p className="mt-3 rounded-xl bg-bg px-3 py-2 text-[13px] text-fg">{source.decision.reason}</p>
              {source.notes && <p className="mt-2 text-[13px] text-muted">{source.notes}</p>}

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Licence constatée" className="min-w-[180px] flex-1">
                  <Select
                    value={draft.licence}
                    onChange={(e) => setReview((r) => ({ ...r, [source.id]: { ...draft, licence: e.target.value as LicenceId } }))}
                    options={LICENCES.map((l) => ({ value: l, label: LICENCE_LABELS[l] }))}
                  />
                </Field>
                <Button
                  size="md"
                  onClick={() => decide.mutate({ id: source.id, status: "approved", licence: draft.licence, notes: draft.notes || null })}
                  disabled={decide.isPending || draft.licence === "unknown"}
                >
                  Approuver
                </Button>
                <Button size="md" variant="secondary" onClick={() => decide.mutate({ id: source.id, status: "review_required", licence: draft.licence })} disabled={decide.isPending}>
                  Remettre en revue
                </Button>
                <Button size="md" variant="danger" onClick={() => decide.mutate({ id: source.id, status: "forbidden", notes: draft.notes || null })} disabled={decide.isPending}>
                  Interdire
                </Button>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="ml-auto inline-flex min-h-11 items-center gap-1 text-[14px] font-semibold text-primary"
                >
                  Voir la source <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              </div>
              {draft.licence === "unknown" && (
                <p className="mt-2 text-[13px] text-muted">
                  Une source ne peut pas être approuvée tant que sa licence n'est pas identifiée.
                </p>
              )}
              <Field label="Note de vérification" className="mt-2">
                <Textarea
                  rows={2}
                  value={draft.notes}
                  placeholder="Ce qui a été constaté dans les conditions d'utilisation"
                  onChange={(e) => setReview((r) => ({ ...r, [source.id]: { ...draft, notes: e.target.value } }))}
                />
              </Field>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AddSource({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<DataSourceDto["type"]>("open_data");

  const create = useMutation({
    mutationFn: () => api.collect.createSource({ name, url, type, country: "FR", licence: "unknown", apiAvailable: false, reliabilityScore: 0 }),
    onSuccess: () => {
      toast.success("Source ajoutée, en attente de vérification.");
      void queryClient.invalidateQueries({ queryKey: ["collectSources"] });
      onDone();
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  return (
    <form
      className="space-y-3 rounded-2xl border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Field label="Nom de la source">
        <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
      </Field>
      <Field label="Adresse">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} required type="url" placeholder="https://" />
      </Field>
      <Field label="Type">
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as DataSourceDto["type"])}
          options={(Object.keys(SOURCE_TYPE_LABELS) as DataSourceDto["type"][]).map((t) => ({ value: t, label: SOURCE_TYPE_LABELS[t] }))}
        />
      </Field>
      <p className="text-[13px] text-muted">
        La source est créée « à vérifier », licence inconnue : elle n'alimentera rien avant d'avoir été contrôlée.
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending || !name || !url}>
          Ajouter
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {fr.common.cancel}
        </Button>
      </div>
    </form>
  );
}
