import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Basemap, ReportCategory, ReportSubtype } from "@mountain-live/core";

export interface MapViewState {
  lng: number;
  lat: number;
  zoom: number;
}

/** Vue par défaut : Corse (territoire pilote), centrée sur le massif central. */
export const DEFAULT_VIEW: MapViewState = { lng: 9.05, lat: 42.25, zoom: 8.6 };

interface UiState {
  /** Catégories actives. Tableau vide = tout afficher. */
  filters: ReportCategory[];
  /** Sous-types masqués à l'intérieur d'une catégorie affichée (ex. « Chasse » sans « Activités »). */
  excludedSubtypes: ReportSubtype[];
  /** La carte s'est déjà centrée sur la position pendant cette session. */
  autoCentered: boolean;
  showOfficialOnly: boolean;
  basemap: Basemap;
  theme: "light" | "dark" | "system";
  view: MapViewState;
  /** Dernière position GPS connue de l'appareil (jamais envoyée telle quelle au serveur sauf présence agrégée). */
  position: { lat: number; lng: number; accuracy: number | null; at: number } | null;
  online: boolean;
  lastSyncAt: number | null;
  setFilters: (f: ReportCategory[]) => void;
  setExcludedSubtypes: (s: ReportSubtype[]) => void;
  setAutoCentered: (v: boolean) => void;
  toggleFilter: (c: ReportCategory) => void;
  setShowOfficialOnly: (v: boolean) => void;
  setBasemap: (b: Basemap) => void;
  setTheme: (t: "light" | "dark" | "system") => void;
  setView: (v: MapViewState) => void;
  setPosition: (p: UiState["position"]) => void;
  setOnline: (v: boolean) => void;
  setLastSyncAt: (t: number | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      filters: [],
      excludedSubtypes: [],
      autoCentered: false,
      showOfficialOnly: false,
      basemap: "topo",
      theme: "system",
      view: DEFAULT_VIEW,
      position: null,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      lastSyncAt: null,
      setFilters: (filters) => set({ filters }),
      setExcludedSubtypes: (excludedSubtypes) => set({ excludedSubtypes }),
      setAutoCentered: (autoCentered) => set({ autoCentered }),
      toggleFilter: (c) => {
        const f = get().filters;
        set({ filters: f.includes(c) ? f.filter((x) => x !== c) : [...f, c] });
      },
      setShowOfficialOnly: (showOfficialOnly) => set({ showOfficialOnly }),
      setBasemap: (basemap) => set({ basemap }),
      setTheme: (theme) => set({ theme }),
      setView: (view) => set({ view }),
      setPosition: (position) => set({ position }),
      setOnline: (online) => set({ online }),
      setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),
    }),
    {
      name: "ml.ui",
      partialize: (s) => ({
        filters: s.filters,
        excludedSubtypes: s.excludedSubtypes,
        showOfficialOnly: s.showOfficialOnly,
        basemap: s.basemap,
        theme: s.theme,
        view: s.view,
        lastSyncAt: s.lastSyncAt,
      }),
    },
  ),
);
