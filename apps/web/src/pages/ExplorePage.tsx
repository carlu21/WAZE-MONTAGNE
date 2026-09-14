/**
 * Page Explorer (section 22) : recherche d'un secteur (commune, massif, sentier,
 * sommet, lieu) avant de s'y rendre ; secteurs populaires et consultés récemment.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Compass, History, Mountain } from "lucide-react";
import { fr, type Area } from "@mountain-live/core";
import { CategoryIcon, EmptyState, ListItem, SearchField, SkeletonListItem, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatElevation } from "@/lib/format";
import { AREA_TYPE_ICONS, areaSubtitle } from "@/features/map/areas";
import { POPULAR_SECTORS, groupAreasByType, loadRecentAreas, pushRecentArea } from "@/features/explore/search";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function ExplorePage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const debounced = useDebounced(q.trim(), 250);
  const [recent, setRecent] = useState<Area[]>(() => loadRecentAreas());

  const search = useQuery({
    queryKey: qk.areaSearch(debounced),
    queryFn: () => api.areas.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 5 * 60_000,
  });

  const popular = useQueries({
    queries: POPULAR_SECTORS.map((name) => ({
      queryKey: qk.areaSearch(`popular:${name}`),
      queryFn: () => api.areas.search(name),
      staleTime: 60 * 60_000,
      select: (r: { areas: Area[] }) => r.areas[0] ?? null,
    })),
  });
  const popularAreas = useMemo(() => popular.map((p) => p.data).filter((a): a is Area => Boolean(a)), [popular]);

  const open = (a: Area) => {
    pushRecentArea(a);
    setRecent(loadRecentAreas());
    navigate(`/explore/${a.id}`);
  };

  const groups = useMemo(() => groupAreasByType(search.data?.areas ?? []), [search.data]);
  const searching = debounced.length >= 2;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar variant="solid" title={fr.explorePage.title}>
        <div className="px-1 pb-2">
          <SearchField value={q} onChange={setQ} onClear={() => setQ("")} placeholder={fr.explorePage.searchPlaceholder} loading={search.isFetching} size="lg" aria-label={fr.common.search} />
        </div>
      </TopBar>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-10 pt-3">
          {searching ? (
            search.isLoading ? (
              <div className="flex flex-col gap-2">
                <SkeletonListItem />
                <SkeletonListItem />
              </div>
            ) : groups.length === 0 ? (
              <EmptyState compact icon={<Compass />} title={fr.explorePage.noResults} description="Essayez un autre nom : commune, massif, sommet, col, refuge, lac ou sentier." />
            ) : (
              groups.map((g) => (
                <section key={g.type}>
                  <h2 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">{g.label}</h2>
                  <div className="overflow-hidden rounded-xl border border-line bg-surface">
                    {g.items.map((a, i) => (
                      <ListItem key={a.id} icon={<CategoryIcon name={AREA_TYPE_ICONS[a.type]} />} title={a.name} subtitle={areaSubtitle(a, formatElevation)} onClick={() => open(a)} chevron divider={i < g.items.length - 1} />
                    ))}
                  </div>
                </section>
              ))
            )
          ) : (
            <>
              <section>
                <h2 className="mb-1 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-muted">
                  <Mountain className="size-4" aria-hidden="true" /> Secteurs populaires — pilote Corse
                </h2>
                <div className="overflow-hidden rounded-xl border border-line bg-surface">
                  {popularAreas.length === 0 ? (
                    <div className="p-3">
                      <SkeletonListItem />
                    </div>
                  ) : (
                    popularAreas.map((a, i) => (
                      <ListItem key={a.id} icon={<CategoryIcon name={AREA_TYPE_ICONS[a.type]} />} title={a.name} subtitle={areaSubtitle(a, formatElevation)} onClick={() => open(a)} chevron divider={i < popularAreas.length - 1} />
                    ))
                  )}
                </div>
              </section>
              {recent.length ? (
                <section>
                  <h2 className="mb-1 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-muted">
                    <History className="size-4" aria-hidden="true" /> Consultés récemment
                  </h2>
                  <div className="overflow-hidden rounded-xl border border-line bg-surface">
                    {recent.map((a, i) => (
                      <ListItem key={a.id} icon={<CategoryIcon name={AREA_TYPE_ICONS[a.type]} />} title={a.name} subtitle={areaSubtitle(a, formatElevation)} onClick={() => open(a)} chevron divider={i < recent.length - 1} />
                    ))}
                  </div>
                </section>
              ) : null}
              <p className="text-[13px] text-muted">Consultez un secteur avant de partir : signalements récents, fréquentation, points d'eau, activités en cours et restrictions.</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
