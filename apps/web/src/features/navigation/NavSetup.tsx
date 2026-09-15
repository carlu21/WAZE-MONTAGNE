/**
 * Accueil de l'application : « Démarrer un itinéraire » (sections 5, 8, 16, 18).
 *
 * - Liste des itinéraires (sentiers de la base, importés d'OpenStreetMap ou de
 *   démonstration) les plus proches, avec recherche par nom ; un tap sélectionne,
 *   « Démarrer » lance le guidage.
 * - « Explorer librement » (sans itinéraire), import GPX, traces enregistrées.
 * - Réglages repliés : activité, précision du suivi, guidage vocal, simulation.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bike, ChevronDown, Compass, FileUp, Footprints, History, MapPinned, Mountain, Route, Search, Trash2 } from "lucide-react";
import {
  bboxFromCenter,
  buildRoute,
  formatDistance,
  formatDurationShort,
  fr,
  geometryFidelity,
  haversineM,
  routeFromGpx,
  routeFromTrail,
  trackToRoute,
  type ActivityMode,
  type NavRoute,
  type Trail,
  type TrailSummary,
  type TrackingMode,
} from "@mountain-live/core";
import { Banner, Button, Card, EmptyState, Input, ListItem, Segmented, SkeletonListItem, Toggle, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { db, type SavedTrack } from "@/lib/db";
import { useUiStore } from "@/store/ui";
import { deleteTrack, listTracks } from "./tracks";
import { RoutePlanner } from "@/features/network/RoutePlanner";
import { useNetworkStatus } from "@/features/network/NetworkHealth";
import { useNavigationStore, type NavMode } from "./store";

/** Libellés courts (quatre segments sur un écran de 390 px) ; les icônes servent de libellé accessible. */
const ACTIVITY_OPTIONS: { value: ActivityMode; label: string; icon: React.ReactNode }[] = [
  { value: "hiking", label: "Rando", icon: <Footprints /> },
  { value: "trail", label: "Trail", icon: <Mountain /> },
  { value: "mtb", label: "VTT", icon: <Bike /> },
  { value: "equestrian", label: "Cheval", icon: <Compass /> },
];
const TRACKING_OPTIONS: { value: TrackingMode; label: string }[] = [
  { value: "eco", label: "Éco" },
  { value: "normal", label: "Normal" },
  { value: "precise", label: "Précis" },
];
const DIFFICULTY: Record<Trail["difficulty"], string> = { easy: "Facile", moderate: "Modéré", hard: "Difficile", expert: "Expert" };
const TRAIL_TYPE: Record<Trail["type"], string> = { hiking: "Randonnée", trail: "Trail", mtb: "VTT", equestrian: "Équestre", mixed: "Multi-usages" };
/** Emprise de recherche des itinéraires autour de la position (m). */
const SEARCH_RADIUS_M = 60_000;
const LIST_LIMIT = 40;

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface NavSetupProps {
  /** Itinéraire présélectionné (lien « Démarrer » depuis une fiche). */
  presetRoute: NavRoute | null;
  presetMode: NavMode | null;
  presetSimulate: boolean;
  onStart: (input: { mode: NavMode; route: NavRoute | null; simulate: boolean }) => void;
}

export function NavSetup({ presetRoute, presetMode, presetSimulate, onStart }: NavSetupProps) {
  const activity = useNavigationStore((s) => s.activity);
  const setActivity = useNavigationStore((s) => s.setActivity);
  const trackingMode = useNavigationStore((s) => s.trackingMode);
  const setTrackingMode = useNavigationStore((s) => s.setTrackingMode);
  const voice = useNavigationStore((s) => s.voice);
  const setVoice = useNavigationStore((s) => s.setVoice);
  const position = useUiStore((s) => s.position);
  const view = useUiStore((s) => s.view);
  const online = useUiStore((s) => s.online);

  const [route, setRoute] = useState<NavRoute | null>(presetRoute);
  const [simulate, setSimulate] = useState(presetSimulate);
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<SavedTrack[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (presetRoute) setRoute(presetRoute);
  }, [presetRoute]);
  useEffect(() => {
    if (presetMode === "free") setRoute(null);
  }, [presetMode]);
  useEffect(() => {
    void listTracks().then(setTracks);
  }, []);

  const center = position && Date.now() - position.at < 30 * 60_000 ? position : { lat: view.lat, lng: view.lng };
  const bbox = useMemo(() => bboxFromCenter(center, SEARCH_RADIUS_M), [center.lat, center.lng]);
  const trails = useQuery({
    queryKey: qk.trailSummaries(bbox),
    queryFn: async (): Promise<{ trails: TrailSummary[] }> => {
      if (!online) {
        const zones = await db.zones.toArray();
        const seen = new Map<string, TrailSummary>();
        for (const z of zones) {
          for (const t of z.trails) {
            const c = t.geometry.type === "LineString" ? t.geometry.coordinates : [];
            const first = c[0];
            const last = c[c.length - 1];
            if (!first || !last) continue;
            const { geometry: _g, ...rest } = t;
            void _g;
            seen.set(t.id, { ...rest, start: { lng: first[0], lat: first[1] }, end: { lng: last[0], lat: last[1] }, points: c.length });
          }
        }
        return { trails: [...seen.values()] };
      }
      return api.trailSummaries(bbox);
    },
    staleTime: 10 * 60_000,
  });
  // « Réseau réel disponible » est décidé par le serveur, à partir de la
  // provenance enregistrée — plus par un test d'égalité à zéro côté client.
  const { stats, realDataReady } = useNetworkStatus(online);
  const demoOnly = stats !== null && !realDataReady;

  const list = useMemo(() => {
    const q = normalize(query.trim());
    const all = (trails.data?.trails ?? []).map((t) => ({ trail: t, distanceM: haversineM(center, t.start) }));
    const filtered = q ? all.filter(({ trail }) => normalize(trail.name).includes(q) || normalize(trail.description ?? "").includes(q)) : all;
    return filtered.sort((a, b) => a.distanceM - b.distanceM).slice(0, LIST_LIMIT);
  }, [trails.data, center.lat, center.lng, query]);

  const select = async (t: TrailSummary) => {
    if (route?.id === t.id) {
      setRoute(null);
      return;
    }
    setLoadingId(t.id);
    try {
      let full: Trail | null = null;
      if (online) full = (await api.trail(t.id)).trail;
      else {
        for (const z of await db.zones.toArray()) full = z.trails.find((x) => x.id === t.id) ?? full;
      }
      const r = full ? routeFromTrail(full) : null;
      if (!r) {
        toast.warning("Tracé indisponible pour cet itinéraire.");
        return;
      }
      /*
       * Un tracé qui relie des points de passage espacés de centaines de mètres
       * n'est pas un sentier : le suivre reviendrait à traverser la montagne en
       * ligne droite. On refuse, et on dit pourquoi — mieux vaut « bientôt
       * disponible » qu'un itinéraire techniquement faux.
       */
      if (geometryFidelity(r.coordinates, t.distanceKm * 1000).level !== "detailed") {
        toast.warning(fr.navigation.unavailable.schematicGeometry);
        return;
      }
      setRoute(r);
    } catch {
      toast.warning("Tracé indisponible pour l'instant.");
    } finally {
      setLoadingId(null);
    }
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    const xml = await file.text();
    const r = routeFromGpx(xml, `gpx_${Date.now().toString(36)}`, file.name.replace(/\.gpx$/i, ""));
    if (!r) {
      toast.warning(fr.navigation.gpxInvalid);
      return;
    }
    setRoute(r);
    toast.success(fr.navigation.gpxImported.replace("{name}", r.name));
  };

  const start = (mode: NavMode) => onStart({ mode, route: mode === "route" ? route : null, simulate: mode === "route" && simulate });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-44" style={{ paddingTop: "calc(var(--safe-top) + 12px)" }} data-testid="nav-setup">
      <header className="flex flex-col gap-1">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-fg">{fr.navigation.homeTitle}</h1>
        <p className="text-[15px] text-muted">{fr.navigation.homeSubtitle}</p>
      </header>

      {demoOnly ? (
        <Banner tone="info" compact data-testid="nav-demo-banner">
          {fr.navigation.demoNetwork}
        </Banner>
      ) : null}

      {route ? (
        <Card tone="soft" padding="md" accentColor="#1D6FA5" data-testid="nav-selected-route">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase tracking-wide text-primary">{fr.navigation.selectedRoute}</p>
              <p className="truncate text-[18px] font-bold text-fg">{route.name}</p>
              <p className="text-[14px] text-muted">
                {formatDistance(route.lengthM)}
                {route.elevationGainM ? ` · +${route.elevationGainM} m` : ""}
                {route.source === "gpx" ? " · GPX" : route.source === "track" ? ` · ${fr.navigation.myTracks}` : ""}
              </p>
            </div>
            <Button variant="ghost" size="md" onClick={() => setRoute(null)}>
              {fr.common.cancel}
            </Button>
          </div>
        </Card>
      ) : null}

      <section className="flex flex-col gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={fr.navigation.searchRoutes} leftIcon={<Search />} size="lg" aria-label={fr.navigation.searchRoutes} data-testid="nav-search" />
        <h2 className="mt-1 text-[13px] font-bold uppercase tracking-wide text-muted">{query.trim() ? fr.navigation.results : fr.navigation.nearbyRoutes}</h2>
        {trails.isLoading ? (
          <div className="flex flex-col gap-2">
            <SkeletonListItem />
            <SkeletonListItem />
            <SkeletonListItem />
          </div>
        ) : list.length === 0 ? (
          <EmptyState compact icon={<Route />} title={fr.navigation.noNearbyRoutes} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface" data-testid="nav-trail-list">
            {list.map(({ trail, distanceM }, i) => (
              <ListItem
                key={trail.id}
                icon={<Route />}
                title={trail.name}
                active={route?.id === trail.id}
                subtitle={`${Number.isFinite(distanceM) ? `Départ à ${formatDistance(distanceM)} · ` : ""}${trail.distanceKm.toLocaleString("fr-FR")} km${trail.elevationGainM > 0 ? ` · +${trail.elevationGainM} m` : ""} · ${DIFFICULTY[trail.difficulty]} · ${TRAIL_TYPE[trail.type]}`}
                onClick={() => void select(trail)}
                trailing={loadingId === trail.id ? <span className="text-[12px] text-muted">{fr.common.loading}</span> : undefined}
                chevron
                divider={i < list.length - 1}
                data-testid={`nav-trail-${trail.id}`}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-wrap gap-2">
        <Button variant="secondary" leftIcon={<MapPinned />} onClick={() => setPlannerOpen(true)} data-testid="nav-open-planner">
          Où allez-vous ?
        </Button>
        <Button variant="secondary" leftIcon={<FileUp />} onClick={() => fileRef.current?.click()}>
          {fr.navigation.importGpx}
        </Button>
        <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} data-testid="nav-gpx-input" />
      </section>

      {tracks.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-muted">{fr.navigation.myTracks}</h2>
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {tracks.map((t, i) => (
              <ListItem
                key={t.id}
                icon={<History />}
                title={t.name}
                active={route?.id === t.id}
                subtitle={`${formatDistance(t.stats.distanceM)} · ${formatDurationShort(t.stats.durationMs)} · +${t.stats.gainM} m`}
                onClick={() => setRoute(route?.id === t.id ? null : trackToRoute(t.points, t.id, t.name))}
                divider={i < tracks.length - 1}
                trailing={
                  // Pas de <button> imbriqué dans la ligne (elle-même un bouton) : rôle bouton sur un span.
                  <span
                    role="button"
                    tabIndex={0}
                    className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
                    aria-label={`${fr.common.delete} ${t.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteTrack(t.id).then(() => listTracks().then(setTracks));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        void deleteTrack(t.id).then(() => listTracks().then(setTracks));
                      }
                    }}
                  >
                    <Trash2 className="size-5" />
                  </span>
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-surface">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-[15px] font-bold text-fg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
          data-testid="nav-settings-toggle"
        >
          <span>
            {fr.navigation.settings} · {fr.navigation.activities[activity]} · {fr.navigation.trackingModes[trackingMode]}
          </span>
          <ChevronDown className={`size-5 transition-transform ${settingsOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {settingsOpen ? (
          <div className="flex flex-col gap-4 border-t border-line px-4 pb-4 pt-3">
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-bold uppercase tracking-wide text-muted">{fr.navigation.activity}</p>
              <Segmented options={ACTIVITY_OPTIONS.map((o) => ({ value: o.value, label: o.label, "aria-label": fr.navigation.activities[o.value] }))} value={activity} onChange={setActivity} aria-label={fr.navigation.activity} />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-bold uppercase tracking-wide text-muted">{fr.navigation.trackingMode}</p>
              <Segmented options={TRACKING_OPTIONS} value={trackingMode} onChange={setTrackingMode} aria-label={fr.navigation.trackingMode} />
              <p className="text-[13px] text-muted">{fr.navigation.trackingHints[trackingMode]}</p>
            </div>
            <Toggle checked={voice} onChange={setVoice} label={fr.navigation.voice} description={fr.navigation.voiceHint} />
            <Toggle checked={simulate} onChange={setSimulate} label={fr.navigation.simulate} description="Rejoue l'itinéraire choisi avec un GPS simulé : utile sur ordinateur ou pour découvrir l'écran de navigation." id="nav-simulate" />
          </div>
        ) : null}
      </section>

      {!online ? <Banner tone="info" compact>{fr.navigation.setup.offlineHint}</Banner> : null}

      {/* Barre d'action fixe, au-dessus du bouton flottant « Signaler » de la coquille. */}
      <RoutePlanner open={plannerOpen} onClose={() => setPlannerOpen(false)} activity={activity} onSelect={(r) => setRoute(r)} />

      <div className="fixed inset-x-0 z-[var(--z-overlay)] px-4" style={{ bottom: "calc(var(--shell-bottom) + 40px)", left: "var(--shell-left)" }}>
        <div className="mx-auto flex max-w-2xl gap-2">
          {route ? (
            <>
              <Button size="xl" variant="secondary" className="w-16 shrink-0 px-0" onClick={() => start("free")} aria-label={fr.navigation.startFree} title={fr.navigation.startFree} data-testid="nav-start-free">
                <Compass />
              </Button>
              <Button size="xl" className="flex-1" onClick={() => start("route")} leftIcon={<Route />} data-testid="nav-start">
                {fr.navigation.start}
              </Button>
            </>
          ) : (
            <Button size="xl" className="flex-1" onClick={() => start("free")} leftIcon={<Compass />} data-testid="nav-start-free">
              {fr.navigation.startFree}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function routeFromSavedTrack(t: SavedTrack): NavRoute {
  return buildRoute({ id: t.id, name: t.name, coordinates: t.points.map((p) => [p.lng, p.lat]), elevations: t.points.map((p) => p.alt), source: "track" });
}
