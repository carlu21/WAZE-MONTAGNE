/**
 * Résumé de fin d'activité (section 17) : distance, temps, dénivelés,
 * altitude maximale, vitesse moyenne ; enregistrement local et export GPX.
 */
import { useState } from "react";
import { Download, Save } from "lucide-react";
import { formatDistance, formatDurationShort, formatSpeedKmh, fr, trackStats, type TrackPoint } from "@mountain-live/core";
import { Button, Field, Input, Stat, toast } from "@/components/ui";
import { useNavigationStore } from "./store";
import { saveTrack, shareOrDownloadGpx, trackName } from "./tracks";

export interface NavSummaryProps {
  track: TrackPoint[];
  onDone: () => void;
}

export function NavSummary({ track, onDone }: NavSummaryProps) {
  const activity = useNavigationStore((s) => s.activity);
  const session = useNavigationStore((s) => s.session);
  const [name, setName] = useState(() => session?.route?.name ?? trackName(activity, new Date(session?.startedAt ?? Date.now())));
  const [saved, setSaved] = useState(false);
  const stats = trackStats(track);

  const onSave = async () => {
    if (track.length < 2) {
      toast.warning("Trace trop courte pour être enregistrée.");
      return;
    }
    await saveTrack({ name: name.trim() || trackName(activity), activity, points: track });
    setSaved(true);
    toast.success("Trace enregistrée sur cet appareil.");
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-10 pt-3" data-testid="nav-summary">
      <h2 className="text-[22px] font-bold text-fg">{fr.navigation.summaryTitle}</h2>
      <div className="grid grid-cols-2 gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-3">
        <Stat value={formatDistance(stats.distanceM)} label={fr.navigation.stats.distance} tone="primary" />
        <Stat value={formatDurationShort(stats.durationMs)} label={fr.navigation.stats.duration} />
        <Stat value={`+${stats.gainM} m`} label={fr.navigation.stats.gain} />
        <Stat value={`−${stats.lossM} m`} label={fr.navigation.stats.loss} />
        <Stat value={stats.maxAltM !== null ? `${stats.maxAltM} m` : "—"} label={fr.navigation.stats.maxAltitude} />
        <Stat value={formatSpeedKmh(stats.movingSpeedMs || stats.avgSpeedMs)} label={fr.navigation.stats.avgSpeed} />
      </div>
      <Field label="Nom de la trace">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" leftIcon={<Download />} onClick={() => void shareOrDownloadGpx(name.trim() || trackName(activity), track)} disabled={track.length < 2} fullWidth>
          {fr.navigation.exportGpx}
        </Button>
        <Button variant="secondary" leftIcon={<Save />} onClick={() => void onSave()} disabled={saved || track.length < 2} fullWidth>
          {saved ? "Enregistrée" : fr.navigation.saveTrack}
        </Button>
      </div>
      <p className="text-[13px] text-muted">Votre trace reste sur cet appareil : elle n'est jamais envoyée au serveur.</p>
      <Button size="lg" onClick={onDone} fullWidth data-testid="nav-summary-done">
        {fr.common.close}
      </Button>
    </div>
  );
}
