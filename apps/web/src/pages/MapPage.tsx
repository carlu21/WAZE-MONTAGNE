/**
 * Écran principal : la carte (sections 3, 10, 11 et 33).
 *
 * - Carte plein écran sous une barre haute translucide (recherche, filtres, position).
 * - Signalements regroupés, estompés selon leur âge, filtrés par zoom et par catégorie.
 * - Alertes officielles (polygones / points), carte thermique de présence anonymisée,
 *   position de l'utilisateur.
 * - Aperçu d'un signalement dans une feuille basse ; fiche complète sur /reports/:id.
 * - Recentrage après une publication (state.focus) ou après une recherche de lieu.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Info, List } from "lucide-react";
import type { Map as MaplibreMap } from "maplibre-gl";
import { fr, inBBox, phrases, type Area, type BBox, type OfficialAlert, type Report } from "@mountain-live/core";
import { IconButton } from "@/components/ui";
import { MapView, isMapAlive } from "@/components/map/MapView";
import { useUiStore, type MapViewState } from "@/store/ui";
import { useReports } from "@/features/map/useReports";
import { useGeolocation } from "@/features/map/useGeolocation";
import { ReportsLayer } from "@/features/map/ReportsLayer";
import { OfficialAlertsLayer } from "@/features/map/OfficialAlertsLayer";
import { PresenceLayer } from "@/features/map/PresenceLayer";
import { UserLocation } from "@/features/map/UserLocation";
import { SearchMarker } from "@/features/map/SearchMarker";
import { MapTopBar } from "@/features/map/MapTopBar";
import { SearchSheet } from "@/features/map/SearchSheet";
import { FilterSheet, countActiveFilters } from "@/features/map/FilterSheet";
import { ReportPreviewSheet } from "@/features/map/ReportPreviewSheet";
import { AlertPreviewSheet } from "@/features/map/AlertPreviewSheet";
import { MapLegend } from "@/features/map/MapLegend";
import { filterByZoom } from "@/features/map/geojson";
import { AREA_TYPE_ZOOM } from "@/features/map/areas";
import { pushRecentSearch } from "@/features/map/recentSearches";
import type { MapNavigationState } from "@/pages/ReportWizardPage";

/** Zoom appliqué au premier centrage sur la position de l'utilisateur. */
export const FIRST_LOCATE_ZOOM = 13;
/** Zoom appliqué après une publication. */
export const FOCUS_ZOOM = 15;

type Sheet = "none" | "search" | "filters";

export default function MapPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state ?? null) as MapNavigationState | null;

  const setView = useUiStore((s) => s.setView);
  const filters = useUiStore((s) => s.filters);
  const showOfficialOnly = useUiStore((s) => s.showOfficialOnly);
  const position = useUiStore((s) => s.position);
  const setAutoCentered = useUiStore((s) => s.setAutoCentered);

  const mapRef = useRef<MaplibreMap | null>(null);
  const [viewBBox, setViewBBox] = useState<BBox | null>(null);
  const [zoom, setZoom] = useState<number>(useUiStore.getState().view.zoom);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(navState?.publishedReportId ?? null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [searchArea, setSearchArea] = useState<Area | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [activeUsers, setActiveUsers] = useState(0);
  const firstLocateDone = useRef(false);

  const geolocation = useGeolocation();
  const { data, reports, officialAlerts, isLoading, isFetching } = useReports(viewBBox, zoom);
  // « Chargement… » tant qu'aucune donnée n'est arrivée (y compris avant la première emprise connue).
  const loadingFirst = isLoading || data === undefined;

  // Signalements réellement visibles dans la vue courante (zoom intelligent + emprise).
  const visibleReports = useMemo(() => {
    if (!viewBBox) return [];
    return filterByZoom(reports, zoom).filter((r) => inBBox({ lat: r.lat, lng: r.lng }, viewBBox));
  }, [reports, zoom, viewBBox]);

  const selectedReport: Report | null = useMemo(
    () => (selectedReportId ? (reports.find((r) => r.id === selectedReportId) ?? null) : null),
    [reports, selectedReportId],
  );
  const selectedAlert: OfficialAlert | null = useMemo(
    () => (selectedAlertId ? (officialAlerts.find((a) => a.id === selectedAlertId) ?? null) : null),
    [officialAlerts, selectedAlertId],
  );

  /**
   * Mouvement de caméra fiable : avant l'événement « load » (style chargé mais première
   * image non rendue), MapLibre ignore les animations ; on saute alors directement à la vue.
   */
  const moveCamera = useCallback((map: MaplibreMap, center: { lat: number; lng: number }, targetZoom: number, animate: boolean) => {
    const go = () => {
      if (!isMapAlive(map)) return;
      if (animate) map.flyTo({ center: [center.lng, center.lat], zoom: targetZoom, duration: 900, essential: true });
      else map.jumpTo({ center: [center.lng, center.lat], zoom: targetZoom });
    };
    const arrived = () => isMapAlive(map) && Math.abs(map.getZoom() - targetZoom) < 0.5;
    go();
    // Tant que la première image n'est pas rendue, MapLibre peut ignorer le mouvement : on réessaie
    // dès que la carte est au repos, puis une dernière fois par sécurité.
    if (!arrived()) {
      map.once("idle", () => {
        if (!arrived()) go();
      });
      window.setTimeout(() => {
        if (!arrived()) go();
      }, 1500);
    }
  }, []);

  const flyTo = useCallback(
    (center: { lat: number; lng: number }, targetZoom: number) => {
      const map = mapRef.current;
      if (!map || !isMapAlive(map)) return;
      moveCamera(map, center, targetZoom, true);
    },
    [moveCamera],
  );

  const onReady = useCallback(
    (map: MaplibreMap) => {
      mapRef.current = map;
      // Recentrage demandé par l'assistant de signalement (publication ou mise en attente).
      if (navState?.focus) {
        moveCamera(map, navState.focus, navState.zoom ?? FOCUS_ZOOM, false);
        firstLocateDone.current = true;
        setAutoCentered(true);
        // L'état de navigation ne doit pas être rejoué à la prochaine visite.
        navigate(location.pathname, { replace: true, state: null });
        return;
      }
      // Premier chargement de la session avec une position connue : la carte se centre sur
      // l'utilisateur (section 33). Une seule fois par session : revenir sur l'onglet Carte ou
      // arriver depuis « Ouvrir la carte ici » conserve la vue demandée.
      if (!useUiStore.getState().autoCentered && position && Date.now() - position.at < 10 * 60_000) {
        firstLocateDone.current = true;
        setAutoCentered(true);
        moveCamera(map, position, FIRST_LOCATE_ZOOM, false);
      } else if (useUiStore.getState().autoCentered) {
        firstLocateDone.current = true;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Position obtenue après le chargement de la carte : centrage unique.
  useEffect(() => {
    if (firstLocateDone.current || !position || !mapRef.current) return;
    if (useUiStore.getState().autoCentered) return;
    if (Date.now() - position.at > 60_000) return;
    firstLocateDone.current = true;
    setAutoCentered(true);
    flyTo(position, FIRST_LOCATE_ZOOM);
  }, [position, flyTo, setAutoCentered]);

  const onMoveEnd = useCallback(
    (bbox: BBox, view: MapViewState) => {
      setViewBBox(bbox);
      setZoom(view.zoom);
      setView(view);
    },
    [setView],
  );

  const selectReport = useCallback((id: string) => {
    setSelectedAlertId(null);
    setSelectedReportId(id);
  }, []);
  const selectAlert = useCallback((id: string) => {
    setSelectedReportId(null);
    setSelectedAlertId(id);
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedReportId(null);
    setSelectedAlertId(null);
  }, []);

  const onSelectArea = useCallback(
    (area: Area) => {
      pushRecentSearch(area);
      setSearchArea(area);
      setSheet("none");
      clearSelection();
      flyTo(area, AREA_TYPE_ZOOM[area.type] ?? 13);
    },
    [flyTo, clearSelection],
  );

  const filterCount = countActiveFilters(filters, showOfficialOnly);
  // Alertes officielles réellement dans la vue (l'emprise de requête est élargie).
  const visibleAlerts = useMemo(
    () => (viewBBox ? officialAlerts.filter((a) => inBBox({ lat: a.centroidLat, lng: a.centroidLng }, viewBBox)) : []),
    [officialAlerts, viewBBox],
  );
  const showEmpty = !loadingFirst && viewBBox !== null && visibleReports.length === 0 && visibleAlerts.length === 0;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden" data-testid="map-page">
      <MapView className="absolute inset-0" onReady={onReady} onMoveEnd={onMoveEnd} onClick={clearSelection} aria-label="Carte des signalements">
        <PresenceLayer bbox={viewBBox} onEstimate={setActiveUsers} />
        <OfficialAlertsLayer alerts={officialAlerts} selectedId={selectedAlertId} onSelect={selectAlert} />
        <ReportsLayer reports={reports} zoom={zoom} selectedId={selectedReportId} onSelect={selectReport} />
        <UserLocation />
        <SearchMarker area={searchArea} onClick={(a) => navigate(`/explore/${a.id}`)} />
        {/* Dans le contexte de la carte : le bouton « Me localiser » peut la recentrer. */}
        <MapTopBar
          onSearch={() => setSheet("search")}
          searchValue={searchArea?.name}
          onFilters={() => setSheet("filters")}
          filterCount={filterCount}
          geolocation={geolocation}
        />
      </MapView>

      {/* Indicateurs discrets : compteur, présence, chargement */}
      <div className="pointer-events-none absolute left-3 right-3 z-[var(--z-overlay)] flex flex-col items-start gap-2" style={{ top: "calc(var(--safe-top) + var(--topbar-height) + 12px)" }}>
        <Link
          to="/around"
          className="glass pointer-events-auto inline-flex min-h-11 max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[14px] font-semibold text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
          aria-label={`${fr.nav.around} — ${visibleReports.length} ${visibleReports.length > 1 ? "signalements" : "signalement"} dans la vue`}
          title={fr.nav.around}
        >
          <span
            className={isFetching ? "size-2 animate-pulse rounded-full bg-accent" : "size-2 rounded-full bg-success"}
            aria-hidden="true"
          />
          <span className="truncate" aria-live="polite">
            {loadingFirst
              ? fr.common.loading
              : `${visibleReports.length} ${visibleReports.length > 1 ? "signalements" : "signalement"} dans la vue`}
          </span>
          <List className="size-4 shrink-0 text-primary" aria-hidden="true" />
        </Link>
        {activeUsers > 0 ? (
          <div className="glass pointer-events-auto inline-flex max-w-full items-center rounded-full px-3 py-1.5 text-[14px] text-fg">
            {phrases.activeUsers(activeUsers)}
          </div>
        ) : null}
      </div>

      {/* Légende repliable (icônes, couleurs, ancienneté) */}
      <div className="absolute right-3 z-[var(--z-overlay)]" style={{ bottom: "calc(var(--safe-bottom) + 16px)" }}>
        {legendOpen ? (
          <MapLegend open={legendOpen} onToggle={setLegendOpen} className="mb-2 w-[min(320px,calc(100vw-24px))]" />
        ) : (
          <IconButton aria-label={fr.mapUi.legend} title={fr.mapUi.legend} variant="glass" size={44} shape="round" onClick={() => setLegendOpen(true)}>
            <Info />
          </IconButton>
        )}
      </div>

      {/* Absence de signalement ≠ absence de danger (section 27) */}
      {showEmpty && sheet === "none" && !selectedReport && !selectedAlert ? (
        <div className="pointer-events-none absolute left-3 right-3 z-[var(--z-overlay)]" style={{ bottom: "calc(var(--safe-bottom) + 72px)" }}>
          <p className="glass mx-auto max-w-md rounded-xl px-4 py-3 text-center text-[14px] leading-snug text-fg">
            <span className="font-semibold">{fr.mapUi.noReports}</span> {fr.safetyNotice.rules[1]}
          </p>
        </div>
      ) : null}

      <SearchSheet open={sheet === "search"} onClose={() => setSheet("none")} onSelect={onSelectArea} />
      <FilterSheet open={sheet === "filters"} onClose={() => setSheet("none")} />
      <ReportPreviewSheet report={selectedReport} onClose={() => setSelectedReportId(null)} />
      <AlertPreviewSheet alert={selectedAlert} onClose={() => setSelectedAlertId(null)} />
    </div>
  );
}
