/**
 * Profil utilisateur (section 15) : photo, pseudo, pratiques, région, compteurs,
 * fiabilité (niveau 1–5, jamais de score négatif), badges, accès aux réglages.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { Bell, Download, LogOut, Pencil, Settings, ShieldCheck, SlidersHorizontal, LayoutDashboard, Users } from "lucide-react";
import { BADGES, PRACTICES, fr, type BadgeId, type Practice } from "@mountain-live/core";
import { Avatar, BadgeIcon, Button, CategoryIcon, Chip, Field, Input, ListItem, Modal, ReliabilityLevel, Stat, TopBar } from "@/components/ui";
import { useSessionStore } from "@/store/session";
import { formatDate } from "@/lib/format";
import { useMe, useUpdateMe } from "@/features/account/useMe";
import { savePractices } from "@/features/account/practices";

const BADGE_IDS = Object.keys(BADGES) as BadgeId[];

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user } = useMe();
  const logout = useSessionStore((s) => s.logout);
  const update = useUpdateMe();
  const [editOpen, setEditOpen] = useState(false);
  const [pseudo, setPseudo] = useState("");
  const [region, setRegion] = useState("");
  const [practices, setPractices] = useState<Practice[]>([]);

  if (!user) return null;

  const openEdit = () => {
    setPseudo(user.pseudo);
    setRegion(user.region ?? "");
    setPractices(user.practices);
    setEditOpen(true);
  };
  const saveEdit = () => {
    update.mutate(
      { pseudo: pseudo.trim(), region: region.trim() || null, practices },
      {
        onSuccess: () => {
          savePractices(practices);
          setEditOpen(false);
        },
      },
    );
  };
  const isModerator = user.role === "moderator" || user.role === "admin";
  const isPro = user.role === "official" || user.role === "partner" || user.role === "admin";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        variant="solid"
        title={fr.profilePage.title}
        actions={
          <Button size="md" variant="ghost" leftIcon={<Pencil />} onClick={openEdit}>
            {fr.common.edit}
          </Button>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-10 pt-4">
          <section className="flex items-center gap-4">
            <Avatar name={user.pseudo} src={user.avatarUrl ?? undefined} size={64} role={user.role} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[22px] font-extrabold text-fg">{user.pseudo}</h1>
              <p className="text-[14px] text-muted">
                {user.region ? `${user.region} · ` : ""}
                {fr.profilePage.memberSince.replace("{date}", formatDate(user.createdAt, "long"))}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {user.practices.length ? (
                  user.practices.map((p) => {
                    const def = PRACTICES.find((x) => x.id === p);
                    return (
                      <span key={p} className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-primary-soft-fg">
                        {def ? <CategoryIcon name={def.icon} className="size-3.5" /> : null}
                        {def?.label ?? p}
                      </span>
                    );
                  })
                ) : (
                  <span className="text-[13px] text-muted">Aucune pratique renseignée</span>
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-3 gap-2">
            <Stat value={user.reportsCount} label={fr.profilePage.reports} />
            <Stat value={user.confirmationsCount} label={fr.profilePage.confirmations} />
            <div className="flex flex-col items-center justify-center rounded-xl bg-surface p-3 shadow-sm">
              <ReliabilityLevel level={user.reliabilityLevel} size="md" />
              <span className="mt-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{fr.profilePage.reliability}</span>
            </div>
          </section>
          <p className="-mt-3 text-[13px] text-muted">
            {fr.profilePage.level.replace("{level}", `${user.reliabilityLevel}/5`)} — {fr.profilePage.levelHint}
          </p>

          <section>
            <h2 className="mb-2 text-[16px] font-bold text-fg">{fr.profilePage.badges}</h2>
            {user.badges.length === 0 ? <p className="mb-2 text-[14px] text-muted">{fr.profilePage.noBadges}</p> : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {BADGE_IDS.map((id) => (
                <div key={id} className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2">
                  <BadgeIcon id={id} earned={user.badges.includes(id)} size="md" />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-fg">{BADGES[id].label}</p>
                    <p className="truncate text-[12px] text-muted">{BADGES[id].description}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <nav aria-label="Réglages" className="overflow-hidden rounded-xl border border-line bg-surface">
            <ListItem icon={<SlidersHorizontal />} title={fr.profilePage.preferences} subtitle="Filtres, fond de carte, thème, alertes, notifications" to="/profile/preferences" chevron divider />
            <ListItem icon={<Bell />} title={fr.notifications.title} to="/notifications" chevron divider />
            <ListItem icon={<Users />} title={fr.nav.community} to="/community" chevron divider />
            <ListItem icon={<Download />} title={fr.offline.zonesTitle} subtitle={fr.offline.download} to="/offline" chevron divider />
            <ListItem icon={<Settings />} title={fr.profilePage.settings} subtitle="Compte, confidentialité, données" to="/profile/settings" chevron divider={isModerator || isPro} />
            {isModerator ? <ListItem icon={<ShieldCheck />} title="Back-office de modération" to="/admin" chevron divider={isPro} /> : null}
            {isPro ? <ListItem icon={<LayoutDashboard />} title="Tableau de bord professionnel" to="/pro" chevron /> : null}
          </nav>

          <Button
            variant="outline"
            size="lg"
            leftIcon={<LogOut />}
            onClick={() => {
              // Quitter d'abord la page protégée, puis fermer la session (évite la redirection vers la connexion).
              navigate("/map", { replace: true });
              window.setTimeout(logout, 0);
            }}
          >
            {fr.auth.logout}
          </Button>
        </div>
      </main>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={fr.profilePage.edit}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              {fr.common.cancel}
            </Button>
            <Button loading={update.isPending} onClick={saveEdit} disabled={pseudo.trim().length < 2}>
              {fr.common.save}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label={fr.auth.pseudo} required>
            <Input value={pseudo} maxLength={32} onChange={(e) => setPseudo(e.target.value)} />
          </Field>
          <Field label={fr.profilePage.region} optional>
            <Input value={region} maxLength={80} onChange={(e) => setRegion(e.target.value)} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-[15px] font-semibold text-fg">{fr.profilePage.practices}</legend>
            <div className="flex flex-wrap gap-2">
              {PRACTICES.map((p) => (
                <Chip key={p.id} selected={practices.includes(p.id)} icon={<CategoryIcon name={p.icon} />} onClick={() => setPractices((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}>
                  {p.label}
                </Chip>
              ))}
            </div>
          </fieldset>
        </div>
      </Modal>
    </div>
  );
}
