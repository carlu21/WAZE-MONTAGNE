/**
 * Champ de saisie texte (48 px, 56 px en « lg »), avec icône à gauche et
 * emplacement à droite (bouton d'effacement, unité…).
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";
import { useFieldControl } from "./Field";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "md" | "lg";
  leftIcon?: ReactNode;
  /** Élément à droite dans le champ (bouton, texte). */
  rightSlot?: ReactNode;
  invalid?: boolean;
  /** Classe du conteneur (le champ lui-même reçoit `className`). */
  wrapperClassName?: string;
}

export const INPUT_CLASSES =
  "w-full min-w-0 rounded-lg border-2 border-line bg-surface text-[17px] text-fg placeholder:text-subtle " +
  "transition-[border-color,box-shadow] duration-150 focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring/25 " +
  "aria-invalid:border-danger aria-invalid:focus:ring-danger/25 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70";

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", leftIcon, rightSlot, invalid, className, wrapperClassName, ...props },
  ref,
) {
  const controlProps = useFieldControl({ ...props, "aria-invalid": invalid ? true : props["aria-invalid"] });
  const field = (
    <input
      ref={ref}
      className={cn(
        INPUT_CLASSES,
        size === "lg" ? "h-14" : "h-12",
        leftIcon ? "pl-12" : "px-4",
        rightSlot ? "pr-12" : "pr-4",
        className,
      )}
      {...controlProps}
    />
  );
  if (!leftIcon && !rightSlot) return field;
  return (
    <div className={cn("relative flex items-center", wrapperClassName)}>
      {leftIcon ? (
        <span className="pointer-events-none absolute left-4 inline-flex text-muted [&_svg]:size-5" aria-hidden="true">
          {leftIcon}
        </span>
      ) : null}
      {field}
      {rightSlot ? <span className="absolute right-1 inline-flex items-center">{rightSlot}</span> : null}
    </div>
  );
});
