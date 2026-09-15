/**
 * ÉTAT DU RÉSEAU CARTOGRAPHIQUE (sections 25 à 28).
 *
 * Répond d'un coup d'œil à la question qui précède toutes les autres pendant le
 * développement : est-ce que je travaille sur des chemins réels, ou sur la
 * démonstration ? Les chiffres viennent de `GET /paths/stats` — aucun n'est
 * écrit en dur.
 */
import { useQuery } from "@tanstack/react-query";
import type { NetworkStats } from "@mountain-live/core";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { cn } from "@/components/ui/cn";

export interface NetworkStatus {
  stats: NetworkStats | null;
  /** Un réseau réellement relevé est disponible. `false` tant qu'on l'ignore. */
  realDataReady: boolean;
  isLoading: boolean;
}

export function useNetworkStatus(enabled = true): NetworkStatus {
  const query = useQuery({ queryKey: qk.networkStats, queryFn: api.networkStats, enabled, staleTime: 30_000, refetchInterval: 60_000 });
  return { stats: query.data ?? null, realDataReady: query.data?.realDataReady ?? false, isLoading: query.isLoading };
}

/**
 * Pastille discrète de développement. Elle n'apparaît QUE hors production :
 * l'utilisateur final n'a pas à connaître l'état de nos imports, mais pendant
 * le développement, ignorer sur quoi on travaille fait perdre des heures.
 */
export function NetworkBadge({ className }: { className?: string }) {
  const { stats, realDataReady } = useNetworkStatus(import.meta.env.DEV);
  if (!import.meta.env.DEV || !stats) return null;
  const real = stats.paths.osm + stats.paths.ign + stats.paths.gpx;
  return (
    <span
      className={cn(
        "glass pointer-events-none inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        realDataReady ? "text-fg" : "text-muted",
        className,
      )}
      data-testid="network-badge"
      title={`${stats.paths.total} segments · ${stats.trails.total} randonnées · ${stats.links.trailSegments} associations`}
    >
      <span className={cn("size-1.5 rounded-full", realDataReady ? "bg-success" : "bg-warning")} aria-hidden="true" />
      {realDataReady ? `Réseau réel · ${real.toLocaleString("fr-FR")} chemins` : "Données de démonstration"}
    </span>
  );
}

/** Ligne d'un tableau de décompte. */
function Row({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={cn("text-[14px]", muted ? "text-muted" : "text-fg")}>{label}</span>
      <span className="tabular text-[15px] font-bold text-fg">{value.toLocaleString("fr-FR")}</span>
    </div>
  );
}

/**
 * Panneau complet pour le back-office. Tous les chiffres sont dynamiques ; les
 * provenances à zéro restent affichées, parce qu'un zéro est une information.
 */
export function NetworkHealthPanel() {
  const { stats, realDataReady, isLoading } = useNetworkStatus();
  if (isLoading || !stats) return null;
  return (
    <section className="rounded-xl border border-line bg-surface p-4" aria-label="Réseau cartographique" data-testid="network-health">
      <header className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold text-fg">Réseau cartographique</h2>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold",
            realDataReady ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          <span className={cn("size-1.5 rounded-full", realDataReady ? "bg-success" : "bg-warning")} aria-hidden="true" />
          {realDataReady ? "Données réelles disponibles" : "Démonstration uniquement"}
        </span>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <h3 className="mb-1 text-[12px] font-bold uppercase tracking-wide text-muted">Chemins</h3>
          <Row label="Total" value={stats.paths.total} />
          <Row label="OpenStreetMap" value={stats.paths.osm} />
          <Row label="IGN" value={stats.paths.ign} muted={stats.paths.ign === 0} />
          <Row label="GPX" value={stats.paths.gpx} muted={stats.paths.gpx === 0} />
          <Row label="Démonstration" value={stats.paths.seed} muted />
          {stats.paths.unknown > 0 ? <Row label="Provenance manquante" value={stats.paths.unknown} /> : null}
        </div>
        <div>
          <h3 className="mb-1 text-[12px] font-bold uppercase tracking-wide text-muted">Randonnées</h3>
          <Row label="Total" value={stats.trails.total} />
          <Row label="OpenStreetMap" value={stats.trails.osm} />
          <Row label="IGN" value={stats.trails.ign} muted={stats.trails.ign === 0} />
          <Row label="GPX" value={stats.trails.gpx} muted={stats.trails.gpx === 0} />
          <Row label="Démonstration" value={stats.trails.seed} muted />
          {stats.trails.unknown > 0 ? <Row label="Provenance manquante" value={stats.trails.unknown} /> : null}
        </div>
        <div>
          <h3 className="mb-1 text-[12px] font-bold uppercase tracking-wide text-muted">Liaisons</h3>
          <Row label="Randonnée ↔ segments" value={stats.links.trailSegments} />
          <Row label="Randonnées reliées" value={stats.links.linkedTrails} />
          <Row label="Relevées sans segments" value={stats.links.orphanTrails} muted={stats.links.orphanTrails === 0} />
          {stats.links.orphanTrails > 0 ? (
            <p className="mt-1 text-[12px] leading-snug text-muted">
              Import incomplet : ces randonnées existent mais on ignore par où elles passent. Élargissez l'emprise d'import, puis relancez la liaison.
            </p>
          ) : null}
        </div>
      </div>

      <p className="mt-3 border-t border-line pt-2 text-[12px] text-muted">Données © les contributeurs OpenStreetMap, licence ODbL.</p>
    </section>
  );
}
