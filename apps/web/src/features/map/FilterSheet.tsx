/**
 * Filtres de la carte (section 11) : « Tout afficher », Dangers, Chasse,
 * Animaux, Chemins, Eau, Fréquentation ; « Informations officielles
 * uniquement » ; fond de carte (section 10) ; filtres selon la pratique ;
 * enregistrement comme préférence (compte connecté) ; réinitialisation.
 * Les filtres s'appliquent immédiatement (useUiStore).
 */
import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, Compass } from "lucide-react";
import {
  CATEGORY_BY_ID,
  DEFAULT_FILTERS_BY_PRACTICE,
  fr,
  type Basemap,
  type ReportCategory,
} from "@mountain-live/core";
import { api, ApiError } from "@/lib/api";
import { useUiStore } from "@/store/ui";
import { useSessionStore } from "@/store/session";
import { BottomSheet, Button, Chip, Segmented, Toggle, toast } from "@/components/ui";
import { BASEMAPS, BASEMAP_ORDER } from "@/components/map/basemaps";

export interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
}

/** Ordre des puces (section 11). */
export const FILTER_CATEGORIES: readonly ReportCategory[] = ["danger", "activity", "animals", "path", "water", "crowd"];

/** Nombre de filtres actifs affiché sur le bouton de la barre haute. */
export function countActiveFilters(filters: readonly ReportCategory[], showOfficialOnly: boolean): number {
  return filters.length + (showOfficialOnly ? 1 : 0);
}

export function FilterSheet({ open, onClose }: FilterSheetProps) {
  const filters = useUiStore((s) => s.filters);
  const showOfficialOnly = useUiStore((s) => s.showOfficialOnly);
  const basemap = useUiStore((s) => s.basemap);
  const setFilters = useUiStore((s) => s.setFilters);
  const toggleFilter = useUiStore((s) => s.toggleFilter);
  const setShowOfficialOnly = useUiStore((s) => s.setShowOfficialOnly);
  const setBasemap = useUiStore((s) => s.setBasemap);
  const user = useSessionStore((s) => s.user);
  const setUser = useSessionStore((s) => s.setUser);

  const allSelected = filters.length === 0;

  // Filtres suggérés par la ou les pratiques du compte (section 11).
  const practiceFilters = useMemo(() => {
    if (!user || user.practices.length === 0) return null;
    const set = new Set<ReportCategory>();
    for (const p of user.practices) for (const c of DEFAULT_FILTERS_BY_PRACTICE[p] ?? []) set.add(c);
    return FILTER_CATEGORIES.filter((c) => set.has(c));
  }, [user]);
  const practiceActive = practiceFilters !== null && practiceFilters.length === filters.length && practiceFilters.every((c) => filters.includes(c));

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error(fr.errors.unauthorized);
      return api.users.updatePreferences({ ...user.preferences, filters, showOfficialOnly, basemap });
    },
    onSuccess: (res) => {
      setUser(res.user);
      toast.success(fr.filters.presetSaved);
    },
    onError: (err) => {
      toast.danger(err instanceof ApiError ? err.message : fr.errors.generic);
    },
  });

  const reset = () => {
    setFilters([]);
    setShowOfficialOnly(false);
  };

  const basemapOptions = BASEMAP_ORDER.map((id) => ({ value: id, label: BASEMAPS[id].label }));

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={fr.filters.title}
      subtitle="Les changements s'appliquent immédiatement"
      defaultSnap="half"
      snaps={["half", "full"]}
      snapPoints={{ half: 0.72 }}
      aria-label={fr.filters.title}
      footer={
        <div className="flex flex-col gap-2">
          {user ? (
            <Button variant="secondary" fullWidth leftIcon={<BadgeCheck />} loading={save.isPending} loadingLabel="Enregistrement…" onClick={() => save.mutate()}>
              Enregistrer comme préférence
            </Button>
          ) : (
            <p className="text-center text-[14px] text-muted">Connectez-vous pour enregistrer ces filtres comme préférence.</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={reset}>
              {fr.filters.reset}
            </Button>
            <Button className="flex-1" onClick={onClose}>
              {fr.filters.apply}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5 px-4 pb-4">
        <section aria-labelledby="filters-categories">
          <h3 id="filters-categories" className="mb-2 text-[14px] font-bold uppercase tracking-wide text-muted">
            Catégories
          </h3>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Catégories affichées">
            <Chip selected={allSelected} icon="layers" onClick={() => setFilters([])}>
              {fr.filters.all}
            </Chip>
            {FILTER_CATEGORIES.map((c) => (
              <Chip key={c} category={c} selected={filters.includes(c)} onClick={() => toggleFilter(c)}>
                {CATEGORY_BY_ID[c].shortLabel}
              </Chip>
            ))}
            {practiceFilters && practiceFilters.length > 0 ? (
              <Chip selected={practiceActive} icon={<Compass size={20} />} onClick={() => setFilters(practiceFilters)}>
                {fr.filters.byPractice}
              </Chip>
            ) : null}
          </div>
          <p className="mt-2 text-[14px] text-muted">
            {allSelected ? "Toutes les catégories sont affichées." : `${filters.length} ${filters.length > 1 ? "catégories affichées" : "catégorie affichée"}.`}
          </p>
        </section>

        <section aria-labelledby="filters-official">
          <h3 id="filters-official" className="sr-only">
            Sources
          </h3>
          <Toggle
            checked={showOfficialOnly}
            onChange={setShowOfficialOnly}
            icon={<BadgeCheck />}
            label="Informations officielles uniquement"
            description="Masque les signalements communautaires et partenaires."
          />
        </section>

        <section aria-labelledby="filters-basemap">
          <h3 id="filters-basemap" className="mb-2 text-[14px] font-bold uppercase tracking-wide text-muted">
            {fr.mapUi.basemap}
          </h3>
          <Segmented<Basemap> options={basemapOptions} value={basemap} onChange={setBasemap} size="lg" aria-labelledby="filters-basemap" />
          <p className="mt-2 text-[14px] text-muted">{BASEMAPS[basemap].description}</p>
        </section>
      </div>
    </BottomSheet>
  );
}
