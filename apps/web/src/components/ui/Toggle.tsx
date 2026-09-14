/**
 * Interrupteur (préférences, alertes, filtres). role="switch".
 * Avec `label`, rend une ligne complète cliquable de 56 px minimum.
 */
import { forwardRef, useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  /** Obligatoire si `label` est absent. */
  "aria-label"?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  /** Icône à gauche du libellé. */
  icon?: ReactNode;
}

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  { checked, onChange, label, description, "aria-label": ariaLabel, disabled = false, id, name, className, icon },
  ref,
) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const descId = `${switchId}-desc`;

  const control = (
    <button
      ref={ref}
      id={switchId}
      type="button"
      role="switch"
      name={name}
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "ml-switch cursor-pointer focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
        !label && className,
      )}
    />
  );

  if (!label) return control;

  return (
    <div className={cn("flex min-h-14 items-center gap-3", disabled && "opacity-55", className)}>
      {icon ? (
        <span className="inline-flex shrink-0 text-muted [&_svg]:size-6" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer select-none py-2">
        <span className="block text-[16px] font-semibold leading-snug text-fg">{label}</span>
        {description ? (
          <span id={descId} className="mt-0.5 block text-[14px] leading-snug text-muted">
            {description}
          </span>
        ) : null}
      </label>
      {control}
    </div>
  );
});
