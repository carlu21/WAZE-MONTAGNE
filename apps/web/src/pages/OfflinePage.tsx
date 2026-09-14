/**
 * Téléchargement hors connexion (section 9) : « Télécharger cette zone »
 * (carte, sentiers, points d'eau, refuges, signalements récents), estimation,
 * progression, annulation, zones téléchargées (voir, mettre à jour, supprimer).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Download, MapPin, RefreshCw, Trash2, X } from "lucide-react";
import { fr, type BBox } from "@mountain-live/core";
import { Banner, Button, EmptyState, Field, IconButton, Input, RelativeTime, TopBar, toast } from "@/components/ui";
import { qk } from "@/lib/queryKeys";
import { useUiStore } from "@/store/ui";
import { ZonePicker } from "@/features/offline/ZonePicker";
import { MAX_TILES, countTiles, estimateBytes, formatBytes } from "@/features/offline/tiles";
import { ZoneTooLargeError, defaultZoneName, deleteZone, downloadZone, listZones, parseBBoxParam, type DownloadProgress } from "@/features/offline/zones";
import { useNetworkStatus } from "@/features/offline/network";

export default function OfflinePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const online = useNetworkStatus();
  const view = useUiStore((s) => s.view);
  const setView = useUiStore((s) => s.setView);
  const initialBBox = useMemo(() => parseBBoxParam(params.get("bbox")), [params]);
  const [bbox, setBBox] = useState<BBox | null>(initialBBox);
  const [name, setName] = useState(() => params.get("name") ?? defaultZoneName());
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const zones = useQuery({ queryKey: qk.offlineZones, queryFn: listZones });

  const tiles = bbox ? countTiles(bbox) : 0;
  const tooLarge = tiles > MAX_TILES;

  const download = useMutation({
    mutationFn: async (input: { id?: string; name: string; bbox: BBox }) => {
      abortRef.current = new AbortController();
      return downloadZone(input, setProgress, abortRef.current.signal);
    },
    onSuccess: (zone) => {
      void queryClient.invalidateQueries({ queryKey: qk.offlineZones });
      toast.success({ title: fr.offline.downloaded, description: `${zone.tileCount.toLocaleString("fr-FR")} tuiles · ${formatBytes(zone.bytesEstimate)} · ${zone.reports.length} signalements` });
    },
    onError: (e) => {
      if (e instanceof ZoneTooLargeError) toast.warning(fr.offline.areaTooLarge);
      else if (e instanceof DOMException && e.name === "AbortError") toast.info("Téléchargement annulé.");
      else toast.danger(fr.errors.network);
    },
    onSettled: () => {
      setProgress(null);
      abortRef.current = null;
    },
  });

  const remove = useMutation({
    mutationFn: deleteZone,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.offlineZones });
      toast.success("Zone supprimée.");
    },
  });

  useEffect(() => () => abortRef.current?.abort(), []);

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        variant="solid"
        title={fr.offline.zonesTitle}
        leading={
          <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => navigate(-1)}>
            <ChevronLeft />
          </IconButton>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-10 pt-3">
          <p className="text-[15px] text-fg">{fr.offline.zoneHint}</p>
          {!online ? <Banner tone="warning" compact title={fr.offline.mode}>Le téléchargement nécessite une connexion.</Banner> : null}

          <ZonePicker initial={initialBBox ?? view} onChange={setBBox} />

          <div className="rounded-xl border border-line bg-surface p-4">
            <Field label="Nom de la zone">
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
            <p className="mt-3 text-[14px] text-muted" aria-live="polite">
              {bbox ? (
                tooLarge ? (
                  <span className="font-semibold text-danger">{fr.offline.areaTooLarge}</span>
                ) : (
                  <>
                    Environ <span className="font-semibold text-fg">{tiles.toLocaleString("fr-FR")} tuiles</span> (zooms 10 à 15) · <span className="font-semibold text-fg">{formatBytes(estimateBytes(tiles))}</span>
                  </>
                )
              ) : (
                "Cadrez la zone sur la carte."
              )}
            </p>
            <p className="mt-1 text-[13px] text-muted">Topographie, sentiers, points d'eau, refuges et signalements récents seront disponibles sans réseau.</p>

            {progress ? (
              <div className="mt-3">
                <div className="flex items-center justify-between text-[13px] text-muted">
                  <span>{progress.phase === "data" ? "Données du secteur…" : `${fr.offline.downloading} ${pct} %`}</span>
                  {progress.failed ? <span>{progress.failed} tuiles ignorées</span> : null}
                </div>
                <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
                </div>
                <Button className="mt-3" size="md" variant="outline" leftIcon={<X />} onClick={() => abortRef.current?.abort()}>
                  {fr.common.cancel}
                </Button>
              </div>
            ) : (
              <Button className="mt-3" size="xl" fullWidth leftIcon={<Download />} disabled={!bbox || tooLarge || !online} onClick={() => bbox && download.mutate({ name: name.trim() || defaultZoneName(), bbox })}>
                {fr.offline.download}
              </Button>
            )}
          </div>

          <section>
            <h2 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">{fr.offline.zonesTitle}</h2>
            {zones.data?.length ? (
              <ul className="flex flex-col gap-2">
                {zones.data.map((z) => (
                  <li key={z.id} className="rounded-xl border border-line bg-surface p-3">
                    <p className="text-[16px] font-bold text-fg">{z.name}</p>
                    <p className="text-[13px] text-muted">
                      <RelativeTime date={z.downloadedAt} prefix="Téléchargée" /> · {z.tileCount.toLocaleString("fr-FR")} tuiles · {formatBytes(z.bytesEstimate)} · {z.reports.length} signalements · {z.waterPoints.length} points d'eau
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="md"
                        variant="secondary"
                        leftIcon={<MapPin />}
                        onClick={() => {
                          setView({ lat: (z.bbox.south + z.bbox.north) / 2, lng: (z.bbox.west + z.bbox.east) / 2, zoom: 12 });
                          navigate("/map");
                        }}
                      >
                        {fr.common.seeOnMap}
                      </Button>
                      <Button size="md" variant="outline" leftIcon={<RefreshCw />} disabled={!online || download.isPending} onClick={() => download.mutate({ id: z.id, name: z.name, bbox: z.bbox })}>
                        {fr.offline.updateZone}
                      </Button>
                      <Button size="md" variant="ghost" leftIcon={<Trash2 />} loading={remove.isPending} onClick={() => remove.mutate(z.id)}>
                        {fr.common.delete}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon={<Download />} title={fr.offline.noZones} />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
