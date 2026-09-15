/**
 * Assistant d'ouverture d'un territoire (sections 16 et 23).
 *
 * Le plan et les requêtes sont montrés AVANT d'être lancés : un administrateur
 * doit pouvoir voir ce que le système s'apprête à faire. Et le bilan d'une
 * campagne ne compte que ce qui a réellement été constaté — jamais un chiffre
 * qui ferait croire à une collecte qui n'a pas eu lieu.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass, Play } from "lucide-react";
import { fr, type TerritoryDto } from "@mountain-live/core";
import { Badge, Button, Chip, EmptyState, Field, Textarea, toast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { REUSE_LABELS, REUSE_TONE } from "./labels";

export function TerritoryTab() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [urls, setUrls] = useState("");

  const territories = useQuery({
    queryKey: qk.collectTerritories,
    queryFn: () => api.collect.territories(),
    staleTime: 60_000,
  });

  const current = territories.data?.territories.find((t) => t.id === selected) ?? null;

  const plan = useQuery({
    queryKey: qk.collectPlan(selected ?? ""),
    queryFn: () => api.collect.plan(selected!),
    enabled: Boolean(selected),
    staleTime: 60_000,
  });

  const campaign = useMutation({
    mutationFn: () =>
      api.collect.discover(selected!, {
        urls: urls
          .split(/\s+/)
          .map((u) => u.trim())
          .filter((u) => /^https?:\/\//i.test(u))
          .slice(0, 50),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["collectDiscoveries"] }),
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  const list = territories.data?.territories ?? [];

  return (
    <section className="space-y-4" aria-label="Recherche par territoire">
      <p className="text-[14px] text-muted">
        Choisissez un territoire, examinez le plan, puis lancez la recherche de données de sentiers disponibles.
      </p>

      <div className="flex flex-wrap gap-2">
        {list.map((t) => (
          <Chip key={t.id} selected={selected === t.id} onClick={() => setSelected(t.id === selected ? null : t.id)}>
            {t.name}
          </Chip>
        ))}
      </div>

      {list.length === 0 && !territories.isLoading && (
        <EmptyState
          title="Aucun territoire"
          description="Amorcez le registre (db:seed-sources) pour créer les territoires pilotes."
        />
      )}

      {current && <Coverage territory={current} />}

      {plan.data && (
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-[16px] font-bold text-fg">Plan d'ouverture</h3>
          <ol className="space-y-2">
            {plan.data.steps.map((step) => (
              <li key={step.key} className="flex gap-3 text-[14px]">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg text-[12px] font-bold text-fg">
                  {step.order}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold text-fg">{step.label}</span>
                  {step.requiresNetwork && (
                    <Badge tone="neutral" size="sm" className="ml-2">
                      accès réseau requis
                    </Badge>
                  )}
                  <span className="block text-[13px] text-muted">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>

          <details className="rounded-xl bg-bg p-3">
            <summary className="cursor-pointer text-[14px] font-semibold text-fg">
              Requêtes préparées ({plan.data.queries.length})
            </summary>
            <ul className="mt-2 space-y-1 text-[13px] text-muted">
              {plan.data.queries.slice(0, 40).map((query) => (
                <li key={query.query}>« {query.query} »</li>
              ))}
            </ul>
            <p className="mt-2 text-[13px] text-muted">
              Ces requêtes ne sont soumises à aucun moteur de recherche généraliste : elles guident la recherche de
              catalogues ouverts et de partenaires.
            </p>
          </details>

          <Field label="Adresses à examiner (une par ligne)">
            <Textarea
              rows={4}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={"https://exemple.org/catalogue-sentiers\nhttps://exemple.org/parcours.gpx"}
            />
          </Field>
          <Button onClick={() => campaign.mutate()} disabled={campaign.isPending || !selected}>
            <Play className="h-4 w-4" aria-hidden /> Rechercher des données de sentiers disponibles
          </Button>
          <p className="text-[13px] text-muted">{plan.data.note}</p>
        </div>
      )}

      {campaign.data && (
        <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-[16px] font-bold text-fg">Résultat de la campagne</h3>
          {!campaign.data.networkAvailable && (
            <p className="rounded-xl bg-bg px-3 py-2 text-[13px] text-fg">{campaign.data.note}</p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            <div>
              <dt className="text-muted">Examinées</dt>
              <dd className="text-[18px] font-bold text-fg">{campaign.data.summary.total}</dd>
            </div>
            <div>
              <dt className="text-muted">Avec un GPX</dt>
              <dd className="text-[18px] font-bold text-fg">{campaign.data.summary.withGpx}</dd>
            </div>
            <div>
              <dt className="text-muted">À vérifier</dt>
              <dd className="text-[18px] font-bold text-fg">{campaign.data.summary.byStatus.review_required ?? 0}</dd>
            </div>
            <div>
              <dt className="text-muted">Interdites</dt>
              <dd className="text-[18px] font-bold text-fg">{campaign.data.summary.byStatus.forbidden ?? 0}</dd>
            </div>
          </dl>
          <ul className="space-y-2">
            {campaign.data.inspected.map((resource) => (
              <li key={resource.id} className="rounded-xl bg-bg p-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-semibold text-fg">{resource.title ?? resource.url}</span>
                  <Badge tone={REUSE_TONE[resource.status]} size="sm">
                    {REUSE_LABELS[resource.status]}
                  </Badge>
                </div>
                <p className="mt-1 text-muted">{resource.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Coverage({ territory }: { territory: TerritoryDto }) {
  const c = territory.coverage;
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="flex items-center gap-2 text-[16px] font-bold text-fg">
        <Compass className="h-4 w-4" aria-hidden /> Ce que l'on sait déjà de {territory.name}
      </h3>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-5">
        <div>
          <dt className="text-muted">Chemins</dt>
          <dd className="text-[18px] font-bold text-fg">{c.segments}</dd>
        </div>
        <div>
          <dt className="text-muted">Avec une source</dt>
          <dd className="text-[18px] font-bold text-fg">{c.withSource}</dd>
        </div>
        <div>
          <dt className="text-muted">Avec une trace</dt>
          <dd className="text-[18px] font-bold text-fg">{c.withTrace}</dd>
        </div>
        <div>
          <dt className="text-muted">Parcourus</dt>
          <dd className="text-[18px] font-bold text-fg">{c.withPassages}</dd>
        </div>
        <div>
          <dt className="text-muted">Confiance moyenne</dt>
          <dd className="text-[18px] font-bold text-fg">
            {c.averageConfidence !== null ? `${Math.round(c.averageConfidence)} / 100` : "—"}
          </dd>
        </div>
      </dl>
      {c.segments === 0 && (
        <p className="mt-2 text-[13px] text-muted">
          Aucun chemin connu sur ce territoire : commencez par importer le réseau OpenStreetMap (étape 1 du plan).
        </p>
      )}
    </div>
  );
}
