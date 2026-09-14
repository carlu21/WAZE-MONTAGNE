/**
 * Affichage des toasts (voir src/lib/toast.ts pour l'API impérative).
 *
 *   <ToastProvider>…</ToastProvider>   // une fois, dans App.tsx
 *   const toast = useToast(); toast.success("Signalement publié");
 *
 * - Empilement (4 max), fermeture automatique selon la tonalité, pause au survol.
 * - Variante persistante avec action (alertes de proximité) : toast.alert(...).
 * - Position : au-dessus de la barre de navigation (--shell-bottom).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, Info, OctagonAlert, TriangleAlert, X } from "lucide-react";
import { toast, useToasts, type ToastApi, type ToastItem, type ToastTone } from "@/lib/toast";
import { cn } from "./cn";
import { IconButton } from "./Button";

export function useToast(): ToastApi {
  return toast;
}

const TONE_ICON: Record<ToastTone, ReactNode> = {
  info: <Info />,
  success: <CircleCheck />,
  warning: <TriangleAlert />,
  danger: <OctagonAlert />,
};

const TONE_CLASSES: Record<ToastTone, string> = {
  info: "[&_.ml-toast-icon]:text-info",
  success: "[&_.ml-toast-icon]:text-success",
  warning: "[&_.ml-toast-icon]:text-warning border-warning/40",
  danger: "[&_.ml-toast-icon]:text-danger border-danger/50",
};

function ToastCard({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);

  // Minuterie de fermeture automatique, suspendue au survol ou au focus.
  useEffect(() => {
    if (item.duration <= 0 || paused) return;
    startedAt.current = Date.now();
    const id = window.setTimeout(() => toast.dismiss(item.id), remaining.current);
    return () => {
      window.clearTimeout(id);
      remaining.current = Math.max(500, remaining.current - (Date.now() - startedAt.current));
    };
  }, [item.id, item.duration, paused]);

  const pause = () => setPaused(true);
  const resume = () => setPaused(false);

  return (
    <div
      role={item.assertive ? "alert" : "status"}
      aria-live={item.assertive ? "assertive" : "polite"}
      data-tone={item.tone}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className={cn(
        "anim-slide-up pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-3 pl-4 text-fg shadow-lg",
        TONE_CLASSES[item.tone],
      )}
    >
      <span className="ml-toast-icon mt-0.5 inline-flex shrink-0 [&_svg]:size-6" aria-hidden="true">
        {item.icon ?? TONE_ICON[item.tone]}
      </span>
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-[16px] font-bold leading-snug">{item.title}</p>
        {item.description ? <p className="mt-0.5 text-[14px] leading-snug text-muted">{item.description}</p> : null}
        {item.action ? (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              toast.dismiss(item.id);
            }}
            className="mt-2 inline-flex h-11 items-center rounded-lg bg-primary-soft px-4 text-[15px] font-bold text-primary-soft-fg hover:bg-primary-soft/75 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      {item.dismissible ? (
        <IconButton aria-label="Fermer la notification" size={44} variant="ghost" onClick={() => toast.dismiss(item.id)} className="-my-1.5 -mr-1.5">
          <X className="size-5" />
        </IconButton>
      ) : null}
    </div>
  );
}

/** Zone d'affichage des toasts (portail). */
export function ToastViewport() {
  const items = useToasts();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 z-[var(--z-toast)] flex flex-col items-center gap-2 px-3"
      style={{ bottom: "calc(var(--shell-bottom) + 12px)", left: "var(--shell-left)" }}
      aria-label="Notifications"
    >
      <div className="flex w-full max-w-md flex-col gap-2">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

export interface ToastProviderProps {
  children?: ReactNode;
}

/** À monter une seule fois (App.tsx). */
export function ToastProvider({ children }: ToastProviderProps) {
  return (
    <>
      {children}
      <ToastViewport />
    </>
  );
}
