/**
 * Paramètres (section 28) : compte, thème, données locales, confidentialité,
 * suppression du compte (double confirmation), version.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Database, FileText, Trash2, UserX } from "lucide-react";
import { fr } from "@mountain-live/core";
import { Button, IconButton, ListItem, Modal, Segmented, TopBar, toast } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { useMe } from "@/features/account/useMe";
import { isPresenceSharingEnabled, setPresenceSharing } from "@/features/alerts/presence";

export const APP_VERSION = "0.1.0 (MVP pilote Corse)";

async function clearLocalData(): Promise<void> {
  await Promise.all([db.reports.clear(), db.zones.clear(), db.outbox.clear()]);
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  try {
    localStorage.removeItem("ml.recentSearches");
  } catch {
    /* ignore */
  }
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useMe();
  const logout = useSessionStore((s) => s.logout);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [presence, setPresence] = useState(() => isPresenceSharingEnabled());

  const clear = useMutation({
    mutationFn: clearLocalData,
    onSuccess: () => {
      queryClient.clear();
      toast.success("Données locales effacées.");
    },
    onError: () => toast.warning(fr.errors.generic),
  });

  const remove = useMutation({
    mutationFn: () => api.users.deleteMe(),
    onSuccess: async () => {
      await clearLocalData().catch(() => undefined);
      navigate("/map", { replace: true });
      window.setTimeout(() => {
        logout();
        queryClient.clear();
      }, 0);
      toast.success(fr.profilePage.deleted);
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : fr.errors.network),
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        variant="solid"
        title={fr.profilePage.settings}
        leading={
          <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => navigate(-1)}>
            <ChevronLeft />
          </IconButton>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-10 pt-4">
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="text-[16px] font-bold text-fg">Compte</h2>
            <p className="mt-1 text-[15px] text-fg">{user?.email}</p>
            <p className="text-[13px] text-muted">Votre e-mail n'est jamais affiché aux autres utilisateurs.</p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[16px] font-bold text-fg">{fr.profilePage.theme}</h2>
            <Segmented
              aria-label={fr.profilePage.theme}
              value={theme}
              onChange={(v) => setTheme(v as typeof theme)}
              options={[
                { value: "light", label: fr.profilePage.themeLight },
                { value: "dark", label: fr.profilePage.themeDark },
                { value: "system", label: fr.profilePage.themeSystem },
              ]}
            />
          </section>

          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <ListItem
              icon={<Database />}
              title="Partager ma présence de façon anonyme"
              subtitle={presence ? "Activé : seule une cellule d'environ 1 km, conservée 30 min, est transmise." : "Désactivé : aucune information de présence n'est envoyée."}
              onClick={() => {
                const next = !presence;
                setPresenceSharing(next);
                setPresence(next);
              }}
              trailing={<span className="text-[14px] font-semibold text-primary">{presence ? "Désactiver" : "Activer"}</span>}
              divider
            />
            <ListItem icon={<Trash2 />} title="Effacer les données locales" subtitle="Cache des signalements, zones hors connexion, tuiles et actions en attente" onClick={() => clear.mutate()} divider />
            <ListItem icon={<FileText />} title={`${fr.profilePage.privacy} et ${fr.safetyNotice.title.toLowerCase()}`} to="/legal" chevron />
          </section>

          <section className="rounded-xl border border-line bg-surface p-4 text-[14px] text-muted">
            <p className="font-semibold text-fg">Vos données de position</p>
            <p className="mt-1">Elles ne sont jamais stockées individuellement. Seule une estimation agrégée de la fréquentation (cellule d'environ 1 km) est conservée 30 minutes. Aucun historique de déplacement n'est enregistré.</p>
          </section>

          <section className="flex flex-col gap-2">
            <Button variant="danger" size="lg" leftIcon={<UserX />} onClick={() => setDeleteStep(1)}>
              {fr.profilePage.deleteAccount}
            </Button>
            <p className="text-center text-[12px] text-muted">
              {fr.appName} · version {APP_VERSION}
            </p>
          </section>
        </div>
      </main>

      <Modal
        open={deleteStep > 0}
        onClose={() => setDeleteStep(0)}
        tone="danger"
        title={fr.profilePage.deleteAccount}
        description={deleteStep === 1 ? fr.profilePage.deleteAccountConfirm : "Dernière confirmation : cette action est irréversible."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteStep(0)}>
              {fr.common.cancel}
            </Button>
            {deleteStep === 1 ? (
              <Button variant="danger" onClick={() => setDeleteStep(2)}>
                {fr.common.continue}
              </Button>
            ) : (
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                Supprimer définitivement
              </Button>
            )}
          </>
        }
      />
    </div>
  );
}
