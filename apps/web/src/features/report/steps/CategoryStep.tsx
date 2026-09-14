/**
 * Étape 1 — « Que souhaitez-vous signaler ? » : raccourcis fréquents puis
 * grille des 6 catégories (section 4).
 */
import { CATEGORIES, fr, type ReportCategory, type ReportSubtype } from "@mountain-live/core";
import { CategoryTile, SubtypeTile } from "@/components/ui";
import { shortcutHint } from "../frequentSubtypes";

export interface CategoryStepProps {
  shortcuts: readonly ReportSubtype[];
  onPickCategory: (category: ReportCategory) => void;
  /** Raccourci : saute directement aux détails. */
  onPickSubtype: (subtype: ReportSubtype) => void;
}

export function CategoryStep({ shortcuts, onPickCategory, onPickSubtype }: CategoryStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-balance text-[26px] font-bold leading-tight text-fg">{fr.wizard.title}</h2>

      {shortcuts.length > 0 ? (
        <section aria-labelledby="wizard-shortcuts" className="flex flex-col gap-3">
          <h3 id="wizard-shortcuts" className="text-[13px] font-bold uppercase tracking-wide text-muted">
            Fréquents
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {shortcuts.map((subtype) => (
              <SubtypeTile
                key={subtype}
                subtype={subtype}
                hint={shortcutHint(subtype)}
                layout="row"
                style={{ minHeight: 96 }}
                onClick={() => onPickSubtype(subtype)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="wizard-categories" className="flex flex-col gap-3">
        <h3 id="wizard-categories" className="text-[13px] font-bold uppercase tracking-wide text-muted">
          {fr.wizard.subtitle}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {CATEGORIES.map((c) => (
            <CategoryTile key={c.id} category={c.id} chevron={false} className="items-start" style={{ minHeight: 120 }} onClick={() => onPickCategory(c.id)} />
          ))}
        </div>
      </section>
    </div>
  );
}
