/**
 * Préférences (sections 11, 12, 23) : filtres par défaut, fond de carte, thème,
 * alertes de proximité, notifications par type, rayon « Autour de moi ».
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, Save } from "lucide-react";
import { CATEGORIES, fr, formatDistance, type Basemap, type NotificationType, type PreferencesInput, type ReportCategory } from "@mountain-live/core";
import { Button, Chip, IconButton, Segmented, Slider, Toggle, TopBar } from "@/components/ui";
import { useMe, useUpdatePreferences } from "@/features/account/useMe";
import { filtersForPractices } from "@/features/account/practices";
import { NOTIFICATION_TYPES } from "@/features/notifications/icons";

const BASEMAPS: Basemap[] = ["topo", "satellite", "classic", "relief"];

export default function PreferencesPage() {
  const navigate = useNavigate();
  const { user } = useMe();
  const update = useUpdatePreferences();
  const [prefs, setPrefs] = useState<PreferencesInput | null>(null);

  useEffect(() => {
    if (user && !prefs) setPrefs(structuredClone(user.preferences));
  }, [user, prefs]);

  if (!user || !prefs) return null;

  const set = <K extends keyof PreferencesInput>(k: K, v: PreferencesInput[K]) => setPrefs({ ...prefs, [k]: v });
  const toggleFilter = (c: ReportCategory) => set("filters", prefs.filters.includes(c) ? prefs.filters.filter((x) => x !== c) : [...prefs.filters, c]);
  const toggleAlertCat = (c: ReportCategory) =>
    set("alerts", { ...prefs.alerts, categories: prefs.alerts.categories.includes(c) ? prefs.alerts.categories.filter((x) => x !== c) : [...prefs.alerts.categories, c] });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        variant="solid"
        title={fr.profilePage.preferences}
        leading={
          <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => navigate(-1)}>
            <ChevronLeft />
          </IconButton>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-28 pt-4">
          <section className="flex flex-col gap-3">
            <h2 className="text-[16px] font-bold text-fg">{fr.filters.title}</h2>
            <p className="text-[14px] text-muted">Catégories affichées par défaut sur la carte. Aucune sélection = tout afficher.</p>
            <div className="flex flex-wrap gap-2">
              <Chip selected={prefs.filters.length === 0} onClick={() => set("filters", [])}>
                {fr.filters.all}
              </Chip>
              {CATEGORIES.map((c) => (
                <Chip key={c.id} category={c.id} selected={prefs.filters.includes(c.id)} onClick={() => toggleFilter(c.id)}>
                  {c.shortLabel}
                </Chip>
              ))}
            </div>
            <Toggle checked={prefs.showOfficialOnly} onChange={(v) => set("showOfficialOnly", v)} label={fr.filters.official} description="N'afficher que les sources officielles" />
            <Button variant="outline" size="md" onClick={() => set("filters", filtersForPractices(user.practices))} disabled={user.practices.length === 0}>
              {fr.filters.byPractice}
            </Button>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[16px] font-bold text-fg">{fr.profilePage.basemap}</h2>
            <Segmented aria-label={fr.profilePage.basemap} value={prefs.basemap} onChange={(v) => set("basemap", v as Basemap)} options={BASEMAPS.map((b) => ({ value: b, label: fr.profilePage.basemaps[b] }))} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[16px] font-bold text-fg">{fr.profilePage.theme}</h2>
            <Segmented
              aria-label={fr.profilePage.theme}
              value={prefs.theme}
              onChange={(v) => set("theme", v as PreferencesInput["theme"])}
              options={[
                { value: "light", label: fr.profilePage.themeLight },
                { value: "dark", label: fr.profilePage.themeDark },
                { value: "system", label: fr.profilePage.themeSystem },
              ]}
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[16px] font-bold text-fg">{fr.notifications.proximity.title}</h2>
            <Toggle checked={prefs.alerts.enabled} onChange={(v) => set("alerts", { ...prefs.alerts, enabled: v })} label={fr.notifications.proximity.enabled} description="Alerte sonore et visuelle à l'approche d'un signalement" />
            <Slider label={fr.notifications.proximity.radius} min={200} max={2000} step={100} value={prefs.alerts.radiusM} onChange={(v) => set("alerts", { ...prefs.alerts, radiusM: v })} formatValue={formatDistance} />
            <p className="text-[14px] font-semibold text-fg">{fr.notifications.proximity.categories}</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <Chip key={c.id} category={c.id} selected={prefs.alerts.categories.includes(c.id)} onClick={() => toggleAlertCat(c.id)}>
                  {c.shortLabel}
                </Chip>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-[16px] font-bold text-fg">{fr.notifications.preferences}</h2>
            <p className="text-[14px] text-muted">{fr.notifications.preferencesHint}</p>
            {NOTIFICATION_TYPES.map((t: NotificationType) => (
              <Toggle key={t} checked={prefs.notifications[t] ?? true} onChange={(v) => set("notifications", { ...prefs.notifications, [t]: v })} label={fr.notifications.types[t]} />
            ))}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-[16px] font-bold text-fg">{fr.profilePage.aroundRadius}</h2>
            <Slider label={fr.around.radius} min={500} max={10000} step={500} value={prefs.aroundRadiusM} onChange={(v) => set("aroundRadiusM", v)} formatValue={formatDistance} />
          </section>
        </div>
      </main>
      <footer className="glass-strong shrink-0 border-t border-line px-4 pt-3" style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}>
        <div className="mx-auto w-full max-w-2xl">
          <Button size="xl" fullWidth leftIcon={<Save />} loading={update.isPending} onClick={() => update.mutate(prefs)}>
            {fr.common.save}
          </Button>
        </div>
      </footer>
    </div>
  );
}
