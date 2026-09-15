/**
 * L'UNIQUE indicateur d'état GPS de l'application.
 *
 * Il existe parce qu'il y en avait trois : le bandeau d'instruction disait
 * « Recherche du signal GPS… », la puce d'état le redisait, et un troisième
 * encart le redisait encore. Trois fois la même information, empilées, au
 * moment précis où l'écran doit être lisible.
 *
 * Un seul composant, trois états, et il DISPARAÎT quand le signal est bon :
 *
 *   acquisition  → « ● Acquisition GPS… »   (puce qui bat, seule information)
 *   approximatif → « GPS ± 42 m »           (discret, sans dramatiser)
 *   fiable       → « GPS ± 6 m »            (discret, ou rien si `compact`)
 *
 * On n'écrit jamais une précision qu'on ne connaît pas, et on ne laisse jamais
 * croire à une certitude : la valeur affichée est celle que le récepteur donne.
 */
import { fr, type PositionTrust } from "@mountain-live/core";
import { cn } from "@/components/ui/cn";
import { accuracyLabel } from "./format";

export interface GpsStatusProps {
  trust: PositionTrust;
  accuracy: number | null;
  /** Masque complètement l'indicateur quand la position est fiable. */
  hideWhenReliable?: boolean;
  className?: string;
}

const DOT: Record<PositionTrust, string> = {
  unavailable: "bg-muted",
  acquiring: "bg-warning",
  coarse: "bg-warning",
  reliable: "bg-success",
};

export function GpsStatus({ trust, accuracy, hideWhenReliable = false, className }: GpsStatusProps) {
  if (trust === "reliable" && hideWhenReliable) return null;
  const acquiring = trust === "unavailable" || trust === "acquiring";
  return (
    <span
      className={cn("glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-fg", className)}
      role="status"
      aria-live="polite"
      data-testid="gps-status"
      data-trust={trust}
    >
      <span className={cn("size-2 rounded-full", DOT[trust], acquiring && "animate-pulse")} aria-hidden="true" />
      {acquiring ? fr.navigation.gpsAcquiring : accuracyLabel(accuracy)}
    </span>
  );
}

/**
 * Message d'attente plein format, montré UNIQUEMENT quand aucune position n'est
 * encore disponible. Pas de faux mouvement, pas de cap fictif : on attend, et on
 * le dit.
 */
export function GpsWaiting({ trust }: { trust: PositionTrust }) {
  if (trust !== "unavailable") return null;
  return (
    <div className="glass pointer-events-auto w-full max-w-xl rounded-xl px-4 py-2 text-[13px] text-fg" role="status" data-testid="gps-waiting">
      <span className="font-semibold">{fr.navigation.gpsAcquiring}</span> {fr.navigation.gpsAcquiringBody}
    </div>
  );
}
