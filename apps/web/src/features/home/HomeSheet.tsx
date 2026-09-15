/**
 * Panneau inférieur de l'écran d'accueil (sections 7 à 13, 23, 24).
 *
 * Structure, de haut en bas et dans cet ordre de priorité :
 *
 *   poignée de glissement
 *   « Où va-t-on ? »                    ← l'action de recherche, toujours au même endroit
 *   Randonnées autour de vous           ← ce qui remplace « Domicile / Travail »
 *   (panneau développé) tris, filtres, liste complète
 *
 * Trois paliers : aperçu (la carte reste dominante), moitié, plein écran. Le
 * palier d'aperçu est dimensionné pour laisser voir la carte sur ~65 % de la
 * hauteur, conformément à la section 3.
 */
import { useMemo } from "react";
import { Mic, Search, SlidersHorizontal } from "lucide-react";
import type { ActivityMode, NearbyResponse, NearbySort } from "@mountain-live/core";
import { BottomSheet, Button, Chip, EmptyState, SkeletonText, cn, type SheetSnap } from "@/components/ui";
import { TrailCard } from "./TrailCard";
import { SORT_LABELS } from "./format";

/**
 * Hauteur (px) du palier d'aperçu : poignée + recherche + une rangée de cartes.
 *
 * Calibrée pour que la CARTE reste dominante (section 3) : sur un écran de
 * 844 px avec la barre de navigation, elle occupe encore ~60 % de la hauteur.
 * Toute information ajoutée ici se paie en carte perdue.
 */
export const PEEK_HEIGHT = 278;

const SORTS: NearbySort[] = ["closest", "popular", "easiest", "shortest", "quietest"];

/** Filtres rapides de la vue développée (section 24). */
export const DURATION_FILTERS = [
  { id: "all", label: "Toutes", maxMs: null },
  { id: "short", label: "< 2 h", maxMs: 2 * 3_600_000 },
  { id: "half", label: "2 – 4 h", maxMs: 4 * 3_600_000 },
  { id: "day", label: "Journée", maxMs: null },
] as const;

export type DurationFilter = (typeof DURATION_FILTERS)[number]["id"];

const ACTIVITIES: { value: ActivityMode | "all"; label: string }[] = [
  { value: "all", label: "Toutes activités" },
  { value: "hiking", label: "Randonnée" },
  { value: "trail", label: "Trail" },
  { value: "mtb", label: "VTT" },
  { value: "equestrian", label: "À cheval" },
];

/** Applique le filtre de durée (« Journée » = tout ce qui dépasse 4 h). */
export function filterByDuration<T extends { durationMs: number }>(trails: readonly T[], filter: DurationFilter): T[] {
  if (filter === "all") return [...trails];
  if (filter === "day") return trails.filter((t) => t.durationMs > 4 * 3_600_000);
  const max = DURATION_FILTERS.find((f) => f.id === filter)?.maxMs;
  if (max === null || max === undefined) return [...trails];
  const min = filter === "half" ? 2 * 3_600_000 : 0;
  return trails.filter((t) => t.durationMs > min && t.durationMs <= max);
}

export interface HomeSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  nearby: NearbyResponse | null;
  isLoading: boolean;
  hasPosition: boolean;
  selectedId: string | null;
  onSelectTrail: (id: string) => void;
  onSearch: () => void;
  onLocate: () => void;
  sort: NearbySort;
  onSortChange: (sort: NearbySort) => void;
  activity: ActivityMode | "all";
  onActivityChange: (activity: ActivityMode | "all") => void;
  duration: DurationFilter;
  onDurationChange: (filter: DurationFilter) => void;
}

export function HomeSheet({
  snap,
  onSnapChange,
  nearby,
  isLoading,
  hasPosition,
  selectedId,
  onSelectTrail,
  onSearch,
  onLocate,
  sort,
  onSortChange,
  activity,
  onActivityChange,
  duration,
  onDurationChange,
}: HomeSheetProps) {
  const expanded = snap !== "peek";
  const trails = useMemo(() => filterByDuration(nearby?.trails ?? [], duration), [nearby, duration]);

  return (
    <BottomSheet
      open
      snap={snap}
      onSnapChange={onSnapChange}
      onClose={() => onSnapChange("peek")}
      snapPoints={{ peek: PEEK_HEIGHT, half: 0.66, full: 0.92 }}
      backdrop="none"
      dismissible={false}
      showClose={false}
      aria-label="Recherche et randonnées à proximité"
      contentClassName="px-0"
      header={
        <div className="px-4 pb-1 pt-1">
          {/* Barre de recherche principale (section 8). */}
          <button
            type="button"
            onClick={onSearch}
            data-testid="home-search"
            className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl bg-bg px-4 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
          >
            <Search className="size-5 shrink-0 text-muted" aria-hidden />
            <span className="flex-1 text-[17px] font-semibold text-muted">Où va-t-on ?</span>
            <Mic className="size-5 shrink-0 text-muted" aria-hidden />
          </button>
        </div>
      }
    >
      <section aria-label="Randonnées à proximité" className="pb-2">
        <header className="flex items-baseline justify-between gap-2 px-4 pb-1.5 pt-2">
          <h2 className="text-[14px] font-bold text-fg">Randonnées autour de vous</h2>
          {expanded ? (
            <span className="text-[13px] text-muted">
              {trails.length} randonnée{trails.length > 1 ? "s" : ""}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onSnapChange("half")}
              className="inline-flex min-h-8 items-center gap-1 text-[13px] font-semibold text-primary"
            >
              <SlidersHorizontal className="size-3.5" aria-hidden /> Tout voir
            </button>
          )}
        </header>

        {!hasPosition && (
          <div className="px-4">
            <EmptyState
              title="Où êtes-vous ?"
              description="Autorisez la localisation pour voir les randonnées autour de vous."
              action={
                <Button size="md" onClick={onLocate}>
                  Me localiser
                </Button>
              }
            />
          </div>
        )}

        {hasPosition && isLoading && !nearby && (
          <div className="px-4">
            <SkeletonText lines={3} />
          </div>
        )}

        {hasPosition && nearby && trails.length === 0 && (
          <p className="px-4 text-[14px] text-muted">
            {nearby.note ?? "Aucune randonnée ne correspond à ces filtres."}
          </p>
        )}

        {/* Vue repliée : carrousel horizontal (section 12). */}
        {!expanded && trails.length > 0 && (
          <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2" data-testid="nearby-carousel">
            {trails.map((trail) => (
              <li key={trail.id} className="flex">
                <TrailCard trail={trail} selected={trail.id === selectedId} onSelect={onSelectTrail} />
              </li>
            ))}
          </ul>
        )}

        {/* Vue développée : tris, filtres, liste verticale (sections 23 et 24). */}
        {expanded && (
          <div className="space-y-3">
            <div className="flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Classement">
              {SORTS.map((s) => (
                <Chip key={s} selected={sort === s} onClick={() => onSortChange(s)}>
                  {SORT_LABELS[s]}
                </Chip>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Durée et activité">
              {DURATION_FILTERS.map((f) => (
                <Chip key={f.id} selected={duration === f.id} onClick={() => onDurationChange(f.id)}>
                  {f.label}
                </Chip>
              ))}
              <span className="my-1 w-px shrink-0 bg-line" aria-hidden />
              {ACTIVITIES.map((a) => (
                <Chip key={a.value} selected={activity === a.value} onClick={() => onActivityChange(a.value)}>
                  {a.label}
                </Chip>
              ))}
            </div>

            {nearby?.widened && (
              <p className="px-4 text-[13px] text-muted">
                Peu d'itinéraires tout près : la recherche a été élargie à {Math.round(nearby.radiusM / 1000)} km.
              </p>
            )}

            <ul className={cn("space-y-2 px-4 pb-4")} data-testid="nearby-list">
              {trails.map((trail) => (
                <li key={trail.id}>
                  <TrailCard trail={trail} selected={trail.id === selectedId} onSelect={onSelectTrail} layout="row" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </BottomSheet>
  );
}
