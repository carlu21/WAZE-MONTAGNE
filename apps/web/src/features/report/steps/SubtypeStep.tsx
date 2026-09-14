/** Étape 2 — sous-types de la catégorie choisie, grille 2 colonnes. */
import { CATEGORY_BY_ID, SUBTYPE_BY_ID, formatTtl, fr, subtypesOf, type ReportCategory, type ReportSubtype } from "@mountain-live/core";
import { CategoryIcon, SubtypeTile } from "@/components/ui";

export interface SubtypeStepProps {
  category: ReportCategory;
  selected: ReportSubtype | null;
  onPick: (subtype: ReportSubtype) => void;
}

/** Ligne secondaire d'une tuile : durée de visibilité par défaut ou « jusqu'à l'heure de fin ». */
export function subtypeHint(subtype: ReportSubtype): string {
  const def = SUBTYPE_BY_ID[subtype];
  return def.askEndTime ? "Jusqu'à l'heure de fin" : `Visible ${formatTtl(def.defaultTtlMin)}`;
}

export function SubtypeStep({ category, selected, onPick }: SubtypeStepProps) {
  const def = CATEGORY_BY_ID[category];
  const subtypes = subtypesOf(category);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ background: `var(${def.colorVar})` }}
          aria-hidden="true"
        >
          <CategoryIcon name={def.icon} size={26} strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[22px] font-bold leading-tight text-fg">{def.label}</h2>
          <p className="text-[15px] text-muted">{fr.wizard.chooseSubtype}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3" role="list" aria-label={`Sous-types : ${def.label}`}>
        {subtypes.map((s) => (
          <div key={s.id} role="listitem" className="flex">
            <SubtypeTile subtype={s.id} layout="column" hint={subtypeHint(s.id)} selected={selected === s.id} onClick={() => onPick(s.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}
