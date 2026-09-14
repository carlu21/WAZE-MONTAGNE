/** Indicateur d'étapes de l'assistant : Catégorie → Type → Détails. */
import { cn } from "@/components/ui";
import { PROGRESS_STEPS, type WizardStep } from "./wizardState";

export interface StepIndicatorProps {
  current: WizardStep;
  className?: string;
}

export function StepIndicator({ current, className }: StepIndicatorProps) {
  const index = current === "done" ? PROGRESS_STEPS.length : Math.max(0, PROGRESS_STEPS.findIndex((s) => s.step === current));
  const label = current === "done" ? "Terminé" : `Étape ${index + 1} sur ${PROGRESS_STEPS.length} · ${PROGRESS_STEPS[index]?.label ?? ""}`;
  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      <ol className="flex w-full gap-1.5" aria-label="Progression du signalement">
        {PROGRESS_STEPS.map((s, i) => {
          const done = i < index;
          const active = i === index;
          return (
            <li
              key={s.step}
              className={cn("h-1.5 flex-1 rounded-full transition-colors duration-200", done || active ? "bg-primary" : "bg-line-strong/60")}
              aria-current={active ? "step" : undefined}
              aria-label={`${s.label}${done ? " (terminé)" : active ? " (en cours)" : ""}`}
            />
          );
        })}
      </ol>
      <p className="text-[13px] font-semibold text-muted" aria-live="polite">
        {label}
      </p>
    </div>
  );
}
