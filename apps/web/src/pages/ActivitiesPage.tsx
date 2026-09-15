/**
 * Mes activités (sections 35 et 49 du moteur cartographique).
 *
 * Tout part de l'appareil : la liste est celle des traces enregistrées
 * localement. Pour chacune, l'utilisateur voit si elle contribue au réseau,
 * peut retirer sa contribution, l'exporter ou la supprimer — et supprimer tout
 * son historique d'un coup. Ce qui est supprimé ici disparaît aussi des
 * statistiques collectives.
 */
import { useCallback, useEffect, useState } from "react";
import { Download, MapPinned, Share2, Trash2, Upload } from "lucide-react";
import { formatDistance, formatDurationShort, fr, type ActivityMode } from "@mountain-live/core";
import { Badge, Button, Card, EmptyState, IconButton, ListItem, Modal, RelativeTime, Toggle, TopBar, toast } from "@/components/ui";
import { db, type SavedTrack } from "@/lib/db";
import { groupActivitiesByDay } from "@/features/navigation/activityGroups";
import { useIsAuthenticated } from "@/store/session";
import { useMe, useUpdatePreferences } from "@/features/account/useMe";
import { deleteActivity, deleteAllActivities, setContribution, syncPendingActivities } from "@/features/navigation/activities";
import { shareOrDownloadGpx } from "@/features/navigation/tracks";
import { CURRENT_TRACK_ID } from "@/features/navigation/tracks";

export default function ActivitiesPage() {
  const authenticated = useIsAuthenticated();
  const { user } = useMe();
  const updatePreferences = useUpdatePreferences();
  const [tracks, setTracks] = useState<SavedTrack[] | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await db.tracks.orderBy("savedAt").reverse().toArray();
      setTracks(all.filter((t) => t.id !== CURRENT_TRACK_ID));
    } catch {
      setTracks([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onToggleContribution = async (track: SavedTrack, next: boolean) => {
    setBusy(track.id);
    try {
      await setContribution(track, next);
      toast.success(next ? fr.network.contribute.contributed : fr.network.contribute.withdrawn);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (track: SavedTrack) => {
    setBusy(track.id);
    try {
      await deleteActivity(track);
      toast.success(fr.network.activities.deleted);
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const pending = (tracks ?? []).filter((t) => !t.remoteId && (t.raw?.length ?? 0) >= 2).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        variant="solid"
        title={fr.network.activities.title}
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-10 pt-3">
          {user ? (
            <Card padding="md">
              <Toggle
                checked={user.preferences.contributeTraces}
                onChange={(v) => updatePreferences.mutate({ ...user.preferences, contributeTraces: v })}
                label={fr.network.contribute.always}
                description={fr.network.contribute.hint}
              />
            </Card>
          ) : null}

          {authenticated && pending > 0 ? (
            <Button
              variant="secondary"
              leftIcon={<Upload />}
              onClick={async () => {
                const sent = await syncPendingActivities();
                toast.success(sent > 0 ? `${sent} activité${sent > 1 ? "s" : ""} envoyée${sent > 1 ? "s" : ""}.` : "Rien à envoyer pour l'instant.");
                await reload();
              }}
            >
              Envoyer {pending} activité{pending > 1 ? "s" : ""} en attente
            </Button>
          ) : null}

          <ListItem icon={<MapPinned />} title={fr.network.privacy.title} subtitle={fr.network.privacy.hint} to="/profile/privacy-zones" chevron />

          {tracks === null ? null : tracks.length === 0 ? (
            <EmptyState icon={<MapPinned />} title={fr.network.activities.empty} description={fr.network.activities.emptyHint} />
          ) : (
            groupActivitiesByDay(tracks).map((day) => (
              <section key={day.key} className="flex flex-col gap-2" aria-label={day.label}>
                <h2 className="text-[13px] font-bold uppercase tracking-wide text-muted">
                  {day.label} · {day.count} activité{day.count > 1 ? "s" : ""} · {formatDistance(day.distanceM)}
                </h2>
            <ul className="flex flex-col gap-2">
              {day.tracks.map((t) => (
                <li key={t.id}>
                  <Card padding="md" as="article">
                    <header className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-[16px] font-bold text-fg">{t.name}</h3>
                        <p className="text-[13px] text-muted">
                          <RelativeTime date={new Date(t.savedAt).toISOString()} /> · {fr.navigation.activities[t.activity as ActivityMode]}
                        </p>
                      </div>
                      <Badge tone={t.contributed ? "success" : "neutral"}>
                        {t.contributed ? fr.network.activities.status.contributed : fr.network.activities.status.private}
                      </Badge>
                    </header>
                    <p className="tabular mt-1 text-[15px] text-fg">
                      {formatDistance(t.stats.distanceM)} · {formatDurationShort(t.stats.durationMs)} · +{t.stats.gainM} m
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {authenticated && (t.raw?.length ?? 0) >= 2 ? (
                        <Button
                          variant="ghost"
                          size="md"
                          leftIcon={<Share2 />}
                          loading={busy === t.id}
                          onClick={() => void onToggleContribution(t, !t.contributed)}
                          data-testid={`activity-contribute-${t.id}`}
                        >
                          {t.contributed ? fr.network.contribute.withdraw : fr.network.contribute.short}
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="md" leftIcon={<Download />} onClick={() => void shareOrDownloadGpx(t.name, t.points)}>
                        {fr.navigation.exportGpx}
                      </Button>
                      <IconButton aria-label={fr.network.activities.delete} variant="ghost" onClick={() => void onDelete(t)} loading={busy === t.id}>
                        <Trash2 className="text-danger" />
                      </IconButton>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
              </section>
            ))
          )}

          {(tracks?.length ?? 0) > 0 ? (
            <Button variant="ghost" onClick={() => setConfirmAll(true)} className="self-start text-danger">
              {fr.network.activities.deleteAll}
            </Button>
          ) : null}
        </div>
      </main>

      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={fr.network.activities.deleteAll}
        description={fr.network.activities.deleteBody}
        tone="danger"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmAll(false)}>
              {fr.common.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const n = await deleteAllActivities();
                setConfirmAll(false);
                toast.success(`${n} activité${n > 1 ? "s" : ""} supprimée${n > 1 ? "s" : ""}.`);
                await reload();
              }}
            >
              {fr.common.delete}
            </Button>
          </>
        }
      />
    </div>
  );
}
