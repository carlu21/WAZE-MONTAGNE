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
 *
 * Et quand la donnée ne permet pas de tenir la promesse — tracé schématique,
 * données de démonstration, aucun chemin entre ici et le départ — la fiche le
 * DIT au lieu de dessiner une ligne droite. On propose alors ce qui est vrai :
 * voir les chemins réels du secteur, et un cap indicatif qui s'annonce comme tel.
 */
import { Compass, Download, Footprints, Info, Navigation2, Route, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router";
import { fr, type NearbyTrail } from "@mountain-live/core";
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

export interface TrailPreviewNotice {
  message: string;
  note: string | null;
  /**
   * Cap et distance à vol d'oiseau vers la destination, déjà mis en phrase.
   * Il remplace l'étiquette générique : une flèche de 90 m est invisible à
   * l'échelle d'un massif, la phrase, elle, reste lisible.
   */
  direction: string | null;
}

export interface TrailPreviewSheetProps {
  trail: NearbyTrail | null;
  onClose: () => void;
  onStart: (trail: NearbyTrail) => void;
  onGuideToStart: (trail: NearbyTrail) => void;
  /** Un itinéraire est en cours de calcul sur le réseau réel. */
  planning?: boolean;
  /** Refus du calcul d'itinéraire : rien n'a été tracé, et voici pourquoi. */
  notice?: TrailPreviewNotice | null;
  /** Le tracé de la randonnée elle-même n'est pas exploitable : on ne le dessine pas. */
  traceNotice?: string | null;
  pathsShown?: boolean;
  onShowNearbyPaths?: () => void;
}

/**
 * Hauteur du palier d'aperçu (px). Elle s'ajuste aux encarts d'indisponibilité :
 * une explication qui pousse l'action principale hors de l'écran remplace un
 * problème par un autre.
 */
export const PREVIEW_PEEK_BASE = 372;
export const PREVIEW_PEEK_TRACE_NOTICE = 108;
export const PREVIEW_PEEK_ROUTE_NOTICE = 170;
/**
 * Plafond du palier d'aperçu (px) : la carte garde toujours le tiers haut de
 * l'écran. C'est là que l'on vient de faire apparaître les chemins du secteur —
 * une feuille qui les recouvre annulerait la seule réponse utile qu'on ait pu
 * donner. Au-delà, la feuille défile.
 */
export const PREVIEW_PEEK_MAX = 552;

export function previewPeekHeight(traceNotice: string | null, notice: TrailPreviewNotice | null): number {
  const wanted = PREVIEW_PEEK_BASE + (traceNotice ? PREVIEW_PEEK_TRACE_NOTICE : 0) + (notice ? PREVIEW_PEEK_ROUTE_NOTICE : 0);
  return Math.min(wanted, PREVIEW_PEEK_MAX);
}

export function TrailPreviewSheet({
  trail,
  onClose,
  onStart,
  onGuideToStart,
  planning = false,
  notice = null,
  traceNotice = null,
  pathsShown = false,
  onShowNearbyPaths,
}: TrailPreviewSheetProps) {
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
      snapPoints={{ peek: previewPeekHeight(traceNotice, notice), half: 0.62, full: 0.92 }}
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

        {/*
          Le tracé n'est pas affichable : on le dit ici, une fois, clairement.
          Aucune ligne n'a été dessinée sur la carte — c'est voulu.
        */}
        {traceNotice && (
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-2" data-testid="trail-trace-notice">
            <p className="flex items-start gap-2 text-[14px] font-semibold text-fg">
              <Route className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              {fr.navigation.unavailable.soon}
            </p>
            <p className="mt-1 text-[13px] leading-snug text-muted">{traceNotice}</p>
          </div>
        )}

        {/* Refus du calcul d'itinéraire : la phrase exacte, puis ce qui reste vrai. */}
        {notice && (
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-2" data-testid="trail-route-notice">
            <p className="text-[14px] font-semibold text-fg">{notice.message}</p>
            {notice.note && <p className="mt-1 text-[13px] leading-snug text-muted">{notice.note}</p>}
            <p className="mt-1 text-[13px] leading-snug text-muted">{notice.direction ?? fr.navigation.directionOnly}</p>
            {onShowNearbyPaths && (
              <Button size="md" variant="secondary" className="mt-2" leftIcon={<Compass />} onClick={onShowNearbyPaths} data-testid="trail-show-paths">
                {pathsShown ? "Masquer les chemins à proximité" : fr.navigation.unavailable.showNearbyPaths}
              </Button>
            )}
          </div>
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
            <Button size="lg" fullWidth leftIcon={<Footprints />} onClick={() => onStart(trail)} disabled={Boolean(traceNotice)} data-testid="trail-start">
              Démarrer la randonnée
            </Button>
          ) : (
            <Button size="lg" fullWidth loading={planning} leftIcon={<Navigation2 />} onClick={() => onGuideToStart(trail)} data-testid="trail-guide">
              {planning ? fr.navigation.unavailable.searching : "Me guider vers le départ"}
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            {!here && (
              <Button size="md" variant="secondary" leftIcon={<Footprints />} onClick={() => onStart(trail)} disabled={Boolean(traceNotice)}>
                Démarrer quand même
              </Button>
            )}
            <Button size="md" variant="secondary" leftIcon={<Download />} onClick={() => navigate("/offline")}>
              Hors connexion
            </Button>
            <Button size="md" variant="ghost" leftIcon={<Info />} onClick={() => navigate(`/explore?trail=${encodeURIComponent(trail.id)}`)}>
              Voir les détails
            </Button>
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
