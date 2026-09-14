/**
 * Règles de sécurité (section 27) depuis `fr.safetyNotice` de @mountain-live/core.
 * - compact : une ligne dépliable (bas de fiche, écran de carte).
 * - complet : carte avec la liste des règles et un bouton « J'ai compris » optionnel.
 */
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { fr } from "@mountain-live/core";
import { cn } from "./cn";
import { Button } from "./Button";

export interface SafetyNoticeProps {
  variant?: "compact" | "full";
  /** Bouton « J'ai compris » (variante complète). */
  onAccept?: () => void;
  acceptLabel?: string;
  /** Contenu additionnel sous les règles (lien vers la page légale…). */
  children?: ReactNode;
  className?: string;
  /** Variante compacte : dépliée au départ. */
  defaultOpen?: boolean;
}

const notice = fr.safetyNotice;

export function SafetyNotice({ variant = "full", onAccept, acceptLabel = notice.accept, children, className, defaultOpen = false }: SafetyNoticeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  const rules = (
    <ul className="flex flex-col gap-1.5 pl-5 text-[15px] leading-snug text-fg marker:text-accent" style={{ listStyleType: "disc" }}>
      {notice.rules.map((rule) => (
        <li key={rule}>{rule}</li>
      ))}
    </ul>
  );

  if (variant === "compact") {
    return (
      <div className={cn("rounded-xl bg-warning-soft text-fg", className)} data-variant="compact">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 rounded-xl"
        >
          <ShieldAlert className="size-6 shrink-0 text-warning" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug">{notice.intro}</span>
          <ChevronDown className={cn("size-5 shrink-0 text-muted transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
        </button>
        <div id={panelId} hidden={!open} className="px-3 pb-3">
          {rules}
          <p className="mt-2 text-[14px] font-semibold text-warning">{notice.priority}</p>
          {children}
        </div>
      </div>
    );
  }

  return (
    <section className={cn("rounded-2xl border-2 border-warning/40 bg-surface p-4", className)} aria-labelledby={`${panelId}-title`} data-variant="full">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning" aria-hidden="true">
          <ShieldAlert className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${panelId}-title`} className="text-[18px] font-bold leading-tight text-fg">
            {notice.title}
          </h2>
          <p className="mt-1 text-[15px] leading-snug text-muted">{notice.intro}</p>
        </div>
      </div>
      <div className="mt-3">{rules}</div>
      <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-[15px] font-semibold text-fg">{notice.priority}</p>
      {children ? <div className="mt-3 text-[14px] text-muted">{children}</div> : null}
      {onAccept ? (
        <Button size="lg" fullWidth className="mt-4" onClick={onAccept}>
          {acceptLabel}
        </Button>
      ) : null}
    </section>
  );
}
