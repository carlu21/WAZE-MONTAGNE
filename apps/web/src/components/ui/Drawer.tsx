/**
 * Tiroir latéral (filtres avancés, menus secondaires, écran large).
 */
import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { portalRoot } from "@/lib/portal";
import { X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./Button";
import { useEscapeKey, useFocusTrap, useLockBodyScroll } from "./hooks";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: "left" | "right";
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Largeur CSS (défaut : min(360px, 88vw)). */
  width?: string;
  dismissible?: boolean;
  showClose?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Drawer({
  open,
  onClose,
  side = "right",
  title,
  children,
  footer,
  width = "min(360px, 88vw)",
  dismissible = true,
  showClose = true,
  className,
  "aria-label": ariaLabel,
}: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useLockBodyScroll(open);
  useEscapeKey(open && dismissible, onClose);
  useFocusTrap(panelRef, open);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--z-drawer)]">
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
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 flex flex-col bg-surface shadow-lg outline-none",
          side === "left" ? "left-0 rounded-r-2xl" : "right-0 rounded-l-2xl",
          className,
        )}
        style={{
          width,
          paddingTop: "var(--safe-top)",
          paddingBottom: "var(--safe-bottom)",
          animation: `${side === "left" ? "ml-drawer-left" : "ml-drawer-right"} var(--dur-slow) var(--ease) both`,
        }}
      >
        {title || showClose ? (
          <div className="flex items-center gap-3 px-4 py-3">
            {title ? (
              <h2 id={titleId} className="min-w-0 flex-1 truncate text-lg font-bold text-fg">
                {title}
              </h2>
            ) : (
              <span className="flex-1" />
            )}
            {showClose ? (
              <IconButton aria-label="Fermer" size={44} variant="ghost" onClick={onClose}>
                <X />
              </IconButton>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">{children}</div>
        {footer ? <div className="border-t border-line px-4 py-3">{footer}</div> : null}
      </div>
    </div>, portalRoot());
}
