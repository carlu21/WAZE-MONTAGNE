/**
 * Zones privées (section 36 du moteur cartographique) : des endroits dont les
 * traces ne servent jamais aux statistiques collectives.
 *
 * En plus de ces zones, les abords du départ et de l'arrivée de chaque activité
 * sont systématiquement écartés avant toute exploitation : le domicile ne se
 * déduit pas d'un faisceau de traces qui commencent toutes au même endroit.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, MapPin, Plus, Trash2 } from "lucide-react";
import { formatDistance, fr } from "@mountain-live/core";
import { Banner, Button, EmptyState, Field, IconButton, Input, ListItem, Slider, TopBar, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { useUiStore } from "@/store/ui";

export default function PrivacyZonesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const position = useUiStore((s) => s.position);
  const view = useUiStore((s) => s.view);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [radius, setRadius] = useState(250);

  const zones = useQuery({ queryKey: qk.privacyZones, queryFn: api.privacyZones.list, staleTime: 60_000 });
  const create = useMutation({
    mutationFn: () =>
      api.privacyZones.create({
        label: label.trim() || null,
        lat: position?.lat ?? view.lat,
        lng: position?.lng ?? view.lng,
        radiusM: radius,
      }),
    onSuccess: () => {
      setAdding(false);
      setLabel("");
      toast.success("Zone privée ajoutée.");
      void queryClient.invalidateQueries({ queryKey: qk.privacyZones });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.privacyZones.remove(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.privacyZones }),
  });

  const list = zones.data?.zones ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        variant="solid"
        title={fr.network.privacy.title}
        leading={
          <IconButton aria-label={fr.common.back} variant="ghost" onClick={() => navigate("/profile/activities")}>
            <ChevronLeft />
          </IconButton>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-10 pt-3" data-testid="privacy-zones">
          <Banner tone="info">{fr.network.privacy.hint}</Banner>

          {list.length === 0 && !adding ? (
            <EmptyState compact icon={<MapPin />} title={fr.network.privacy.empty} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {list.map((z, i) => (
                <ListItem
                  key={z.id}
                  icon={<MapPin />}
                  title={z.label || "Zone privée"}
                  subtitle={`${z.lat.toFixed(4)}, ${z.lng.toFixed(4)} · rayon ${formatDistance(z.radiusM)}`}
                  divider={i < list.length - 1}
                  trailing={
                    <IconButton aria-label={fr.network.privacy.remove} variant="ghost" onClick={() => remove.mutate(z.id)}>
                      <Trash2 className="text-danger" />
                    </IconButton>
                  }
                />
              ))}
            </div>
          )}

          {adding ? (
            <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3">
              <Field label={fr.network.privacy.label}>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Maison, bergerie…" />
              </Field>
              <Slider label={fr.network.privacy.radius} min={100} max={1000} step={50} value={radius} onChange={setRadius} formatValue={formatDistance} />
              <p className="text-[13px] text-muted">
                La zone est créée autour de {position ? "votre position actuelle" : "le centre de la carte"} :{" "}
                {(position?.lat ?? view.lat).toFixed(4)}, {(position?.lng ?? view.lng).toFixed(4)}.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  {fr.common.cancel}
                </Button>
                <Button onClick={() => create.mutate()} loading={create.isPending}>
                  {fr.common.save}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" leftIcon={<Plus />} onClick={() => setAdding(true)} className="self-start">
              {fr.network.privacy.add}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
