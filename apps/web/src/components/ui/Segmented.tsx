/**
 * Contrôle segmenté (choix unique parmi 2 à 5 options : fond de carte, thème,
 * tri…). Sémantique radiogroup, navigation aux flèches.
 */
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Libellé accessible si `label` n'est qu'une icône. */
  "aria-label"?: string;
}

export interface SegmentedProps<V extends string> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Libellé accessible du groupe. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  size?: "md" | "lg";
  fullWidth?: boolean;
  className?: string;
  disabled?: boolean;
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  size = "md",
  fullWidth = true,
  className,
  disabled = false,
  ...aria
}: SegmentedProps<V>) {
  const baseId = useId();
  const enabled = options.filter((o) => !o.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || enabled.length === 0) return;
    const idx = Math.max(0, enabled.findIndex((o) => o.value === value));
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = enabled[next];
    onChange(target.value);
    document.getElementById(`${baseId}-${target.value}`)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"]}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex max-w-full items-stretch gap-1 rounded-lg bg-surface-2 p-1 ring-1 ring-line ring-inset",
        fullWidth && "flex w-full",
        disabled && "opacity-55",
        className,
      )}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            id={`${baseId}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o["aria-label"]}
            tabIndex={checked ? 0 : -1}
            disabled={disabled || o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 font-semibold leading-none",
              "transition-[background-color,color,box-shadow] duration-150 ease-out",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
              size === "lg" ? "h-14 text-[16px] [&_svg]:size-5" : "h-12 text-[14px] [&_svg]:size-5",
              checked ? "bg-surface text-primary shadow-sm" : "text-muted hover:text-fg",
            )}
          >
            {o.icon ? (
              <span className="inline-flex shrink-0" aria-hidden="true">
                {o.icon}
              </span>
            ) : null}
            {o.label ? <span className="line-clamp-2 whitespace-normal text-center leading-tight">{o.label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
