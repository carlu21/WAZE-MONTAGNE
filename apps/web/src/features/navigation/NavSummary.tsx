/**
 * Résumé de fin d'activité (section 17 de la navigation, sections 35 et 49 du
 * moteur cartographique) : distance, temps, dénivelés, altitude maximale,
 * vitesse moyenne ; enregistrement local, export GPX, et choix explicite de
 * contribuer — ou non — à l'amélioration collective du réseau.
 *
 * Rien n'est envoyé tant que l'utilisateur n'a pas tranché : le bouton
 * « Contribuer » est une action volontaire, jamais une case pré-cochée.
 */
import { useState } from "react";
import { Check, Download, Save, Share2, ShieldCheck } from "lucide-react";
import { formatDistance, formatDurationShort, formatSpeedKmh, fr, trackStats, type RawPoint, type TrackPoint } from "@mountain-live/core";
import { Banner, Button, Card, Field, Input, Stat, toast } from "@/components/ui";
import { useIsAuthenticated } from "@/store/session";
import { useMe } from "@/features/account/useMe";
import { useUiStore } from "@/store/ui";
import { useNavigationStore } from "./store";
import { saveTrack, shareOrDownloadGpx, trackName } from "./tracks";
import { uploadActivity } from "./activities";

export interface NavSummaryProps {
  track: TrackPoint[];
  /** Trace brute : seule elle peut alimenter le réseau collectif. */
  raw: RawPoint[];
  onDone: () => void;
}

export function NavSummary({ track, raw, onDone }: NavSummaryProps) {
  const activity = useNavigationStore((s) => s.activity);
  const session = useNavigationStore((s) => s.session);
  const authenticated = useIsAuthenticated();
  const { user } = useMe();
  const online = useUiStore((s) => s.online);
  const alwaysContribute = user?.preferences.contributeTraces ?? false;

  const [name, setName] = useState(() => session?.route?.name ?? trackName(activity, new Date(session?.startedAt ?? Date.now())));
  const [saved, setSaved] = useState(false);
  const [contribution, setContribution] = useState<boolean | null>(alwaysContribute ? true : null);
  const [busy, setBusy] = useState(false);
  const stats = trackStats(track);
  const canContribute = authenticated && raw.length >= 2;

  const persist = async (contribute: boolean) => {
    if (saved || busy) return;
    setBusy(true);
    try {
      const saveName = name.trim() || trackName(activity);
      const saved = await saveTrack({ name: saveName, activity, points: track, raw, contributed: contribute });
      setSaved(true);
      if (contribute && canContribute) {
        const dto = await uploadActivity(saved, true);
        toast.success(dto ? fr.network.contribute.contributed : "Activité enregistrée : elle sera partagée au retour du réseau.");
      } else {
        toast.success(fr.network.contribute.kept);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-10" style={{ paddingTop: "calc(var(--safe-top) + 12px)" }} data-testid="nav-summary">
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
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} disabled={saved} />
      </Field>

      {/* Contribution : question posée une fois, réponse explicite (section 35). */}
      {canContribute ? (
        <Card tone="soft" padding="md" accentColor="#1F4D28" data-testid="nav-contribute">
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg [&_svg]:size-5" aria-hidden="true">
                <ShieldCheck />
              </span>
              <div className="min-w-0">
                <p className="text-[16px] font-bold text-fg">{fr.network.contribute.ask}</p>
                <p className="mt-1 text-[13px] leading-snug text-muted">{fr.network.contribute.hint}</p>
                <p className="mt-1 text-[13px] leading-snug text-muted">{fr.network.contribute.privacyNote}</p>
              </div>
            </div>
            {saved ? (
              <p className="inline-flex items-center gap-2 text-[14px] font-semibold text-primary">
                <Check className="size-4" aria-hidden="true" />
                {contribution ? fr.network.contribute.contributed : fr.network.contribute.kept}
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  size="lg"
                  fullWidth
                  loading={busy && contribution === true}
                  onClick={() => {
                    setContribution(true);
                    void persist(true);
                  }}
                  data-testid="nav-contribute-yes"
                >
                  {fr.network.contribute.accept}
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  fullWidth
                  loading={busy && contribution === false}
                  onClick={() => {
                    setContribution(false);
                    void persist(false);
                  }}
                  data-testid="nav-contribute-no"
                >
                  {fr.network.contribute.decline}
                </Button>
              </div>
            )}
            {!online ? <p className="text-[13px] text-muted">Hors connexion : l'envoi se fera automatiquement au retour du réseau.</p> : null}
          </div>
        </Card>
      ) : (
        <Banner tone="info" compact>
          {authenticated ? "Trace trop courte pour contribuer au réseau." : "Créez un compte pour contribuer anonymement à l'amélioration des chemins."}
        </Banner>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" leftIcon={<Download />} onClick={() => void shareOrDownloadGpx(name.trim() || trackName(activity), track)} disabled={track.length < 2} fullWidth>
          {fr.navigation.exportGpx}
        </Button>
        {!canContribute || saved ? (
          <Button variant="secondary" leftIcon={saved ? <Check /> : <Save />} onClick={() => void persist(false)} disabled={saved || track.length < 2} loading={busy} fullWidth>
            {saved ? "Enregistrée" : fr.navigation.saveTrack}
          </Button>
        ) : null}
      </div>

      <p className="inline-flex items-start gap-2 text-[13px] text-muted">
        <Share2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Votre trace reste sur cet appareil. Si vous contribuez, seule une version anonymisée, sans les abords du départ et de l'arrivée, alimente les statistiques collectives.
      </p>

      <Button size="lg" onClick={onDone} fullWidth data-testid="nav-summary-done">
        {fr.common.close}
      </Button>
    </div>
  );
}
