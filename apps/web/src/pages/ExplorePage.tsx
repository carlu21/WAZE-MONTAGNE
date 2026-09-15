/**
 * EXPLORER — la page de DÉCOUVERTE (« où va-t-on ? »).
 *
 * Ce n'est pas une seconde carte principale : l'Accueil EST la carte, et le
 * doublon serait une hésitation de navigation. Ici on cherche, on filtre, on
 * choisit — et la carte n'intervient qu'ensuite, quand on a choisi.
 *
 *   recherche  → un lieu-dit, une commune, un massif, un sommet, un sentier
 *   filtres    → à proximité · durée · difficulté · activité
 *   listes     → randonnées autour de vous, secteurs populaires, consultés récemment
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Compass, Footprints, History, Mountain, Navigation, Navigation2, Users } from "lucide-react";
import { fr, type Area } from "@mountain-live/core";
import { Chip, CategoryIcon, EmptyState, ListItem, SearchField, SkeletonListItem, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { qk } from "@/lib/queryKeys";
import { formatElevation } from "@/lib/format";
import { AREA_TYPE_ICONS, areaSubtitle } from "@/features/map/areas";
import { POPULAR_SECTORS, groupAreasByType, loadRecentAreas, pushRecentArea } from "@/features/explore/search";
import { useGeolocation } from "@/features/map/useGeolocation";
import {
  ACTIVITY_OPTIONS,
  DEFAULT_EXPLORE_FILTERS,
  DIFFICULTY_OPTIONS,
  DURATION_OPTIONS,
  activeFilterCount,
  filterTrails,
  type ExploreFilters,
} from "@/features/explore/filters";
import { useNearby } from "@/features/home/useNearby";
import { approachLabel, durationLabel, lengthLabel } from "@/features/home/format";

/** « À proximité » : le départ est à moins de ça, à pied ou à quelques minutes de voiture. */
const NEARBY_LIMIT_M = 15_000;

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
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_EXPLORE_FILTERS);
  // « À proximité » n'a de sens qu'avec une position : on la suit ici aussi, sans
  // rien redemander si l'autorisation a déjà été accordée.
  useGeolocation();

  // Les randonnées alentour, filtrées ici et pas ailleurs : Explorer sert à trier.
  const nearby = useNearby({ activity: "all", sort: "closest", limit: 30 });
  const discovered = useMemo(() => filterTrails(nearby.data?.trails ?? [], filters), [nearby.data, filters]);
  const filterCount = activeFilterCount(filters);

  const search = useQuery({
    queryKey: qk.areaSearch(debounced),
    queryFn: () => api.areas.search(debounced, useUiStore.getState().position),
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
              <EmptyState compact icon={<Compass />} title={fr.explorePage.noResults} description="Essayez un autre nom : lieu-dit, hameau, commune, sommet, col, refuge, lac ou sentier. Les lieux absents de la base sont recherchés en ligne (IGN) quand le réseau est disponible." />
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
              {/* Filtres : quatre questions qu'on se pose avant de partir. */}
              <section aria-label="Filtres de découverte" className="flex flex-col gap-2" data-testid="explore-filters">
                <div className="flex flex-wrap gap-2">
                  <Chip
                    selected={filters.nearbyM !== null}
                    onClick={() => setFilters((f) => ({ ...f, nearbyM: f.nearbyM === null ? NEARBY_LIMIT_M : null }))}
                    icon={<Navigation />}
                  >
                    À proximité
                  </Chip>
                  {DURATION_OPTIONS.filter((o) => o.id !== "all").map((o) => (
                    <Chip key={o.id} selected={filters.duration === o.id} onClick={() => setFilters((f) => ({ ...f, duration: f.duration === o.id ? "all" : o.id }))}>
                      {o.label}
                    </Chip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {DIFFICULTY_OPTIONS.filter((o) => o.id !== "all").map((o) => (
                    <Chip key={o.id} selected={filters.difficulty === o.id} onClick={() => setFilters((f) => ({ ...f, difficulty: f.difficulty === o.id ? "all" : o.id }))}>
                      {o.label}
                    </Chip>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {ACTIVITY_OPTIONS.filter((o) => o.id !== "all").map((o) => (
                    <Chip key={o.id} selected={filters.activity === o.id} onClick={() => setFilters((f) => ({ ...f, activity: f.activity === o.id ? "all" : o.id }))}>
                      {o.label}
                    </Chip>
                  ))}
                </div>
              </section>

              {/* Randonnées autour de vous — la découverte, pas la carte. */}
              <section aria-label="Randonnées autour de vous">
                <h2 className="mb-1 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-muted">
                  <Footprints className="size-4" aria-hidden="true" /> Randonnées autour de vous
                </h2>
                {!nearby.hasPosition ? (
                  <EmptyState compact icon={<Navigation />} title="Position inconnue" description="Autorisez la localisation depuis l'Accueil pour voir les randonnées autour de vous." />
                ) : nearby.isLoading && discovered.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    <SkeletonListItem />
                    <SkeletonListItem />
                  </div>
                ) : discovered.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<Footprints />}
                    title="Aucune randonnée ne correspond"
                    description={filterCount > 0 ? `${filterCount} filtre${filterCount > 1 ? "s" : ""} actif${filterCount > 1 ? "s" : ""} : élargissez la recherche.` : "Aucune randonnée connue autour de vous pour l'instant."}
                  />
                ) : (
                  <div className="overflow-hidden rounded-xl border border-line bg-surface" data-testid="explore-trails">
                    {discovered.slice(0, 12).map((t, i) => (
                      <ListItem
                        key={t.id}
                        icon={<Footprints />}
                        title={t.name}
                        subtitle={`${approachLabel(t.approachM)} · ${lengthLabel(t.lengthM)} · ${durationLabel(t.durationMs, t.durationObserved)}`}
                        onClick={() => navigate("/home", { state: { selectTrail: t.id } })}
                        chevron
                        divider={i < Math.min(discovered.length, 12) - 1}
                      />
                    ))}
                  </div>
                )}
              </section>

              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                <ListItem icon={<Navigation2 />} title={fr.navigation.title} subtitle="Suivi GPS sur les sentiers, guidage pas à pas, alertes devant vous" to="/navigate" chevron />
                <ListItem icon={<Navigation />} title={fr.nav.around} subtitle="Ce qui se passe à proximité, trié par distance" to="/around" chevron />
                <ListItem icon={<Users />} title={fr.nav.community} subtitle="Activité récente, contributeurs fiables, partenaires" to="/community" chevron />
              </div>
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
