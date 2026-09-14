/**
 * Légende repliable de la carte : couleurs et icônes par catégorie, marqueur
 * officiel, regroupements, opacité (ancienneté), position approximative,
 * zones d'alerte, fréquentation et position de l'appareil.
 */
import { useCallback, useId } from "react";
import { Info, X } from "lucide-react";
import { CATEGORIES, fr } from "@mountain-live/core";
import { CategoryIcon, IconButton, useEscapeKey } from "@/components/ui";

export interface MapLegendProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  className?: string;
}

function Row({ swatch, label, detail }: { swatch: React.ReactNode; label: string; detail?: string }) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="inline-flex size-9 shrink-0 items-center justify-center" aria-hidden="true">
        {swatch}
      </span>
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block text-[15px] font-semibold text-fg">{label}</span>
        {detail ? <span className="block text-[13px] text-muted">{detail}</span> : null}
      </span>
    </li>
  );
}

export function MapLegend({ open, onToggle, className }: MapLegendProps) {
  const id = useId();
  useEscapeKey(
    open,
    useCallback(() => onToggle(false), [onToggle]),
  );
  const categories = [...CATEGORIES].sort((a, b) => a.order - b.order);

  return (
    <div className={className}>
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={fr.mapUi.legend}
          className="anim-scale-in glass-strong mb-2 w-[min(300px,calc(100vw-24px))] rounded-xl p-3 shadow-lg"
        >
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[16px] font-bold text-fg">{fr.mapUi.legend}</h2>
            <IconButton aria-label={fr.common.close} size={44} variant="ghost" onClick={() => onToggle(false)} className="-mr-2 -mt-1">
              <X className="size-5" />
            </IconButton>
          </div>
          <ul className="max-h-[50vh] overflow-y-auto overscroll-contain">
            {categories.map((c) => (
              <Row
                key={c.id}
                swatch={
                  <span className="inline-flex size-8 items-center justify-center rounded-full text-white [&_svg]:size-4" style={{ background: c.color }}>
                    <CategoryIcon category={c.id} strokeWidth={2.4} />
                  </span>
                }
                label={c.label}
              />
            ))}
            <Row
              swatch={
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-white ring-[3px] ring-gold [&_svg]:size-4">
                  <CategoryIcon name="badge-check" strokeWidth={2.4} />
                </span>
              }
              label="Source officielle"
              detail="Liseré doré : commune, service public, gestionnaire."
            />
            <Row
              swatch={<span className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white ring-[3px] ring-surface">12</span>}
              label="Signalements regroupés"
              detail="Touchez le cercle pour zoomer."
            />
            <Row
              swatch={
                <span className="inline-flex items-end gap-0.5">
                  <span className="size-5 rounded-full bg-primary" />
                  <span className="size-5 rounded-full bg-primary opacity-40" />
                </span>
              }
              label="Icône estompée"
              detail="Signalement ancien, à reconfirmer."
            />
            <Row
              swatch={<span className="size-7 rounded-full border-2 border-dashed border-[#6B4F2A] bg-[#6B4F2A]/15" />}
              label="Position approximative"
              detail="Espèce sensible : point flouté."
            />
            <Row
              swatch={<span className="size-7 rounded-md border-2 border-dashed border-danger bg-danger/20" />}
              label="Zone d'alerte officielle"
              detail="Rouge : importante ou critique ; orange : modérée."
            />
            <Row
              swatch={<span className="h-4 w-8 rounded-full" style={{ background: "linear-gradient(90deg, rgba(47,107,58,0.3), rgba(143,191,152,0.7), rgba(217,130,43,0.8))" }} />}
              label="Fréquentation"
              detail="Estimation anonyme, jamais de position individuelle."
            />
            <Row swatch={<span className="size-4 rounded-full bg-info ring-[3px] ring-white shadow-md" />} label="Ma position" />
          </ul>
        </div>
      ) : null}
      <IconButton aria-label={fr.mapUi.legend} title={fr.mapUi.legend} aria-expanded={open} aria-controls={open ? id : undefined} variant="glass" size={52} pressed={open} onClick={() => onToggle(!open)}>
        <Info />
      </IconButton>
    </div>
  );
}
