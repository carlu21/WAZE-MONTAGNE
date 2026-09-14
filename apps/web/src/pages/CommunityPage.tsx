/**
 * Communauté : activité récente, contributeurs les plus fiables, partenaires et
 * sources officielles, conseils de contribution. Pas de messagerie ni de fil social.
 */
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCheck, HandHeart, Plus, ShieldCheck } from "lucide-react";
import { SUBTYPE_BY_ID, fr } from "@mountain-live/core";
import { Avatar, BadgeIcon, CategoryIcon, EmptyState, ListItem, ReliabilityLevel, SkeletonListItem, SourceBadge, TopBar } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useUiStore } from "@/store/ui";

export default function CommunityPage() {
  const navigate = useNavigate();
  const online = useUiStore((s) => s.online);
  const query = useQuery({ queryKey: qk.community, queryFn: api.community.activity, refetchInterval: 120_000, enabled: online });
  const data = query.data;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar variant="solid" title={fr.communityPage.title} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-10 pt-3">
          <section className="rounded-xl bg-primary-soft p-4 text-primary-soft-fg">
            <h2 className="text-[16px] font-bold">Comment contribuer</h2>
            <ul className="mt-2 flex flex-col gap-2 text-[15px]">
              <li className="flex items-start gap-2"><Plus className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> Signalez ce que vous rencontrez en moins de 20 secondes avec le bouton « + ».</li>
              <li className="flex items-start gap-2"><CheckCheck className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> Confirmez ou infirmez les signalements que vous croisez : la fiabilité augmente.</li>
              <li className="flex items-start gap-2"><HandHeart className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> Marquez « Plus présent » quand la situation est réglée.</li>
            </ul>
            <p className="mt-2 text-[13px] opacity-80">Mountain Live n'est pas un réseau social : pas de messagerie, pas de fil personnel. Seule l'information de terrain compte.</p>
          </section>

          <section>
            <h2 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">{fr.communityPage.activity}</h2>
            {!online && !data ? (
              <EmptyState compact title={fr.offline.mode} description="L'activité communautaire nécessite une connexion." />
            ) : query.isLoading ? (
              <div className="flex flex-col gap-2"><SkeletonListItem /><SkeletonListItem /></div>
            ) : !data?.reports.length ? (
              <p className="text-[14px] text-muted">{fr.communityPage.empty}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line bg-surface">
                {data.reports.map((r, i) => (
                  <ListItem
                    key={r.id}
                    icon={<CategoryIcon subtype={r.subtype} />}
                    title={SUBTYPE_BY_ID[r.subtype]?.label ?? r.subtype}
                    subtitle={`${r.authorPseudo ?? "Anonyme"}${r.zone ? ` · ${r.zone}` : ""} · ${new Date(r.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`}
                    trailing={r.source !== "community" ? <SourceBadge source={r.source} /> : undefined}
                    onClick={() => navigate(`/reports/${r.id}`)}
                    chevron
                    divider={i < data.reports.length - 1}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">{fr.communityPage.topContributors}</h2>
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {(data?.topContributors ?? []).map((u, i) => (
                <div key={u.id} className={`flex items-center gap-3 px-3 py-2 ${i < (data?.topContributors.length ?? 0) - 1 ? "border-b border-line" : ""}`}>
                  <span className="w-5 text-center text-[14px] font-bold text-muted">{i + 1}</span>
                  <Avatar name={u.pseudo} src={u.avatarUrl ?? undefined} size={40} role={u.role} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-fg">{u.pseudo}</p>
                    <p className="text-[12px] text-muted">
                      {u.reportsCount} signalements · {u.confirmationsCount} confirmations
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {u.badges.slice(0, 3).map((b) => (
                      <BadgeIcon key={b} id={b} earned size="sm" />
                    ))}
                    <ReliabilityLevel level={u.reliabilityLevel} size="sm" />
                  </div>
                </div>
              ))}
              {data && data.topContributors.length === 0 ? <p className="p-3 text-[14px] text-muted">{fr.communityPage.empty}</p> : null}
            </div>
          </section>

          <section>
            <h2 className="mb-1 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-muted">
              <ShieldCheck className="size-4" aria-hidden="true" /> {fr.communityPage.partners} et sources officielles
            </h2>
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {(data?.partners ?? []).map((u, i) => (
                <ListItem key={u.id} icon={<Avatar name={u.pseudo} src={u.avatarUrl ?? undefined} size={40} role={u.role} />} title={u.pseudo} subtitle={u.region ?? undefined} trailing={<SourceBadge source={u.role === "official" ? "official" : "partner"} />} divider={i < (data?.partners.length ?? 0) - 1} />
              ))}
              {data && data.partners.length === 0 ? <p className="p-3 text-[14px] text-muted">Aucun partenaire pour l'instant.</p> : null}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
