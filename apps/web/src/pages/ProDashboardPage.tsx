/**
 * Tableau de bord professionnel (section 18, version pilote) : indicateurs,
 * répartition par catégorie, chronologie, zones à incidents (carte thermique),
 * points d'eau régulièrement secs, zones de conflits d'usage, export CSV.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Download, Search } from "lucide-react";
import { CATEGORIES, CATEGORY_BY_ID, SUBTYPE_BY_ID, fr, type Area } from "@mountain-live/core";
import { Banner, Button, EmptyState, IconButton, Input, ListItem, Segmented, Stat, TopBar } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { BarChart, LineChart } from "@/features/admin/charts";
import { downloadTextFile, toCsv } from "@/features/admin/csv";
import { MiniMap } from "@/features/explore/MiniMap";

const PERIODS = [7, 30, 90] as const;
const CORSICA = { lat: 42.15, lng: 9.1 };

export default function ProDashboardPage() {
  const navigate = useNavigate();
  const [days, setDays] = useState<number>(30);
  const [area, setArea] = useState<Area | null>(null);
  const [q, setQ] = useState("");
  const search = useQuery({ queryKey: qk.areaSearch(`pro:${q}`), queryFn: () => api.areas.search(q), enabled: q.trim().length >= 2 });

  const params = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    return { areaId: area?.id, from: from.toISOString(), to: to.toISOString() };
  }, [days, area]);
  const dash = useQuery({ queryKey: qk.pro(params), queryFn: () => api.pro.dashboard(params), placeholderData: (prev) => prev });
  const d = dash.data;

  const exportCsv = () => {
    if (!d) return;
    const rows = [
      { indicateur: "Secteur", valeur: d.areaName ?? "Tous" },
      { indicateur: "Période", valeur: `${d.period.from.slice(0, 10)} → ${d.period.to.slice(0, 10)}` },
      { indicateur: "Signalements", valeur: d.reportsTotal },
      { indicateur: "Résolus", valeur: d.reportsResolved },
      { indicateur: "Délai moyen de résolution (h)", valeur: d.avgResolutionHours ?? "" },
      { indicateur: "Fréquentation estimée", valeur: d.estimatedVisitors },
      ...CATEGORIES.map((c) => ({ indicateur: `Catégorie ${c.label}`, valeur: d.byCategory[c.id] ?? 0 })),
      ...d.topSubtypes.map((t) => ({ indicateur: `Sous-type ${SUBTYPE_BY_ID[t.subtype]?.label ?? t.subtype}`, valeur: t.count })),
      ...d.hotspots.map((h, i) => ({ indicateur: `Zone à incidents ${i + 1} (${h.lat.toFixed(3)}, ${h.lng.toFixed(3)})`, valeur: h.count })),
      ...d.recurringWaterIssues.map((w) => ({ indicateur: `Point d'eau sec : ${w.name}`, valeur: w.dryCount })),
      ...d.timeline.map((t) => ({ indicateur: `Jour ${t.date}`, valeur: t.count })),
    ];
    downloadTextFile(`mountain-live-${(d.areaName ?? "tous").replace(/\s+/g, "-").toLowerCase()}-${days}j.csv`, toCsv(rows, ["indicateur", "valeur"]));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <TopBar
        variant="solid"
        title="Tableau de bord professionnel"
        subtitle={d?.areaName ?? "Tous secteurs"}
        leading={
          <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => navigate("/profile")}>
            <ChevronLeft />
          </IconButton>
        }
        actions={
          <Button size="md" variant="outline" leftIcon={<Download />} disabled={!d} onClick={exportCsv}>
            CSV
          </Button>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 pb-12 pt-4">
          <Banner tone="info" compact title="Version pilote">
            Offre professionnelle à venir pour les collectivités et gestionnaires d'espaces : pilotage, historique, exports.
          </Banner>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="relative">
              <Input size="md" leftIcon={<Search />} placeholder="Secteur : commune, massif, sentier…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Secteur" />
              {q.trim().length >= 2 && search.data?.areas.length ? (
                <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface shadow-lg">
                  {search.data.areas.map((a) => (
                    <li key={a.id}>
                      <ListItem title={a.name} subtitle={a.type} onClick={() => { setArea(a); setQ(""); }} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {area ? (
                <button type="button" className="mt-1 text-[13px] font-semibold text-primary" onClick={() => setArea(null)}>
                  Secteur : {area.name} — tout afficher
                </button>
              ) : null}
            </div>
            <Segmented aria-label="Période" value={String(days)} onChange={(v) => setDays(Number(v))} options={PERIODS.map((p) => ({ value: String(p), label: `${p} j` }))} />
          </div>

          {dash.isError ? <EmptyState title={fr.errors.forbidden} description={dash.error instanceof ApiError ? dash.error.message : fr.errors.network} /> : null}
          {d ? (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat value={d.reportsTotal} label="Signalements" />
                <Stat value={d.reportsResolved} label="Résolus" />
                <Stat value={d.avgResolutionHours == null ? "—" : `${Math.round(d.avgResolutionHours)} h`} label="Délai moyen de résolution" />
                <Stat value={d.estimatedVisitors} label="Fréquentation estimée" />
              </div>

              <section className="rounded-xl border border-line bg-surface p-4">
                <h2 className="mb-2 text-[16px] font-bold text-fg">Par catégorie</h2>
                <BarChart data={CATEGORIES.map((c) => ({ label: c.shortLabel, value: d.byCategory[c.id] ?? 0, color: c.color }))} />
              </section>

              <section className="rounded-xl border border-line bg-surface p-4">
                <h2 className="mb-2 text-[16px] font-bold text-fg">Chronologie</h2>
                <LineChart points={d.timeline.map((t) => ({ label: t.date.slice(5), value: t.count }))} />
              </section>

              <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface p-4">
                  <h2 className="mb-2 text-[16px] font-bold text-fg">Sous-types les plus fréquents</h2>
                  {d.topSubtypes.length === 0 ? <p className="text-[14px] text-muted">Aucune donnée sur la période.</p> : null}
                  <ol className="flex flex-col gap-1">
                    {d.topSubtypes.map((t, i) => (
                      <li key={t.subtype} className="flex items-center justify-between text-[15px]">
                        <span>
                          {i + 1}. {SUBTYPE_BY_ID[t.subtype]?.label ?? t.subtype}
                        </span>
                        <span className="font-bold">{t.count}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-xl border border-line bg-surface p-4">
                  <h2 className="mb-2 text-[16px] font-bold text-fg">Points d'eau régulièrement secs</h2>
                  {d.recurringWaterIssues.length === 0 ? <p className="text-[14px] text-muted">Aucun point d'eau signalé sec sur la période.</p> : null}
                  <ul className="flex flex-col gap-1">
                    {d.recurringWaterIssues.map((w) => (
                      <li key={w.waterPointId} className="flex items-center justify-between text-[15px]">
                        <span>{w.name}</span>
                        <span className="font-bold">{w.dryCount}×</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              <section className="rounded-xl border border-line bg-surface p-4">
                <h2 className="mb-2 text-[16px] font-bold text-fg">Zones à incidents (carte thermique)</h2>
                <p className="mb-2 text-[13px] text-muted">Cellules d'environ 1 km comptant au moins deux signalements ; jamais de position individuelle.</p>
                <MiniMap center={area ?? CORSICA} zoom={area ? 11 : 8.3} bbox={area?.bbox ?? null} heat={d.hotspots} className="h-72" aria-label="Carte thermique des zones à incidents" />
                {d.hotspots.length === 0 ? <p className="mt-2 text-[14px] text-muted">Aucune zone à incidents sur la période.</p> : null}
              </section>

              <section className="rounded-xl border border-line bg-surface p-4">
                <h2 className="mb-2 text-[16px] font-bold text-fg">Zones de conflits d'usage</h2>
                {d.conflictZones.length === 0 ? <p className="text-[14px] text-muted">Aucune zone où plusieurs usages se superposent sur la période.</p> : null}
                <ul className="flex flex-col gap-1">
                  {d.conflictZones.map((z, i) => (
                    <li key={`${z.lat}-${z.lng}`} className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
                      <span>
                        Zone {i + 1} ({z.lat.toFixed(3)}, {z.lng.toFixed(3)}) — {z.categories.map((c) => CATEGORY_BY_ID[c]?.shortLabel ?? c).join(" + ")}
                      </span>
                      <span className="font-bold">{z.count} signalements</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : dash.isLoading ? (
            <p className="text-muted">{fr.common.loading}</p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
