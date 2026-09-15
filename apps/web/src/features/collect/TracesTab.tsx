/**
 * Bibliothèque GPX (sections 15, 17, 18 du cahier des charges GPX).
 *
 * Une trace n'est pas un fichier rangé dans un dossier : c'est une observation
 * géographique dont on doit connaître la provenance, les droits, la qualité et
 * ce qu'elle apporte au réseau. Chaque ligne affiche donc les quatre, et les
 * actions de modération sont à portée.
 */
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GitCompare, Link2, Trash2, Upload, X } from "lucide-react";
import { formatDistance, fr, type ImportTraceResponse, type ImportedTraceDto, type LicenceId, type TraceComparisonResponse } from "@mountain-live/core";
import { Badge, Button, Chip, EmptyState, Field, Input, Select, Textarea, Toggle, toast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatDateTime } from "@/lib/format";
import {
  LICENCE_LABELS,
  ORIGIN_QUESTION,
  QUALITY_LABELS,
  QUALITY_TONE,
  RIGHTS_QUESTION,
  TRACE_STATUS_LABELS,
  formatFromFileName,
} from "./labels";

const STATUSES = ["review_required", "approved", "rejected", "merged"] as const;
const LICENCES = Object.keys(LICENCE_LABELS) as LicenceId[];

export function TracesTab() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | null>("review_required");
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState<"file" | "url" | null>(null);

  const traces = useQuery({
    queryKey: qk.collectTraces({ status }),
    queryFn: () => api.traces.list({ status: status ?? undefined, limit: 100 }),
    staleTime: 30_000,
  });

  const review = useMutation({
    mutationFn: (p: { id: string; status: ImportedTraceDto["status"]; licence?: LicenceId }) =>
      api.traces.review(p.id, { status: p.status, licence: p.licence }),
    onSuccess: (data) => {
      toast.success(
        data.trace.status === "approved"
          ? `Trace validée : ${data.attested} segment(s) attesté(s).`
          : "Trace mise à jour.",
      );
      void queryClient.invalidateQueries({ queryKey: ["collectTraces"] });
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.traces.remove(id),
    onSuccess: () => {
      toast.success("Trace supprimée.");
      void queryClient.invalidateQueries({ queryKey: ["collectTraces"] });
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  const compare = useMutation({
    mutationFn: () => api.traces.compare({ traceIds: selected }),
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  const list = traces.data?.traces ?? [];

  return (
    <section className="space-y-4" aria-label="Bibliothèque GPX">
      <header className="space-y-2">
        <p className="text-[14px] text-muted">
          Une trace trouvée sur Internet est une <strong>observation</strong>, pas la vérité : elle peut être ancienne,
          approximative, ou suivre un chemin disparu. Elle enrichit la confiance d'un chemin, elle ne le décrète pas.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Chip selected={status === null} onClick={() => setStatus(null)}>
            Toutes
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>
              {TRACE_STATUS_LABELS[s]}
            </Chip>
          ))}
          <div className="ml-auto flex gap-2">
            <Button size="md" variant="secondary" onClick={() => setImporting(importing === "file" ? null : "file")}>
              <Upload className="h-4 w-4" aria-hidden /> Importer un fichier
            </Button>
            <Button size="md" variant="secondary" onClick={() => setImporting(importing === "url" ? null : "url")}>
              <Link2 className="h-4 w-4" aria-hidden /> Importer depuis une URL
            </Button>
          </div>
        </div>
      </header>

      {importing === "file" && <FileImport onDone={() => setImporting(null)} />}
      {importing === "url" && <UrlImport onDone={() => setImporting(null)} />}

      {selected.length >= 2 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
          <span className="text-[14px] font-semibold text-fg">{selected.length} traces sélectionnées</span>
          <Button size="md" onClick={() => compare.mutate()} disabled={compare.isPending}>
            <GitCompare className="h-4 w-4" aria-hidden /> Comparer
          </Button>
          <Button size="md" variant="ghost" onClick={() => setSelected([])}>
            Annuler la sélection
          </Button>
        </div>
      )}

      {compare.data && <ComparisonResult data={compare.data} />}

      {traces.isLoading && <p className="text-[14px] text-muted">Chargement…</p>}
      {!traces.isLoading && list.length === 0 && (
        <EmptyState
          title="Aucune trace"
          description="Importez un fichier GPX, KML ou GeoJSON, ou lancez une campagne de découverte sur un territoire."
        />
      )}

      <ul className="space-y-3">
        {list.map((trace) => (
          <li key={trace.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start gap-2">
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-line"
                  checked={selected.includes(trace.id)}
                  onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, trace.id] : prev.filter((id) => id !== trace.id)))}
                  aria-label={`Sélectionner ${trace.name ?? "cette trace"}`}
                />
              </label>
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-bold text-fg">{trace.name ?? "Trace sans nom"}</h3>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                  <span>{trace.sourceName ?? "source non renseignée"}</span>
                  <span>· {LICENCE_LABELS[trace.licence]}</span>
                  {trace.territory && <span>· {trace.territory}</span>}
                  <span>· importée le {formatDateTime(trace.importedAt)}</span>
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={trace.status === "approved" ? "success" : trace.status === "rejected" ? "danger" : "neutral"}>
                  {TRACE_STATUS_LABELS[trace.status]}
                </Badge>
                {trace.qualityLevel && <Badge tone={QUALITY_TONE[trace.qualityLevel]}>{QUALITY_LABELS[trace.qualityLevel]}</Badge>}
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-5">
              <div>
                <dt className="text-muted">Distance</dt>
                <dd className="font-semibold text-fg">{formatDistance(trace.distanceM)}</dd>
              </div>
              <div>
                <dt className="text-muted">Dénivelé</dt>
                <dd className="font-semibold text-fg">
                  {trace.elevationGainM !== null ? `+${Math.round(trace.elevationGainM)} m` : "—"}
                  {trace.elevationLossM !== null ? ` / −${Math.round(trace.elevationLossM)} m` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Points</dt>
                <dd className="font-semibold text-fg">{trace.points}</dd>
              </div>
              <div>
                <dt className="text-muted">Chemins empruntés</dt>
                <dd className="font-semibold text-fg">{trace.segmentCount}</dd>
              </div>
              <div>
                <dt className="text-muted">Rattachée</dt>
                <dd className="font-semibold text-fg">
                  {trace.matchedRatio !== null ? `${Math.round(trace.matchedRatio * 100)} %` : "—"}
                </dd>
              </div>
            </dl>

            {trace.duplicateOf && (
              <p className="mt-2 rounded-xl bg-bg px-3 py-2 text-[13px] text-fg">
                Même géométrie qu'une trace déjà présente : à comparer avant de valider.
              </p>
            )}
            {trace.qualityFlags.length > 0 && (
              <p className="mt-2 text-[13px] text-muted">Signalé : {trace.qualityFlags.join(", ")}</p>
            )}
            {trace.attribution && <p className="mt-2 text-[13px] text-muted">Attribution : {trace.attribution}</p>}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="md" onClick={() => review.mutate({ id: trace.id, status: "approved" })} disabled={review.isPending || trace.licence === "unknown"}>
                <Check className="h-4 w-4" aria-hidden /> Valider
              </Button>
              <Button size="md" variant="secondary" onClick={() => review.mutate({ id: trace.id, status: "rejected" })} disabled={review.isPending}>
                <X className="h-4 w-4" aria-hidden /> Rejeter
              </Button>
              <Button size="md" variant="danger" onClick={() => remove.mutate(trace.id)} disabled={remove.isPending}>
                <Trash2 className="h-4 w-4" aria-hidden /> Supprimer
              </Button>
              {trace.originUrl && (
                <a href={trace.originUrl} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex min-h-11 items-center text-[14px] font-semibold text-primary">
                  Voir la source
                </a>
              )}
            </div>
            {trace.licence === "unknown" && (
              <p className="mt-2 text-[13px] text-muted">
                Licence non identifiée : renseignez-la sur la source avant de valider cette trace.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ImportSummary({ result }: { result: ImportTraceResponse }) {
  const s = result.summary;
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-bg p-3 text-[13px]">
      <p className="font-semibold text-fg">
        {formatDistance(s.distanceM)} · {s.points} points ·{" "}
        {s.elevationGainM !== null ? `+${Math.round(s.elevationGainM)} m` : "dénivelé inconnu"}
      </p>
      <p className="text-muted">
        {s.matchedSegments} chemin(s) correspondant(s), {Math.round(s.matchedRatio * 100)} % de la trace rattachée au réseau.
      </p>
      <p className="text-muted">Qualité : {s.quality}</p>
      <p className="text-fg">{result.decision.reason}</p>
      {result.note && <p className="text-fg">{result.note}</p>}
    </div>
  );
}

function FileImport({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState<{ name: string; text: string } | null>(null);
  const [declaredOrigin, setDeclaredOrigin] = useState("");
  const [declaredRights, setDeclaredRights] = useState(false);

  const upload = useMutation({
    mutationFn: () =>
      api.traces.upload({
        content: content?.text ?? "",
        fileName: content?.name ?? null,
        activity: "all",
        declaredOrigin: declaredOrigin || null,
        declaredRights,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["collectTraces"] }),
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-[16px] font-bold text-fg">Importer un fichier</h3>
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,.kml,.geojson,.json"
        className="block w-full text-[14px]"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!formatFromFileName(file.name)) {
            toast.danger("Formats acceptés : .gpx, .kml, .geojson");
            return;
          }
          setContent({ name: file.name, text: await file.text() });
        }}
      />
      <Field label={ORIGIN_QUESTION}>
        <Textarea rows={2} value={declaredOrigin} onChange={(e) => setDeclaredOrigin(e.target.value)} placeholder="Site, organisme, relevé personnel…" />
      </Field>
      <Toggle checked={declaredRights} onChange={setDeclaredRights} label={RIGHTS_QUESTION} />
      <p className="text-[13px] text-muted">
        Cette déclaration est enregistrée avec la trace. Elle engage son auteur : elle ne vaut pas vérification, et la
        trace part en revue.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => upload.mutate()} disabled={!content || upload.isPending}>
          Analyser et importer
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {fr.common.cancel}
        </Button>
      </div>
      {upload.data && <ImportSummary result={upload.data} />}
    </div>
  );
}

function UrlImport({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [declaredOrigin, setDeclaredOrigin] = useState("");
  const [declaredRights, setDeclaredRights] = useState(false);

  const run = useMutation({
    mutationFn: () => api.traces.importUrl({ url, activity: "all", declaredOrigin: declaredOrigin || null, declaredRights }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["collectTraces"] }),
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-[16px] font-bold text-fg">Importer depuis une URL</h3>
      <Field label="Adresse du fichier">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" placeholder="https://…/parcours.gpx" />
      </Field>
      <p className="text-[13px] text-muted">
        Le robots.txt du site est vérifié avant toute tentative de téléchargement : une adresse que le site interdit à
        la collecte n'est pas récupérée.
      </p>
      <Field label={ORIGIN_QUESTION}>
        <Textarea rows={2} value={declaredOrigin} onChange={(e) => setDeclaredOrigin(e.target.value)} />
      </Field>
      <Toggle checked={declaredRights} onChange={setDeclaredRights} label={RIGHTS_QUESTION} />
      <div className="flex gap-2">
        <Button onClick={() => run.mutate()} disabled={!url || run.isPending}>
          Télécharger et analyser
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {fr.common.cancel}
        </Button>
      </div>
      {run.data && <ImportSummary result={run.data} />}
    </div>
  );
}

function ComparisonResult({ data }: { data: TraceComparisonResponse }) {
  const pairs = useMemo(() => data.comparisons.slice(0, 20), [data.comparisons]);
  return (
    <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <h3 className="text-[16px] font-bold text-fg">Superposition</h3>
      {data.corridors.length > 0 ? (
        <ul className="space-y-2">
          {data.corridors.map((corridor) => (
            <li key={corridor.id} className="rounded-xl bg-bg p-3 text-[13px]">
              <p className="font-semibold text-fg">
                {corridor.traceIds.length} traces · {corridor.uniqueSources} source(s) indépendante(s) ·{" "}
                {formatDistance(corridor.lengthM)}
              </p>
              <p className="text-muted">
                Dispersion latérale {corridor.dispersionM} m · confiance {Math.round(corridor.confidence * 100)} %
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">{data.note}</p>
      )}
      <ul className="space-y-1 text-[13px] text-muted">
        {pairs.map((c) => (
          <li key={`${c.a}-${c.b}`}>
            Recouvrement {Math.round(c.overlap * 100)} % · écart médian {Math.round(c.medianDeviationM)} m ·{" "}
            {c.sameDirection ? "même sens" : "sens opposé"}
            {c.variants.length > 0 ? ` · ${c.variants.length} variante(s)` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
