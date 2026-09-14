/**
 * Recherche d'un lieu (sections 3 et 30 : commune, massif, sentier, sommet,
 * col, lieu, refuge, lac) via GET /areas/search, avec anti-rebond de 250 ms,
 * recherches récentes (localStorage) et sélection → cadrage de la carte.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Search } from "lucide-react";
import { fr, type Area } from "@mountain-live/core";
import { useUiStore } from "@/store/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatElevation } from "@/lib/format";
import { Banner, BottomSheet, Button, CategoryIcon, EmptyState, ListItem, SearchField, SkeletonGroup, SkeletonListItem } from "@/components/ui";
import { AREA_TYPE_ICONS, areaSubtitle } from "./areas";
import { clearRecentSearches, loadRecentSearches, pushRecentSearch } from "./recentSearches";

export interface SearchSheetProps {
  open: boolean;
  onClose: () => void;
  onSelect: (area: Area) => void;
}

export const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function SearchSheet({ open, onClose, onSelect }: SearchSheetProps) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const active = debounced.length >= MIN_QUERY_LENGTH;
  const [recent, setRecent] = useState<Area[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setRecent(loadRecentSearches());
    // Clavier ouvert dès l'affichage (l'animation d'entrée démarre d'abord).
    const id = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [open]);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: qk.areaSearch(debounced),
    queryFn: () => api.areas.search(debounced, useUiStore.getState().position),
    enabled: open && active,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const results = useMemo(() => data?.areas ?? [], [data]);

  const choose = (area: Area) => {
    setRecent(pushRecentSearch(area));
    onSelect(area);
    setQuery("");
    onClose();
  };

  const close = () => {
    setQuery("");
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={close}
      snap="full"
      snaps={["full"]}
      backdrop="always"
      aria-label="Recherche d'un lieu"
      header={
        <div className="px-4 pb-3">
          <SearchField
            ref={inputRef}
            value={query}
            onChange={setQuery}
            onCancel={close}
            onSubmit={() => {
              if (results.length > 0) choose(results[0]);
            }}
            loading={isFetching && active}
            placeholder={fr.explorePage.searchPlaceholder}
            size="lg"
            aria-label={fr.common.search}
          />
        </div>
      }
    >
      {active ? (
        isError ? (
          <div className="px-4 py-3">
            <Banner
              tone="warning"
              title={fr.errors.network}
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  {fr.common.retry}
                </Button>
              }
            />
          </div>
        ) : !data && isFetching ? (
          <SkeletonGroup label="Recherche en cours…">
            <SkeletonListItem />
            <SkeletonListItem />
            <SkeletonListItem />
          </SkeletonGroup>
        ) : results.length === 0 ? (
          <EmptyState compact icon={<Search />} title={fr.explorePage.noResults} description="Essayez le nom d'une commune, d'un massif, d'un col ou d'un refuge." />
        ) : (
          <ul aria-label="Résultats de recherche">
            {results.map((area) => (
              <ListItem
                key={area.id}
                as="li"
                icon={<CategoryIcon name={AREA_TYPE_ICONS[area.type] ?? "map-pin"} />}
                title={area.name}
                subtitle={areaSubtitle(area, formatElevation)}
                onClick={() => choose(area)}
                chevron
              />
            ))}
          </ul>
        )
      ) : recent.length > 0 ? (
        <section aria-label="Recherches récentes">
          <div className="flex items-center justify-between px-4 pb-1 pt-2">
            <h3 className="text-[14px] font-bold uppercase tracking-wide text-muted">Recherches récentes</h3>
            <Button
              variant="ghost"
              size="md"
              className="-mr-3 text-[15px] text-primary"
              onClick={() => {
                clearRecentSearches();
                setRecent([]);
              }}
            >
              Effacer
            </Button>
          </div>
          <ul>
            {recent.map((area) => (
              <ListItem
                key={area.id}
                as="li"
                icon={<Clock3 />}
                title={area.name}
                subtitle={areaSubtitle(area, formatElevation)}
                onClick={() => choose(area)}
                chevron
              />
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState
          compact
          icon={<Search />}
          title="Rechercher un lieu"
          description="Commune, massif, sentier, sommet, col, refuge ou lac : saisissez au moins deux caractères."
        />
      )}
    </BottomSheet>
  );
}
