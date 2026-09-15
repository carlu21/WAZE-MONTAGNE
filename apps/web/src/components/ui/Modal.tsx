/**
 * Boîte de dialogue modale simple : confirmation, formulaire court, information.
 * Sur mobile elle monte du bas de l'écran (usage à une main) ; centrée dès 640 px.
 */
import { useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { portalRoot } from "@/lib/portal";
import { OctagonAlert, X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./Button";
import { useEscapeKey, useFocusTrap, useLockBodyScroll } from "./hooks";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Boutons d'action (généralement à droite, Annuler + action principale). */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Échap et clic sur le voile ferment la boîte (défaut : true). */
  dismissible?: boolean;
  showClose?: boolean;
  /** Icône rouge d'avertissement dans l'en-tête (actions destructrices). */
  tone?: "default" | "danger";
  className?: string;
  "aria-label"?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const SIZES: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  showClose = true,
  tone = "default",
  className,
  "aria-label": ariaLabel,
  initialFocusRef,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useLockBodyScroll(open);
  useEscapeKey(open && dismissible, onClose);
  useFocusTrap(panelRef, open, { initialFocus: initialFocusRef });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="anim-fade-in absolute inset-0"
        style={{ background: "var(--scrim)" }}
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={cn(
          "anim-slide-up relative flex max-h-[calc(100dvh-var(--safe-top)-24px)] w-full flex-col rounded-t-3xl bg-surface shadow-lg outline-none",
          "sm:anim-scale-in sm:rounded-2xl",
          SIZES[size],
          className,
        )}
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        {title || showClose ? (
          <div className="flex items-start gap-3 px-5 pt-5 pb-2">
            {tone === "danger" ? (
              <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
                <OctagonAlert className="size-6" aria-hidden="true" />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              {title ? (
                <h2 id={titleId} className="text-xl font-bold leading-tight text-fg">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descId} className="mt-1 text-[15px] leading-snug text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {showClose ? (
              <IconButton aria-label="Fermer" size={44} variant="ghost" onClick={onClose} className="-mr-2 -mt-2">
                <X />
              </IconButton>
            ) : null}
          </div>
        ) : null}
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div> : null}
        {footer ? <div className="flex flex-col-reverse gap-2 px-5 pt-2 pb-5 sm:flex-row sm:justify-end">{footer}</div> : null}
      </div>
    </div>, portalRoot());
}
