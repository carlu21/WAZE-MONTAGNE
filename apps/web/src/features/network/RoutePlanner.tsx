/**
 * Planificateur d'itinéraires (sections 22 et 23 du moteur cartographique) :
 * « je veux aller de Bastelica au Val d'Ese », et l'application propose
 * plusieurs chemins réellement empruntés — le plus rapide, le plus court, le
 * plus fréquenté, le plus facile — avec ce que les passages en disent.
 *
 * Les durées viennent des temps observés dès qu'il y en a, de l'estimation
 * théorique sinon, et le disent toujours (section 26).
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Flag, LocateFixed, Route as RouteIcon, Search, TrendingUp, Users } from "lucide-react";
import {
  buildRoute,
  formatDistance,
  formatDurationShort,
  fr,
  type ActivityMode,
  type Area,
  type NavRoute,
  type RouteOption,
} from "@mountain-live/core";
import { Banner, Button, CategoryIcon, Drawer, EmptyState, Input, ListItem, SkeletonListItem, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useUiStore } from "@/store/ui";
import { AREA_TYPE_ICONS, areaSubtitle } from "@/features/map/areas";
import { formatElevation } from "@/lib/format";

const CRITERION_ICON: Record<string, React.ReactNode> = {
  fastest: <TrendingUp />,
  shortest: <ArrowRight />,
  most_used: <Users />,
  easiest: <RouteIcon />,
  quietest: <Flag />,
  recommended: <RouteIcon />,
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface RoutePlannerProps {
  open: boolean;
  onClose: () => void;
  activity: ActivityMode;
  onSelect: (route: NavRoute) => void;
}

export function RoutePlanner({ open, onClose, activity, onSelect }: RoutePlannerProps) {
  const position = useUiStore((s) => s.position);
  const view = useUiStore((s) => s.view);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 250);
  const [destination, setDestination] = useState<Area | null>(null);

  const search = useQuery({
    queryKey: qk.areaSearch(debounced),
    queryFn: () => api.areas.search(debounced, position),
    enabled: open && debounced.length >= 2 && !destination,
    staleTime: 5 * 60_000,
  });

  const from = useMemo(() => (position && Date.now() - position.at < 30 * 60_000 ? { lat: position.lat, lng: position.lng } : { lat: view.lat, lng: view.lng }), [position, view]);

  const plan = useMutation({
    mutationFn: (to: Area) => api.network.routes({ from, to: { lat: to.lat, lng: to.lng }, activity }),
  });

  const choose = (area: Area) => {
    setDestination(area);
    plan.mutate(area);
  };

  const follow = (option: RouteOption) => {
    if (option.coordinates.length < 2) {
      toast.warning(fr.network.routes.none);
      return;
    }
    const name = destination ? `${fr.network.routes.criteria[option.criterion]} — ${destination.name}` : fr.network.routes.title;
    onSelect(buildRoute({ id: `plan_${option.criterion}_${Date.now().toString(36)}`, name, coordinates: option.coordinates, elevationGainM: option.elevationGainM, source: "trail" }));
    onClose();
  };

  const reset = () => {
    setDestination(null);
    setQuery("");
    plan.reset();
  };

  return (
    <Drawer open={open} onClose={onClose} title={fr.network.routes.title} aria-label={fr.network.routes.title} width="min(420px, 96vw)">
      <div className="flex flex-col gap-4 px-4 pb-6" data-testid="route-planner">
        <p className="inline-flex items-center gap-2 text-[14px] text-muted">
          <LocateFixed className="size-4 shrink-0 text-info" aria-hidden="true" />
          {fr.network.routes.from} : {position ? fr.network.routes.useMyPosition : "centre de la carte"}
        </p>

        {destination ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2">
            <span className="min-w-0">
              <span className="block text-[12px] font-bold uppercase tracking-wide text-muted">{fr.network.routes.to}</span>
              <span className="block truncate text-[16px] font-bold text-fg">{destination.name}</span>
            </span>
            <Button variant="ghost" size="md" onClick={reset}>
              {fr.common.edit}
            </Button>
          </div>
        ) : (
          <>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={fr.explorePage.searchPlaceholder} leftIcon={<Search />} size="lg" aria-label={fr.network.routes.to} data-testid="planner-search" />
            {debounced.length >= 2 ? (
              search.isLoading ? (
                <SkeletonListItem />
              ) : (search.data?.areas.length ?? 0) === 0 ? (
                <EmptyState compact icon={<Search />} title={fr.explorePage.noResults} />
              ) : (
                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  {(search.data?.areas ?? []).slice(0, 8).map((a, i, list) => (
                    <ListItem
                      key={a.id}
                      icon={<CategoryIcon name={AREA_TYPE_ICONS[a.type]} />}
                      title={a.name}
                      subtitle={areaSubtitle(a, formatElevation)}
                      onClick={() => choose(a)}
                      chevron
                      divider={i < list.length - 1}
                      data-testid={`planner-area-${a.id}`}
                    />
                  ))}
                </div>
              )
            ) : null}
          </>
        )}

        {plan.isPending ? (
          <div className="flex flex-col gap-2">
            <SkeletonListItem />
            <SkeletonListItem />
          </div>
        ) : null}

        {plan.data ? (
          plan.data.options.length === 0 ? (
            <Banner tone="warning" title={fr.network.routes.none}>
              {plan.data.note ?? fr.network.routes.noneHint}
            </Banner>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="planner-results">
              {plan.data.options.map((option) => (
                <li key={option.criterion}>
                  <article className="rounded-xl border border-line bg-surface p-3">
                    <header className="mb-1 flex items-center gap-2">
                      <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary/12 text-primary [&_svg]:size-4" aria-hidden="true">
                        {CRITERION_ICON[option.criterion] ?? <RouteIcon />}
                      </span>
                      <h3 className="text-[16px] font-bold text-fg">{fr.network.routes.criteria[option.criterion]}</h3>
                    </header>
                    <p className="tabular text-[15px] text-fg">
                      {formatDistance(option.distanceM)} · {formatDurationShort(option.durationMs)} · +{Math.round(option.elevationGainM)} m
                    </p>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {option.passages30d > 0
                        ? fr.network.frequentation.recent.replace("{n}", String(option.passages30d))
                        : fr.network.frequentation.insufficient}
                      {option.observedWeight > 0.3 ? ` · ${fr.network.routes.observed}` : ` · ${fr.network.routes.theoretical}`}
                    </p>
                    <Button className="mt-2" size="md" fullWidth onClick={() => follow(option)} data-testid={`planner-follow-${option.criterion}`}>
                      {fr.network.routes.choose}
                    </Button>
                  </article>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {plan.isError ? <Banner tone="danger" title={fr.errors.generic}>{fr.network.routes.noneHint}</Banner> : null}
      </div>
    </Drawer>
  );
}
