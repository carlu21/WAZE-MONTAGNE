/**
 * « Autour de moi » (section 24) : cartes verticales triées par distance
 * (« À 300 m : Source », « À 650 m : Troupeau signalé il y a 20 min »…),
 * alertes officielles en premier, points d'eau intercalés, repli hors ligne.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { LocateFixed, Map as MapIcon, Navigation } from "lucide-react";
import { SUBTYPE_BY_ID, bboxFromCenter, formatDistance, formatUntil, fr, haversineM, inBBox, phrases, type Report } from "@mountain-live/core";
import { Button, CategoryIcon, ConfidenceBadge, DangerPill, EmptyState, RelativeTime, Segmented, SkeletonListItem, SourceBadge, TopBar, cn } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { db } from "@/lib/db";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { useGeolocation } from "@/features/map/useGeolocation";
import { AROUND_RADII, cardinalDirection, mergeAround, type AroundEntry } from "@/features/around/merge";
import { applyExcludedSubtypes } from "@/features/map/facets";
import { offlineExtras } from "@/features/offline/extras";

export default function AroundPage() {
  const navigate = useNavigate();
  const position = useUiStore((s) => s.position);
  const online = useUiStore((s) => s.online);
  const filters = useUiStore((s) => s.filters);
  const excludedSubtypes = useUiStore((s) => s.excludedSubtypes);
  const setView = useUiStore((s) => s.setView);
  const prefRadius = useSessionStore((s) => s.user?.preferences.aroundRadiusM);
  const [radius, setRadius] = useState<number>(() => (prefRadius && AROUND_RADII.includes(prefRadius as (typeof AROUND_RADII)[number]) ? prefRadius : 3000));
  const geo = useGeolocation();

  const center = position ? { lat: position.lat, lng: position.lng } : null;
  const query = useQuery({
    queryKey: center ? qk.around(center.lat, center.lng, radius) : ["around", "none"],
    enabled: Boolean(center),
    refetchInterval: 60_000,
    queryFn: async () => {
      const c = center!;
      if (!online) return fromCache(c, radius);
      try {
        return await api.around({ lat: c.lat, lng: c.lng, radius, categories: filters });
      } catch {
        return fromCache(c, radius);
      }
    },
  });

  const entries: AroundEntry[] = useMemo(() => {
    if (!query.data || !center) return [];
    const items = applyExcludedSubtypes(filters.length ? query.data.items.filter((r) => filters.includes(r.category)) : query.data.items, excludedSubtypes);
    return mergeAround(items, query.data.waterPoints, query.data.officialAlerts, center, haversineM);
  }, [query.data, center, filters, excludedSubtypes]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar variant="solid" title={fr.around.title} subtitle={center ? fr.around.sortedByDistance : undefined}>
        <div className="px-1 pb-2">
          <Segmented aria-label={fr.around.radius} value={String(radius)} onChange={(v) => setRadius(Number(v))} options={AROUND_RADII.map((r) => ({ value: String(r), label: formatDistance(r) }))} />
        </div>
      </TopBar>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pb-24 pt-3">
          {!center ? (
            <EmptyState
              icon={<LocateFixed />}
              title={fr.around.needLocation}
              description={geo.error ?? fr.onboarding.locationBody}
              action={
                <Button size="lg" leftIcon={<LocateFixed />} loading={geo.status === "locating"} onClick={() => void geo.request()}>
                  {fr.onboarding.locationAllow}
                </Button>
              }
            />
          ) : query.isLoading ? (
            <>
              <SkeletonListItem />
              <SkeletonListItem />
              <SkeletonListItem />
            </>
          ) : entries.length === 0 ? (
            <EmptyState icon={<Navigation />} title={fr.around.empty} description={fr.safetyNotice.rules[1]} />
          ) : (
            <ul className="flex flex-col gap-2">
              {entries.map((e) => (
                <li key={`${e.kind}-${e.kind === "alert" ? e.alert.id : e.kind === "report" ? e.report.id : e.waterPoint.id}`}>
                  <AroundCard entry={e} center={center} onOpen={(id) => navigate(`/reports/${id}`)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ bottom: "calc(var(--shell-bottom, var(--nav-height)) + 16px)" }}>
        <Button
          className="pointer-events-auto shadow-lg"
          size="md"
          leftIcon={<MapIcon />}
          onClick={() => {
            if (center) {
              setView({ lat: center.lat, lng: center.lng, zoom: 14 });
              navigate("/map", { state: { focus: center, zoom: 14 } });
            } else navigate("/map");
          }}
        >
          {fr.nav.map}
        </Button>
      </div>
    </div>
  );
}

async function fromCache(center: { lat: number; lng: number }, radius: number) {
  const bbox = bboxFromCenter(center, radius);
  const cached = await db.reports.filter((r) => inBBox(r, bbox)).toArray();
  const now = Date.now();
  const items: Report[] = cached
    .filter((r) => new Date(r.expiresAt).getTime() > now)
    .map(({ cachedAt: _c, ...r }) => ({ ...r, distanceM: Math.round(haversineM(center, r)) }))
    .filter((r) => (r.distanceM ?? 0) <= radius)
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
  // Zones téléchargées : alertes officielles et points d'eau (section 9).
  const extras = await offlineExtras(bbox, now);
  const waterPoints = extras.waterPoints
    .map((w) => ({ ...w, distanceM: Math.round(haversineM(center, w)) }))
    .filter((w) => w.distanceM <= radius)
    .sort((a, b) => a.distanceM - b.distanceM);
  return { center, radiusM: radius, items, officialAlerts: extras.officialAlerts, waterPoints };
}

function AroundCard({ entry, center, onOpen }: { entry: AroundEntry; center: { lat: number; lng: number }; onOpen: (id: string) => void }) {
  if (entry.kind === "alert") {
    const a = entry.alert;
    return (
      <div className="flex gap-3 rounded-xl border-2 border-gold bg-surface p-3">
        <DistanceBlock meters={entry.distanceM} dir={cardinalDirection(center, { lat: a.centroidLat, lng: a.centroidLng })} />
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold text-fg">{a.title}</p>
          <p className="text-[14px] text-muted">
            {a.organisation}
            {a.endsAt ? ` · ${formatUntil(a.endsAt)}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <SourceBadge source="official" />
            <DangerPill level={a.severity} />
          </div>
        </div>
      </div>
    );
  }
  if (entry.kind === "water") {
    const w = entry.waterPoint;
    return (
      <div className="flex gap-3 rounded-xl border border-line bg-surface p-3">
        <DistanceBlock meters={entry.distanceM} dir={cardinalDirection(center, w)} />
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white" style={{ background: w.lastState === "dry" ? "#8A949E" : "#1D6FA5" }} aria-hidden="true">
            <CategoryIcon name={w.type === "refuge" ? "house" : w.type === "shelter" ? "warehouse" : "droplet"} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-bold text-fg">{w.name}</p>
            <p className="text-[14px] text-muted">{w.lastState === "dry" ? "Signalée sèche" : w.lastState === "active" ? "Active" : "État inconnu"}{w.lastStateAt ? " · " : ""}{w.lastStateAt ? <RelativeTime date={w.lastStateAt} /> : null}</p>
          </div>
        </div>
      </div>
    );
  }
  const r = entry.report;
  const def = SUBTYPE_BY_ID[r.subtype];
  const color = def ? (({ danger: "#C8341F", path: "#D9822B", activity: "#B45309", animals: "#6B4F2A", water: "#1D6FA5", crowd: "#5B6B7A" }) as Record<string, string>)[def.category] : "#1F4D28";
  return (
    <button type="button" onClick={() => onOpen(r.id)} className={cn("flex w-full gap-3 rounded-xl border border-line bg-surface p-3 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40")} style={{ opacity: Math.max(0.6, r.fade ?? 1) }}>
      <DistanceBlock meters={entry.distanceM} dir={cardinalDirection(center, r)} />
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white" style={{ background: color }} aria-hidden="true">
          <CategoryIcon subtype={r.subtype} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold leading-tight text-fg">{phrases.aroundItem(entry.distanceM, def?.label ?? r.subtype).replace(/^À [^:]+: /, "")}</p>
          <p className="text-[14px] text-muted">
            <RelativeTime date={r.createdAt} prefix="Signalé" />
            {r.endsAt ? ` · ${formatUntil(r.endsAt)}` : ""}
            {r.zone ? ` · ${r.zone}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {r.dangerLevel ? <DangerPill level={r.dangerLevel} /> : null}
            <ConfidenceBadge label={r.confidenceLabel} />
            {r.source !== "community" ? <SourceBadge source={r.source} /> : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function DistanceBlock({ meters, dir }: { meters: number; dir: string }) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-2 py-1">
      <span className="text-[11px] font-semibold uppercase text-muted">À</span>
      <span className="text-[17px] font-extrabold leading-tight text-fg">{formatDistance(meters)}</span>
      <span className="text-[11px] font-semibold text-muted" aria-label={`direction ${dir}`}>
        {dir}
      </span>
    </div>
  );
}
