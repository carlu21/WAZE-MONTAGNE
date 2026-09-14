/**
 * Enveloppe de champ de formulaire : libellé, aide, erreur.
 * Les contrôles (Input, Textarea, Select) lisent le contexte pour hériter de
 * l'identifiant, de aria-describedby et de aria-invalid :
 *
 *   <Field label="Pseudo" hint="Visible par les autres utilisateurs" error={errors.pseudo}>
 *     <Input value={pseudo} onChange={…} />
 *   </Field>
 */
import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

export const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldControlProps {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  required?: boolean;
  disabled?: boolean;
}

/** Fusionne les props d'un contrôle avec le contexte du Field englobant. */
export function useFieldControl<P extends FieldControlProps>(props: P): P {
  const ctx = useContext(FieldContext);
  if (!ctx) return props;
  const describedBy = [props["aria-describedby"], ctx.describedBy].filter(Boolean).join(" ") || undefined;
  return {
    ...props,
    id: props.id ?? ctx.id,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (ctx.invalid ? true : undefined),
    required: props.required ?? (ctx.required || undefined),
    disabled: props.disabled ?? (ctx.disabled || undefined),
  };
}

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  /** Message d'erreur : affiché en rouge et annoncé (role="alert"). */
  error?: ReactNode;
  required?: boolean;
  /** Ajoute « (facultatif) » au libellé. */
  optional?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
  /** Élément à droite du libellé (compteur, lien d'aide…). */
  labelEnd?: ReactNode;
}

export function Field({ label, hint, error, required = false, optional = false, disabled = false, id, className, children, labelEnd }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error), required, disabled }}>
      <div className={cn("flex flex-col gap-1.5", disabled && "opacity-60", className)}>
        {label || labelEnd ? (
          <div className="flex items-baseline justify-between gap-3">
            {label ? (
              <label htmlFor={controlId} className="text-[15px] font-semibold leading-snug text-fg">
                {label}
                {required ? (
                  <span className="ml-1 text-danger" aria-hidden="true">
                    *
                  </span>
                ) : optional ? (
                  <span className="ml-1 font-normal text-muted">(facultatif)</span>
                ) : null}
              </label>
            ) : (
              <span />
            )}
            {labelEnd ? <span className="text-[13px] text-muted">{labelEnd}</span> : null}
          </div>
        ) : null}
        {children}
        {error ? (
          <p id={errorId} role="alert" className="text-[14px] font-medium leading-snug text-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-[14px] leading-snug text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
