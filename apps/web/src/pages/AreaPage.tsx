/**
 * Fiche d'un secteur (section 22) : carte, restrictions et alertes officielles en premier
 * (section 27), activités en cours, dangers et chemins, points d'eau, sentiers, fréquentation.
 */
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Download, MapPin, Users } from "lucide-react";
import { CATEGORIES, SUBTYPE_BY_ID, formatUntil, fr, phrases, type Report, type Trail } from "@mountain-live/core";
import { Badge, Button, CategoryIcon, ConfidenceBadge, DangerPill, EmptyState, IconButton, ListItem, RelativeTime, SkeletonText, SourceBadge, TopBar, LinkButton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatElevation } from "@/lib/format";
import { useUiStore } from "@/store/ui";
import { AREA_TYPE_ICONS, areaSubtitle } from "@/features/map/areas";
import { MiniMap } from "@/features/explore/MiniMap";

const CROWD_LABEL = { low: fr.mapUi.crowdLow, medium: fr.mapUi.crowdMedium, high: fr.mapUi.crowdHigh } as const;
const DIFFICULTY: Record<Trail["difficulty"], string> = { easy: "Facile", moderate: "Modéré", hard: "Difficile", expert: "Expert" };
const TRAIL_TYPE: Record<Trail["type"], string> = { hiking: "Randonnée", trail: "Trail", mtb: "VTT", equestrian: "Équestre", mixed: "Multi-usages" };

function ReportRow({ r, onOpen }: { r: Report; onOpen: () => void }) {
  const def = SUBTYPE_BY_ID[r.subtype];
  return (
    <ListItem
      icon={<CategoryIcon subtype={r.subtype} />}
      iconColor={CATEGORIES.find((c) => c.id === r.category)?.color}
      title={def?.label ?? r.subtype}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2">
          <RelativeTime date={r.createdAt} prefix="Signalé" />
          {r.endsAt ? <span>· {formatUntil(r.endsAt)}</span> : null}
          {r.dangerLevel ? <DangerPill level={r.dangerLevel} /> : null}
          <ConfidenceBadge label={r.confidenceLabel} />
        </span>
      }
      onClick={onOpen}
      chevron
    />
  );
}

export default function AreaPage() {
  const { areaId = "" } = useParams<{ areaId: string }>();
  const navigate = useNavigate();
  const setView = useUiStore((s) => s.setView);
  const query = useQuery({ queryKey: qk.area(areaId), queryFn: () => api.areas.get(areaId), enabled: Boolean(areaId), refetchInterval: 60_000 });
  const data = query.data;

  const byCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of data?.reports ?? []) counts[r.category] = (counts[r.category] ?? 0) + 1;
    return counts;
  }, [data]);

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-4">
        <SkeletonText lines={2} />
        <div className="ml-skeleton mt-4 h-56 w-full rounded-xl" />
        <SkeletonText lines={5} />
      </div>
    );
  }
  if (!data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex h-full flex-col">
        <TopBar variant="solid" title={fr.explorePage.title} leading={<IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => navigate(-1)}><ChevronLeft /></IconButton>} />
        <EmptyState icon={<MapPin />} title={notFound ? "Secteur introuvable" : fr.errors.network} action={<Button onClick={() => navigate("/explore")}>{fr.explorePage.title}</Button>} />
      </div>
    );
  }

  const { area } = data;
  const restrictions = data.restrictions ?? [];
  const activities = data.activities ?? [];
  const excluded = new Set([...restrictions, ...activities].map((r) => r.id));
  const others = data.reports.filter((r) => !excluded.has(r.id));
  const bbox = area.bbox ?? null;
  const zoom = area.type === "massif" ? 11 : area.type === "commune" ? 12 : area.type === "hamlet" || area.type === "spring" ? 14 : 13;

  const openMap = () => {
    setView({ lat: area.lat, lng: area.lng, zoom });
    navigate("/map", { state: { focus: { lat: area.lat, lng: area.lng }, zoom } });
  };
  const download = () => {
    const b = bbox ?? { west: area.lng - 0.08, south: area.lat - 0.06, east: area.lng + 0.08, north: area.lat + 0.06 };
    navigate(`/offline?bbox=${[b.west, b.south, b.east, b.north].map((n) => n.toFixed(4)).join(",")}&name=${encodeURIComponent(area.name)}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar variant="solid" title={area.name} subtitle={areaSubtitle(area, formatElevation)} leading={<IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => navigate(-1)}><ChevronLeft /></IconButton>} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-10 pt-3">
          {area.description ? <p className="text-[15px] leading-relaxed text-fg">{area.description}</p> : null}

          <MiniMap center={area} zoom={zoom} bbox={bbox} reports={data.reports} alerts={data.officialAlerts} waterPoints={data.waterPoints} trails={data.trails} onReportClick={(r) => navigate(`/reports/${r.id}`)} aria-label={`Carte : ${area.name}`} />

          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" leftIcon={<MapPin />} onClick={openMap}>
              Ouvrir la carte ici
            </Button>
            <Button size="lg" variant="outline" leftIcon={<Download />} onClick={download}>
              {fr.offline.download}
            </Button>
          </div>

          {/* Indicateurs */}
          <section className="rounded-xl border border-line bg-surface p-4">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-fg">
              <Users className="size-5 text-primary" aria-hidden="true" />
              {fr.explorePage.crowd} : {CROWD_LABEL[data.crowdLevel]}
            </p>
            <p className="text-[13px] text-muted">{phrases.activeUsers(data.activeUsersEstimate)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[13px] font-semibold" style={{ color: c.color }}>
                  <CategoryIcon category={c.id} className="size-4" />
                  {c.shortLabel} <span className="text-fg">{byCategory[c.id] ?? 0}</span>
                </span>
              ))}
            </div>
          </section>

          {/* Restrictions et alertes officielles : toujours en premier */}
          <Section title={`${fr.explorePage.restrictions} et ${fr.explorePage.officialAlerts.toLowerCase()}`} count={data.officialAlerts.length + restrictions.length}>
            {data.officialAlerts.map((a) => (
              <div key={a.id} className="flex items-start gap-3 border-b border-line px-3 py-3 last:border-b-0">
                <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-gold-soft text-gold" aria-hidden="true">
                  <CategoryIcon category={a.category} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold text-fg">{a.title}</p>
                  <p className="text-[13px] text-muted">
                    {a.organisation} · {a.endsAt ? formatUntil(a.endsAt) : "en cours"}
                  </p>
                  <p className="mt-1 text-[14px] text-fg">{a.body}</p>
                  <div className="mt-1 flex gap-2">
                    <SourceBadge source="official" />
                    <DangerPill level={a.severity} />
                  </div>
                </div>
              </div>
            ))}
            {restrictions.map((r) => (
              <ReportRow key={r.id} r={r} onOpen={() => navigate(`/reports/${r.id}`)} />
            ))}
          </Section>

          <Section title={fr.explorePage.activities} count={activities.length}>
            {activities.map((r) => (
              <ReportRow key={r.id} r={r} onOpen={() => navigate(`/reports/${r.id}`)} />
            ))}
          </Section>

          <Section title="Dangers, chemins et observations" count={others.length}>
            {others.map((r) => (
              <ReportRow key={r.id} r={r} onOpen={() => navigate(`/reports/${r.id}`)} />
            ))}
          </Section>

          <Section title={fr.explorePage.water} count={data.waterPoints.length}>
            {data.waterPoints.map((w) => (
              <ListItem
                key={w.id}
                icon={<CategoryIcon name={w.type === "refuge" ? "house" : w.type === "shelter" ? "warehouse" : "droplet"} />}
                iconColor={w.lastState === "dry" ? "#8A949E" : "#1D6FA5"}
                title={w.name}
                subtitle={`${w.elevation ? `${formatElevation(w.elevation)} · ` : ""}${w.lastState === "dry" ? "Signalée sèche" : w.lastState === "active" ? "Active" : "État inconnu"}${w.lastStateAt ? " · " : ""}`}
                trailing={w.lastStateAt ? <RelativeTime date={w.lastStateAt} className="text-[12px] text-muted" /> : <Badge tone="neutral">{w.type === "lake" ? "Lac" : w.type === "refuge" ? "Refuge" : w.type === "shelter" ? "Abri" : w.type === "fountain" ? "Fontaine" : w.type === "stream" ? "Ruisseau" : "Source"}</Badge>}
              />
            ))}
          </Section>

          <Section title={fr.explorePage.trails} count={data.trails.length}>
            {data.trails.map((t) => (
              <ListItem
                key={t.id}
                icon={<CategoryIcon name={AREA_TYPE_ICONS.trail} />}
                title={t.name}
                subtitle={`${TRAIL_TYPE[t.type]} · ${t.distanceKm.toLocaleString("fr-FR")} km · +${t.elevationGainM} m · ${DIFFICULTY[t.difficulty]}`}
                trailing={
                  <span onClick={(e) => e.stopPropagation()}>
                    <LinkButton to={`/navigate?trail=${encodeURIComponent(t.id)}`} variant="primary" size="md" aria-label={`${fr.navigation.start} : ${t.name}`}>
                      {fr.navigation.start}
                    </LinkButton>
                  </span>
                }
                onClick={() => {
                  const first = t.geometry.type === "LineString" ? t.geometry.coordinates[Math.floor(t.geometry.coordinates.length / 2)] : null;
                  if (first) {
                    setView({ lat: first[1], lng: first[0], zoom: 13 });
                    navigate("/map", { state: { focus: { lat: first[1], lng: first[0] }, zoom: 13 } });
                  } else navigate("/map");
                }}
                chevron
              />
            ))}
          </Section>
        </div>
      </main>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">
        {title} <span className="text-fg">({count})</span>
      </h2>
      {count === 0 ? <p className="rounded-xl border border-dashed border-line px-3 py-3 text-[14px] text-muted">Rien à signaler pour l'instant.</p> : <div className="overflow-hidden rounded-xl border border-line bg-surface">{children}</div>}
    </section>
  );
}
