/**
 * Préparation de l'activité (sections 5, 8, 16, 18) : activité, mode libre ou
 * itinéraire (sentiers à proximité, trace GPX importée, trace enregistrée),
 * précision du suivi, guidage vocal, simulation de démonstration.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bike, Compass, FileUp, Footprints, History, Mountain, Route, Trash2 } from "lucide-react";
import {
  bboxFromCenter,
  buildRoute,
  formatDistance,
  fr,
  haversineM,
  routeFromGpx,
  routeFromTrail,
  trackToRoute,
  type ActivityMode,
  type NavRoute,
  type Trail,
  type TrackingMode,
} from "@mountain-live/core";
import { Banner, Button, Card, EmptyState, ListItem, Segmented, SkeletonListItem, Toggle, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { db, type SavedTrack } from "@/lib/db";
import { useUiStore } from "@/store/ui";
import { formatDurationShort } from "@mountain-live/core";
import { deleteTrack, listTracks } from "./tracks";
import { useNavigationStore, type NavMode } from "./store";

const ACTIVITY_OPTIONS: { value: ActivityMode; label: string; icon: React.ReactNode }[] = [
  { value: "hiking", label: fr.navigation.activities.hiking, icon: <Footprints /> },
  { value: "trail", label: fr.navigation.activities.trail, icon: <Mountain /> },
  { value: "mtb", label: fr.navigation.activities.mtb, icon: <Bike /> },
  { value: "equestrian", label: fr.navigation.activities.equestrian, icon: <Compass /> },
];
const TRACKING_OPTIONS: { value: TrackingMode; label: string }[] = [
  { value: "eco", label: "Éco" },
  { value: "normal", label: "Normal" },
  { value: "precise", label: "Précis" },
];
const DIFFICULTY: Record<Trail["difficulty"], string> = { easy: "Facile", moderate: "Modéré", hard: "Difficile", expert: "Expert" };

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

  const [mode, setMode] = useState<NavMode>(presetMode ?? (presetRoute ? "route" : "free"));
  const [route, setRoute] = useState<NavRoute | null>(presetRoute);
  const [simulate, setSimulate] = useState(presetSimulate);
  const [tracks, setTracks] = useState<SavedTrack[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (presetRoute) {
      setRoute(presetRoute);
      setMode("route");
    }
  }, [presetRoute]);
  useEffect(() => {
    void listTracks().then(setTracks);
  }, []);

  const center = position && Date.now() - position.at < 30 * 60_000 ? position : { lat: view.lat, lng: view.lng };
  const bbox = useMemo(() => bboxFromCenter(center, 15_000), [center.lat, center.lng]);
  const trails = useQuery({
    queryKey: qk.trails(bbox),
    queryFn: async () => {
      if (!online) {
        const zones = await db.zones.toArray();
        const seen = new Map<string, Trail>();
        for (const z of zones) for (const t of z.trails) seen.set(t.id, t);
        return { trails: [...seen.values()] };
      }
      return api.trails(bbox);
    },
    enabled: mode === "route",
    staleTime: 10 * 60_000,
  });
  const nearby = useMemo(() => {
    const list = trails.data?.trails ?? [];
    return list
      .map((t) => {
        const c = t.geometry.type === "LineString" ? t.geometry.coordinates[0] : null;
        return { trail: t, distanceM: c ? haversineM(center, { lng: c[0], lat: c[1] }) : Infinity };
      })
      .sort((a, b) => a.distanceM - b.distanceM)
      .slice(0, 12);
  }, [trails.data, center.lat, center.lng]);

  const onFile = async (file: File | null) => {
    if (!file) return;
    const xml = await file.text();
    const r = routeFromGpx(xml, `gpx_${Date.now().toString(36)}`, file.name.replace(/\.gpx$/i, ""));
    if (!r) {
      toast.warning(fr.navigation.gpxInvalid);
      return;
    }
    setRoute(r);
    setMode("route");
    toast.success(fr.navigation.gpxImported.replace("{name}", r.name));
  };

  const canStart = mode === "free" || route !== null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-32 pt-3" data-testid="nav-setup">
      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-muted">{fr.navigation.activity}</h2>
        <Segmented options={ACTIVITY_OPTIONS.map((o) => ({ value: o.value, label: o.label, icon: o.icon }))} value={activity} onChange={setActivity} aria-label={fr.navigation.activity} size="lg" />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-muted">{fr.navigation.setup.title}</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ModeCard selected={mode === "free"} icon={<Compass />} title={fr.navigation.setup.modeFree} hint={fr.navigation.setup.modeFreeHint} onClick={() => setMode("free")} testId="nav-mode-free" />
          <ModeCard selected={mode === "route"} icon={<Route />} title={fr.navigation.setup.modeRoute} hint={fr.navigation.setup.modeRouteHint} onClick={() => setMode("route")} testId="nav-mode-route" />
        </div>
      </section>

      {mode === "route" ? (
        <section className="flex flex-col gap-3">
          {route ? (
            <Card tone="soft" padding="md" accentColor="#1D6FA5" data-testid="nav-selected-route">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold uppercase tracking-wide text-primary">{fr.navigation.startRoute}</p>
                  <p className="truncate text-[17px] font-bold text-fg">{route.name}</p>
                  <p className="text-[14px] text-muted">
                    {formatDistance(route.lengthM)}
                    {route.elevationGainM !== null ? ` · +${route.elevationGainM} m` : ""}
                    {route.source === "gpx" ? " · GPX" : route.source === "track" ? ` · ${fr.navigation.myTracks}` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="md" onClick={() => setRoute(null)}>
                  {fr.common.edit}
                </Button>
              </div>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" leftIcon={<FileUp />} onClick={() => fileRef.current?.click()}>
              {fr.navigation.importGpx}
            </Button>
            <input ref={fileRef} type="file" accept=".gpx,application/gpx+xml" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} data-testid="nav-gpx-input" />
          </div>

          <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">{fr.navigation.nearbyRoutes}</h3>
          {trails.isLoading ? (
            <div className="flex flex-col gap-2">
              <SkeletonListItem />
              <SkeletonListItem />
            </div>
          ) : nearby.length === 0 ? (
            <EmptyState compact icon={<Route />} title={fr.navigation.noNearbyRoutes} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {nearby.map(({ trail, distanceM }) => (
                <ListItem
                  key={trail.id}
                  icon={<Route />}
                  title={trail.name}
                  active={route?.id === trail.id}
                  subtitle={`${Number.isFinite(distanceM) ? `Départ à ${formatDistance(distanceM)} · ` : ""}${trail.distanceKm.toLocaleString("fr-FR")} km · +${trail.elevationGainM} m · ${DIFFICULTY[trail.difficulty]}`}
                  onClick={() => {
                    const r = routeFromTrail(trail);
                    if (r) setRoute(r);
                  }}
                  chevron
                  data-testid={`nav-trail-${trail.id}`}
                />
              ))}
            </div>
          )}

          {tracks.length > 0 ? (
            <>
              <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">{fr.navigation.myTracks}</h3>
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {tracks.map((t) => (
                  <ListItem
                    key={t.id}
                    icon={<History />}
                    title={t.name}
                    active={route?.id === t.id}
                    subtitle={`${formatDistance(t.stats.distanceM)} · ${formatDurationShort(t.stats.durationMs)} · +${t.stats.gainM} m`}
                    onClick={() => setRoute(trackToRoute(t.points, t.id, t.name))}
                    trailing={
                      <button
                        type="button"
                        className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
                        aria-label={`${fr.common.delete} ${t.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteTrack(t.id).then(() => listTracks().then(setTracks));
                        }}
                      >
                        <Trash2 className="size-5" />
                      </button>
                    }
                  />
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-muted">{fr.navigation.trackingMode}</h2>
        <Segmented options={TRACKING_OPTIONS} value={trackingMode} onChange={setTrackingMode} aria-label={fr.navigation.trackingMode} />
        <p className="text-[13px] text-muted">{fr.navigation.trackingHints[trackingMode]}</p>
      </section>

      <section className="flex flex-col gap-2">
        <Toggle checked={voice} onChange={setVoice} label={fr.navigation.voice} description={fr.navigation.voiceHint} />
        {route ? <Toggle checked={simulate} onChange={setSimulate} label={fr.navigation.simulate} description="Rejoue l'itinéraire avec un GPS simulé : utile sur ordinateur ou pour découvrir l'écran de navigation." id="nav-simulate" /> : null}
      </section>

      {!online ? <Banner tone="info" compact>{fr.navigation.setup.offlineHint}</Banner> : null}

      <div className="fixed inset-x-0 z-[var(--z-overlay)] px-4" style={{ bottom: "calc(var(--safe-bottom) + 16px)" }}>
        <div className="mx-auto max-w-2xl">
          <Button size="xl" fullWidth disabled={!canStart} onClick={() => onStart({ mode, route: mode === "route" ? route : null, simulate: mode === "route" && simulate })} data-testid="nav-start">
            {mode === "free" ? fr.navigation.startFree : fr.navigation.start}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModeCard({ selected, icon, title, hint, onClick, testId }: { selected: boolean; icon: React.ReactNode; title: string; hint: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      data-testid={testId}
      className={`flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 ${selected ? "border-primary bg-primary/8" : "border-line bg-surface hover:border-primary/50"}`}
    >
      <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${selected ? "bg-primary text-primary-fg" : "bg-surface-2 text-fg"} [&_svg]:size-5`} aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[16px] font-bold text-fg">{title}</span>
        <span className="block text-[13px] leading-snug text-muted">{hint}</span>
      </span>
    </button>
  );
}

export function routeFromSavedTrack(t: SavedTrack): NavRoute {
  return buildRoute({ id: t.id, name: t.name, coordinates: t.points.map((p) => [p.lng, p.lat]), elevations: t.points.map((p) => p.alt), source: "track" });
}
