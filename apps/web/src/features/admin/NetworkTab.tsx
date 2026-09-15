/**
 * Back-office du réseau vivant (section 46 du moteur cartographique).
 *
 * Ce que le terrain propose, un humain en décide : chaque candidature affiche
 * sur quoi elle repose (passages, utilisateurs distincts, confiance) et se
 * tranche en deux gestes. Une correction de tracé acceptée archive l'ancienne
 * géométrie avant de la remplacer (section 47) — rien n'est jamais perdu.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, RefreshCw, X } from "lucide-react";
import { formatDistance, fr, type NetworkCandidateDto } from "@mountain-live/core";
import { Badge, Button, Chip, EmptyState, Field, Stat, Textarea, toast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatDateTime } from "@/lib/format";
import { NetworkHealthPanel } from "@/features/network/NetworkHealth";

const KINDS = ["new_trail", "geometry", "variant", "slow_zone", "turnaround", "confusion", "inactive"] as const;

function describe(candidate: NetworkCandidateDto): string {
  const d = candidate.detail as Record<string, number | string>;
  switch (candidate.kind) {
    case "new_trail":
      return `${formatDistance(Number(d.lengthM ?? 0))} · dispersion ${d.dispersionM ?? "?"} m`;
    case "geometry":
      return `Décalage médian ${d.offsetM ?? "?"} m (maximum ${d.maxOffsetM ?? "?"} m)`;
    case "variant":
      return `${formatDistance(Number(d.distanceM ?? 0))} · ${Math.round(Number(d.share ?? 0) * 100)} % des passages`;
    case "slow_zone":
      return `${d.speedKmh ?? "?"} km/h contre ${d.referenceKmh ?? "?"} km/h ailleurs`;
    case "turnaround":
      return `${Math.round(Number(d.rate ?? 0) * 100)} % des passages font demi-tour`;
    case "confusion":
      return `${Math.round(Number(d.rate ?? 0) * 100)} % des passages se trompent à cette intersection`;
    case "inactive":
      return `Dernier passage ${d.lastPassageAt ? formatDateTime(String(d.lastPassageAt)) : "inconnu"}`;
    default:
      return "";
  }
}

export function NetworkTab() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const candidates = useQuery({
    queryKey: qk.networkCandidates({ kind, status: "open" }),
    queryFn: () => api.network.candidates({ kind: kind ?? undefined, status: "open", limit: 200 }),
    staleTime: 30_000,
  });

  const review = useMutation({
    mutationFn: (p: { id: string; status: "accepted" | "rejected"; applyGeometry: boolean; note: string | null }) =>
      api.network.reviewCandidate(p.id, { status: p.status, note: p.note, applyGeometry: p.applyGeometry }),
    onSuccess: (_d, p) => {
      toast.success(p.status === "accepted" ? "Proposition validée." : "Proposition rejetée.");
      void queryClient.invalidateQueries({ queryKey: ["networkCandidates"] });
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  const rebuild = useMutation({
    mutationFn: () => api.network.rebuild(),
    onSuccess: (r) => {
      toast.success(`${r.statistics} statistiques et ${r.candidates} propositions recalculées.`);
      void queryClient.invalidateQueries({ queryKey: ["networkCandidates"] });
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  const list = candidates.data?.candidates ?? [];
  const open = candidates.data?.openByKind ?? {};

  return (
    <div className="flex flex-col gap-4" data-testid="admin-network">
      {/* Ce que contient la base, avant tout arbitrage sur ce qu'elle propose. */}
      <NetworkHealthPanel />
      <div className="flex flex-wrap items-center gap-2">
        <Chip selected={kind === null} onClick={() => setKind(null)}>
          {fr.common.all}
        </Chip>
        {KINDS.map((k) => (
          <Chip key={k} selected={kind === k} onClick={() => setKind(k)} count={open[k] ?? 0}>
            {fr.network.candidates.kinds[k]}
          </Chip>
        ))}
        <Button variant="ghost" leftIcon={<RefreshCw />} onClick={() => rebuild.mutate()} loading={rebuild.isPending} className="ml-auto">
          Recalculer
        </Button>
      </div>

      <p className="text-[13px] text-muted">{fr.network.candidates.hint}</p>

      {list.length === 0 ? (
        <EmptyState compact icon={<Check />} title={fr.network.candidates.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-surface p-3">
              <header className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone="primary">{fr.network.candidates.kinds[c.kind]}</Badge>
                {c.segmentName ? <span className="text-[15px] font-bold text-fg">{c.segmentName}</span> : null}
                <Badge tone={c.confidence >= 0.7 ? "success" : c.confidence >= 0.4 ? "info" : "neutral"}>
                  Confiance {Math.round(c.confidence * 100)} %
                </Badge>
              </header>
              <p className="text-[14px] text-fg">{describe(c)}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Stat value={c.observations} label="Passages" size="md" />
                <Stat value={c.uniqueUsers} label="Utilisateurs" size="md" />
                <Stat value={c.lastSeenAt ? formatDateTime(c.lastSeenAt) : "—"} label="Dernière observation" size="md" />
              </div>
              <Field label={fr.network.candidates.note} className="mt-2">
                <Textarea rows={2} value={note[c.id] ?? ""} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} maxLength={500} />
              </Field>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="md"
                  leftIcon={<Check />}
                  loading={review.isPending}
                  onClick={() => review.mutate({ id: c.id, status: "accepted", applyGeometry: c.kind === "geometry", note: note[c.id] ?? null })}
                  data-testid={`candidate-accept-${c.id}`}
                >
                  {c.kind === "geometry" ? "Valider et appliquer le tracé" : fr.network.candidates.accept}
                </Button>
                <Button
                  size="md"
                  variant="secondary"
                  leftIcon={<X />}
                  loading={review.isPending}
                  onClick={() => review.mutate({ id: c.id, status: "rejected", applyGeometry: false, note: note[c.id] ?? null })}
                >
                  {fr.network.candidates.reject}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
