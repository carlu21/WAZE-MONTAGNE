/**
 * Fiche d'une randonnée sélectionnée (sections 15 et 16).
 *
 * Choix d'ergonomie important : sélectionner une randonnée **ne change pas de
 * page**. La carte se recentre sur le tracé, et cette fiche monte depuis le
 * bas. L'utilisateur garde le contexte — il voit où c'est pendant qu'il lit
 * ce que c'est.
 *
 * L'action principale dépend de la distance au départ (section 16) : on ne
 * propose pas de « démarrer » une randonnée dont le départ est à 7 km. On
 * propose d'abord d'y aller.
 */
import { Download, Footprints, Info, Navigation2, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router";
import type { NearbyTrail } from "@mountain-live/core";
import { Badge, BottomSheet, Button } from "@/components/ui";
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_TONE,
  SHAPE_LABELS,
  approachLabel,
  atTrailhead,
  durationLabel,
  elevationLabel,
  frequentationLabel,
  lengthLabel,
} from "./format";

export interface TrailPreviewSheetProps {
  trail: NearbyTrail | null;
  onClose: () => void;
  onStart: (trail: NearbyTrail) => void;
  onGuideToStart: (trail: NearbyTrail) => void;
}

export function TrailPreviewSheet({ trail, onClose, onStart, onGuideToStart }: TrailPreviewSheetProps) {
  const navigate = useNavigate();
  if (!trail) return null;
  const here = atTrailhead(trail.approachM);
  const frequentation = frequentationLabel(trail.frequentation, trail.passagesToday);

  return (
    <BottomSheet
      open
      onClose={onClose}
      defaultSnap="peek"
      // Le palier d'aperçu montre l'essentiel ET l'action principale en entier :
      // une randonnée qu'il faut faire glisser pour savoir comment la lancer
      // n'est pas « immédiatement compréhensible ».
      snapPoints={{ peek: 372, half: 0.62, full: 0.92 }}
      backdrop="none"
      title={trail.name}
      aria-label={`Randonnée ${trail.name}`}
      id="trail-preview"
    >
      <div className="space-y-4 pb-2" data-testid="trail-preview">
        {trail.activeReports > 0 && (
          <p className="flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2 text-[14px] font-semibold text-fg">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            {trail.reportHint ?? `${trail.activeReports} signalement${trail.activeReports > 1 ? "s" : ""} en cours sur cet itinéraire`}
          </p>
        )}

        {/* Les chiffres du parcours — la longueur, jamais l'approche. */}
        <dl className="tabular grid grid-cols-3 gap-3 text-center">
          <div>
            <dt className="text-[12px] text-muted">Longueur</dt>
            <dd className="text-[18px] font-bold text-fg">{lengthLabel(trail.lengthM)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Durée</dt>
            <dd className="text-[18px] font-bold text-fg">{durationLabel(trail.durationMs, trail.durationObserved)}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Dénivelé</dt>
            <dd className="text-[18px] font-bold text-fg">{elevationLabel(trail.elevationGainM)}</dd>
          </div>
        </dl>

        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={DIFFICULTY_TONE[trail.difficulty]}>{DIFFICULTY_LABELS[trail.difficulty]}</Badge>
          <Badge tone="neutral">{SHAPE_LABELS[trail.shape]}</Badge>
          {frequentation && <Badge tone="neutral">{frequentation}</Badge>}
        </p>

        {/* L'approche — sur sa propre ligne, jamais mêlée aux chiffres ci-dessus. */}
        <p className="text-[15px] font-semibold text-primary">{approachLabel(trail.approachM)}</p>

        <div className="space-y-2">
          {here ? (
            <Button size="lg" fullWidth onClick={() => onStart(trail)} data-testid="trail-start">
              <Footprints className="size-5" aria-hidden /> Démarrer la randonnée
            </Button>
          ) : (
            <Button size="lg" fullWidth onClick={() => onGuideToStart(trail)} data-testid="trail-guide">
              <Navigation2 className="size-5" aria-hidden /> Me guider vers le départ
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            {!here && (
              <Button size="md" variant="secondary" onClick={() => onStart(trail)}>
                <Footprints className="size-4" aria-hidden /> Démarrer quand même
              </Button>
            )}
            <Button size="md" variant="secondary" onClick={() => navigate("/offline")}>
              <Download className="size-4" aria-hidden /> Hors connexion
            </Button>
            <Button size="md" variant="ghost" onClick={() => navigate(`/explore?trail=${encodeURIComponent(trail.id)}`)}>
              <Info className="size-4" aria-hidden /> Voir les détails
            </Button>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
