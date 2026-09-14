/**
 * Zone de texte (commentaire, description) avec compteur de caractères
 * optionnel et redimensionnement automatique.
 */
import { forwardRef, useCallback, useEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";
import { INPUT_CLASSES } from "./Input";
import { useFieldControl } from "./Field";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Ajuste la hauteur au contenu (jusqu'à `maxRows`). */
  autoResize?: boolean;
  maxRows?: number;
  /** Affiche « 120 / 500 » sous le champ quand `maxLength` est défini (défaut : true). */
  showCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, autoResize = true, maxRows = 8, showCount = true, rows = 3, className, onChange, value, ...props },
  ref,
) {
  const controlProps = useFieldControl({ ...props, "aria-invalid": invalid ? true : props["aria-invalid"] });
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el || !autoResize) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const max = line * maxRows + 24;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [autoResize, maxRows]);

  useEffect(() => {
    resize();
  }, [value, resize]);

  const length = typeof value === "string" ? value.length : Array.isArray(value) ? 0 : (innerRef.current?.value.length ?? 0);
  const max = props.maxLength;

  return (
    <div className="flex flex-col gap-1">
      <textarea
        ref={setRefs}
        rows={rows}
        value={value}
        onChange={(e) => {
          onChange?.(e);
          resize();
        }}
        className={cn(INPUT_CLASSES, "min-h-12 resize-none px-4 py-3 leading-snug", className)}
        {...controlProps}
      />
      {showCount && typeof max === "number" ? (
        <span className="tabular self-end text-[13px] text-muted" aria-live="polite">
          {length} / {max}
        </span>
      ) : null}
    </div>
  );
});
