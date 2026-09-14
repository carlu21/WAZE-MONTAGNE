/**
 * Barre haute translucide de la carte (section 3) : recherche d'un lieu,
 * filtres (avec le nombre de filtres actifs) et bouton « Me localiser ».
 */
import { SlidersHorizontal } from "lucide-react";
import { fr } from "@mountain-live/core";
import { IconButton, TopBar } from "@/components/ui";
import { LocateButton } from "./UserLocation";
import type { GeolocationState } from "./useGeolocation";

export interface MapTopBarProps {
  onSearch: () => void;
  /** Lieu affiché dans le champ de recherche (dernier lieu choisi). */
  searchValue?: string;
  onFilters: () => void;
  /** Nombre de filtres actifs (catégories + « officiel uniquement »). */
  filterCount: number;
  geolocation: GeolocationState;
}

export function MapTopBar({ onSearch, searchValue, onFilters, filterCount, geolocation }: MapTopBarProps) {
  const filtersLabel = filterCount > 0 ? `${fr.mapUi.filters} (${filterCount} ${filterCount > 1 ? "actifs" : "actif"})` : fr.mapUi.filters;
  return (
    <TopBar
      variant="overlay"
      onSearchClick={onSearch}
      searchPlaceholder={fr.mapUi.search}
      searchValue={searchValue}
      actions={
        <>
          <span className="relative inline-flex">
            <IconButton aria-label={filtersLabel} title={filtersLabel} variant="glass" size={52} pressed={filterCount > 0} onClick={onFilters}>
              <SlidersHorizontal />
            </IconButton>
            {filterCount > 0 ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-1 -top-1 inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-accent px-1 text-[12px] font-bold leading-none text-accent-fg ring-2 ring-surface"
              >
                {filterCount}
              </span>
            ) : null}
          </span>
          <LocateButton geolocation={geolocation} />
        </>
      }
    />
  );
}
