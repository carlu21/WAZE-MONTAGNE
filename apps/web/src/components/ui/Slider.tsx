/**
 * Curseur (rayon d'alerte, rayon « autour de moi ») : piste de 8 px, pouce de
 * 28 px, valeur affichée en clair, repères optionnels.
 */
import { forwardRef, useId, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface SliderMark {
  value: number;
  label: string;
}

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max" | "step" | "size" | "defaultValue"> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: ReactNode;
  /** Formatage de la valeur affichée (ex. formatDistance). */
  formatValue?: (value: number) => string;
  marks?: readonly SliderMark[];
  /** Masque la valeur affichée à droite du libellé. */
  hideValue?: boolean;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { value, onChange, min = 0, max = 100, step = 1, label, formatValue, marks, hideValue = false, className, id, disabled, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const span = max - min || 1;
  const ratio = Math.min(1, Math.max(0, (value - min) / span));
  const display = formatValue ? formatValue(value) : String(value);

  return (
    <div className={cn("flex flex-col gap-1", disabled && "opacity-60", className)}>
      {label || !hideValue ? (
        <div className="flex items-baseline justify-between gap-3">
          {label ? (
            <label htmlFor={inputId} className="text-[15px] font-semibold text-fg">
              {label}
            </label>
          ) : (
            <span />
          )}
          {!hideValue ? (
            <output htmlFor={inputId} className="tabular text-[16px] font-bold text-primary" aria-live="polite">
              {display}
            </output>
          ) : null}
        </div>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={display}
        className="ml-range"
        style={{ "--fill": `${ratio * 100}%` } as CSSProperties}
        {...rest}
      />
      {marks && marks.length > 0 ? (
        <div className="relative h-4 text-[12px] text-muted" aria-hidden="true">
          {marks.map((m) => {
            const r = Math.min(1, Math.max(0, (m.value - min) / span));
            return (
              <span
                key={m.value}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `calc(14px + ${r} * (100% - 28px))` }}
              >
                {m.label}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
