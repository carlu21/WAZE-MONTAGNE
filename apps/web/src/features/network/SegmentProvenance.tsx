/**
 * Provenance d'un chemin (sections 22 et 30 du cahier des charges GPX).
 *
 * L'utilisateur doit pouvoir savoir d'où vient ce qu'il regarde : quelles
 * sources attestent ce chemin, quels itinéraires l'empruntent, quelle
 * confiance lui accorder — et les mentions d'attribution exigées par les
 * licences, qui ne sont pas facultatives.
 */
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ShieldCheck } from "lucide-react";
import { fr, type SegmentSourcesResponse } from "@mountain-live/core";
import { Badge, Divider, SkeletonText } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

const LAYER_LABELS: Record<string, string> = {
  official: "Donnée officielle",
  osm: "OpenStreetMap",
  imported_gpx: "Trace importée",
  community: "Reconstruit par la communauté",
  observed: "Passages observés",
};

/** Un score de confiance qu'on ne peut pas expliquer ne sert à rien. */
function confidenceTone(score: number): "success" | "info" | "neutral" {
  if (score >= 75) return "success";
  if (score >= 45) return "info";
  return "neutral";
}

export function SegmentProvenance({ segmentId }: { segmentId: string }) {
  const { data, isLoading } = useQuery<SegmentSourcesResponse>({
    queryKey: qk.segmentSources(segmentId),
    queryFn: () => api.network.segmentSources(segmentId),
    enabled: Boolean(segmentId),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <SkeletonText lines={3} />;
  if (!data) return null;

  return (
    <section aria-label="Provenance de ce chemin" className="space-y-3">
      <Divider />
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-bold text-fg">
          <BookOpen className="h-4 w-4" aria-hidden /> D'où vient ce chemin
        </h3>
        <Badge tone={confidenceTone(data.confidence.score)} icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}>
          Confiance {Math.round(data.confidence.score)} / 100
        </Badge>
      </header>

      <p className="text-[13px] text-muted">
        Géométrie retenue : <span className="font-semibold text-fg">{LAYER_LABELS[data.geometry.layer] ?? data.geometry.layer}</span>
      </p>
      <p className="text-[13px] text-fg">{data.summary}</p>

      {data.confidence.reasons.length > 0 && (
        <ul className="space-y-0.5 text-[13px] text-muted">
          {data.confidence.reasons.map((reason) => (
            <li key={reason}>· {reason}</li>
          ))}
        </ul>
      )}

      {data.sources.length > 0 && (
        <div>
          <h4 className="text-[13px] font-semibold text-fg">Sources</h4>
          <ul className="mt-1 space-y-0.5 text-[13px] text-muted">
            {data.sources.map((source) => (
              <li key={source.id}>
                {source.name} <span className="text-muted">({source.licence})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.itineraries.length > 0 && (
        <div>
          <h4 className="text-[13px] font-semibold text-fg">Itinéraires empruntant ce chemin</h4>
          <ul className="mt-1 space-y-0.5 text-[13px] text-muted">
            {data.itineraries.map((it) => (
              <li key={it.id}>{it.name ?? "Itinéraire sans nom"}</li>
            ))}
          </ul>
        </div>
      )}

      {data.usage.insufficientData && (
        <p className="text-[13px] text-muted">
          Pas encore assez de passages pour publier une fréquentation. Absence de données n'est pas absence de chemin.
        </p>
      )}

      {data.attributions.length > 0 && (
        <p className="text-[12px] text-muted">{data.attributions.join(" · ")}</p>
      )}
    </section>
  );
}
