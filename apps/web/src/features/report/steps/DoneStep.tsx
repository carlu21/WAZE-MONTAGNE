/**
 * Écran de confirmation : coche animée, récapitulatif (icône, libellé,
 * « Visible pendant X »), photo, puis « Voir la carte » / « Nouveau signalement ».
 * Retour automatique à la carte après 1,5 s, annulé dès que l'utilisateur interagit.
 */
import { useEffect, useRef, useState } from "react";
import { Check, MapPin, Plus } from "lucide-react";
import { CATEGORY_BY_ID, SUBTYPE_BY_ID, fr, type Report } from "@mountain-live/core";
import { Banner, Button, CategoryIcon, usePrefersReducedMotion } from "@/components/ui";
import { photoUrl } from "@/lib/api";
import { validityLabelForReport } from "../wizardState";

export const DONE_AUTO_RETURN_MS = 1500;

export interface DoneStepProps {
  report: Report;
  /** Message si la photo n'a pas pu être envoyée (le signalement, lui, est publié). */
  photoError?: string | null;
  onSeeMap: () => void;
  onNew: () => void;
  autoReturnMs?: number;
}

export function DoneStep({ report, photoError, onSeeMap, onNew, autoReturnMs = DONE_AUTO_RETURN_MS }: DoneStepProps) {
  const def = SUBTYPE_BY_ID[report.subtype];
  const cat = CATEGORY_BY_ID[def.category];
  const reducedMotion = usePrefersReducedMotion();
  const [autoReturn, setAutoReturn] = useState(autoReturnMs > 0);
  const onSeeMapRef = useRef(onSeeMap);
  onSeeMapRef.current = onSeeMap;
  const photo = photoUrl(report.photoUrl);

  // Retour automatique à la carte, annulé à la première interaction (l'utilisateur lit ou veut enchaîner).
  useEffect(() => {
    if (!autoReturn) return;
    const id = window.setTimeout(() => onSeeMapRef.current(), autoReturnMs);
    return () => window.clearTimeout(id);
  }, [autoReturn, autoReturnMs]);

  const cancelAutoReturn = () => setAutoReturn(false);

  return (
    <div className="flex min-h-full flex-col gap-6" onPointerDown={cancelAutoReturn} onKeyDown={cancelAutoReturn}>
      <div className="flex flex-col items-center gap-3 pt-4 text-center">
        <span className={reducedMotion ? "inline-flex size-20 items-center justify-center rounded-full bg-success text-white shadow-md" : "anim-scale-in inline-flex size-20 items-center justify-center rounded-full bg-success text-white shadow-md"} aria-hidden="true">
          <Check className="size-11" strokeWidth={3} />
        </span>
        <h2 className="text-[26px] font-bold leading-tight text-fg">Signalement publié</h2>
        <p className="text-[17px] text-muted">Merci ! Les autres usagers le voient dès maintenant.</p>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border-2 bg-surface p-3" style={{ borderColor: `var(${cat.colorVar})` }} role="group" aria-label="Récapitulatif">
        <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: `var(${cat.colorVar})` }} aria-hidden="true">
          <CategoryIcon name={def.icon} size={30} strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[20px] font-bold leading-tight text-fg">{def.label}</p>
          <p className="truncate text-[15px] text-muted">
            {validityLabelForReport(report)}
            {report.zone ? ` · ${report.zone}` : ""}
          </p>
        </div>
      </div>

      {photo ? <img src={photo} alt="Photo du signalement" className="h-44 w-full rounded-2xl border-2 border-line object-cover" /> : null}

      {photoError ? (
        <Banner tone="warning" title="Photo non envoyée">
          {photoError} Vous pourrez l'ajouter depuis la fiche du signalement.
        </Banner>
      ) : null}

      {report.blurred ? (
        <Banner tone="info" compact>
          {fr.wizard.sensitiveNotice}
        </Banner>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        {autoReturn ? (
          <p className="text-center text-[13px] text-muted" aria-live="polite">
            Retour à la carte dans un instant…
          </p>
        ) : null}
        <Button size="xl" fullWidth leftIcon={<MapPin />} onClick={onSeeMap}>
          {fr.common.seeOnMap}
        </Button>
        <Button size="lg" variant="outline" fullWidth leftIcon={<Plus />} onClick={onNew}>
          Nouveau signalement
        </Button>
      </div>
    </div>
  );
}
