/**
 * Liste déroulante native (fiable sur mobile), habillée comme un Input.
 */
import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { INPUT_CLASSES } from "./Input";
import { useFieldControl } from "./Field";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: "md" | "lg";
  options?: readonly SelectOption[];
  /** Première option vide (« Sélectionner… »). */
  placeholder?: string;
  invalid?: boolean;
  wrapperClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = "md", options, placeholder, invalid, className, wrapperClassName, children, ...props },
  ref,
) {
  const controlProps = useFieldControl({ ...props, "aria-invalid": invalid ? true : props["aria-invalid"] });
  return (
    <div className={cn("relative flex items-center", wrapperClassName)}>
      <select
        ref={ref}
        className={cn(INPUT_CLASSES, "appearance-none pl-4 pr-12", size === "lg" ? "h-14" : "h-12", className)}
        {...controlProps}
      >
        {placeholder !== undefined ? (
          <option value="" disabled={controlProps.required}>
            {placeholder}
          </option>
        ) : null}
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-4 size-5 text-muted" aria-hidden="true" />
    </div>
  );
});
