/**
 * Synthèse du réseau vivant pour les gestionnaires (sections 44 et 45 du
 * moteur cartographique) : ce que les passages disent d'un territoire —
 * sentiers les plus fréquentés, répartition des pratiques, saisonnalité,
 * heures de pointe, propositions en attente.
 *
 * Toutes les valeurs sont agrégées et pseudonymisées : « 43 passages cette
 * semaine », jamais « qui est passé ».
 */
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, Users } from "lucide-react";
import { formatDistance, fr, type NetworkOverview } from "@mountain-live/core";
import { Badge, Card, EmptyState, SkeletonText, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { BarChart } from "@/features/admin/charts";

const MONTH_LABELS = ["jan.", "fév.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export interface NetworkOverviewPanelProps {
  from?: string;
  to?: string;
}

export function NetworkOverviewPanel({ from, to }: NetworkOverviewPanelProps) {
  const { data, isLoading } = useQuery<NetworkOverview>({
    queryKey: qk.networkOverview({ from, to }),
    queryFn: () => api.network.overview({ from, to }),
    staleTime: 60_000,
  });

  if (isLoading || !data) return <SkeletonText lines={4} />;

  const coverage = data.segmentsTotal > 0 ? Math.round((data.segmentsWithData / data.segmentsTotal) * 100) : 0;
  const monthly = Object.entries(data.monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([key, value]) => ({ label: MONTH_LABELS[Number(key.slice(5, 7)) - 1] ?? key, value }));
  const hourly = Array.from({ length: 24 }, (_, h) => ({ label: `${h}`, value: data.hourly[String(h)] ?? 0 })).filter((h, i) => i % 2 === 0 || h.value > 0);
  const activities = Object.entries(data.byActivity).sort((a, b) => b[1] - a[1]);
  const totalActivityPassages = activities.reduce((n, [, v]) => n + v, 0);

  if (data.passagesCount === 0) {
    return (
      <EmptyState
        compact
        icon={<Activity />}
        title={fr.network.frequentation.insufficient}
        description="Aucun passage enregistré sur cette période. Le réseau s'enrichit à mesure que les usagers contribuent leurs activités."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="network-overview">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat value={data.passagesCount} label="Passages" tone="primary" />
        <Stat value={data.contributorsCount} label="Contributeurs" icon={<Users />} />
        <Stat value={formatDistance(data.distanceM)} label="Distance parcourue" />
        <Stat value={`${coverage} %`} label="Réseau couvert" />
      </div>

      <Card padding="md">
        <h3 className="mb-2 text-[15px] font-bold text-fg">Pratiques</h3>
        <div className="flex flex-wrap gap-2">
          {activities.map(([activity, count]) => (
            <Badge key={activity} tone="neutral">
              {fr.navigation.activities[activity as keyof typeof fr.navigation.activities] ?? activity} ·{" "}
              {totalActivityPassages > 0 ? Math.round((count / totalActivityPassages) * 100) : 0} %
            </Badge>
          ))}
        </div>
      </Card>

      {monthly.length > 1 ? (
        <Card padding="md">
          <h3 className="mb-2 text-[15px] font-bold text-fg">Saisonnalité</h3>
          <BarChart data={monthly} aria-label="Passages par mois" />
        </Card>
      ) : null}

      <Card padding="md">
        <h3 className="mb-2 inline-flex items-center gap-2 text-[15px] font-bold text-fg">
          <Clock className="size-4" aria-hidden="true" /> Heures de pointe
        </h3>
        <BarChart data={hourly} aria-label="Passages par heure" />
      </Card>

      {data.topSegments.length > 0 ? (
        <Card padding="md">
          <h3 className="mb-2 text-[15px] font-bold text-fg">Chemins les plus fréquentés</h3>
          <ul className="divide-y divide-line">
            {data.topSegments.map((s) => (
              <li key={s.segmentId} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate text-[15px] text-fg">{s.name ?? "Chemin sans nom"}</span>
                <span className="tabular shrink-0 text-[15px] font-bold text-fg">{s.passages}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {Object.keys(data.openCandidates).length > 0 ? (
        <Card padding="md">
          <h3 className="mb-2 text-[15px] font-bold text-fg">{fr.network.candidates.title}</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.openCandidates).map(([kind, n]) => (
              <Badge key={kind} tone="accent">
                {fr.network.candidates.kinds[kind as keyof typeof fr.network.candidates.kinds] ?? kind} · {n}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted">{fr.network.candidates.hint}</p>
        </Card>
      ) : null}
    </div>
  );
}
