/**
 * Confirmation communautaire (section 6) : « Toujours présent », « Situation améliorée »,
 * « Plus présent », et « Contester » en retrait. L'auteur ne vote pas (il peut déclarer résolu).
 */
import { Check, CircleCheck, Flag, TrendingDown } from "lucide-react";
import { fr, type ConfirmationKind } from "@mountain-live/core";
import { Button, cn } from "@/components/ui";

export interface ConfirmationBarProps {
  current: ConfirmationKind | null | undefined;
  onVote: (kind: ConfirmationKind) => void;
  onDispute: () => void;
  pending?: boolean;
  disabled?: boolean;
  /** L'utilisateur est l'auteur : boutons désactivés avec explication. */
  isAuthor?: boolean;
  /** Signalement clos (résolu / expiré) : votes désactivés. */
  closed?: boolean;
  className?: string;
}

const OPTIONS: { kind: ConfirmationKind; label: string; icon: React.ReactNode; tone: "primary" | "secondary" | "outline" }[] = [
  { kind: "still_present", label: fr.confirmations.stillPresent, icon: <Check />, tone: "primary" },
  { kind: "improved", label: fr.confirmations.improved, icon: <TrendingDown />, tone: "secondary" },
  { kind: "gone", label: fr.confirmations.gone, icon: <CircleCheck />, tone: "outline" },
];

export function ConfirmationBar({ current, onVote, onDispute, pending = false, disabled = false, isAuthor = false, closed = false, className }: ConfirmationBarProps) {
  const inactive = disabled || isAuthor || closed;
  return (
    <section aria-label={fr.confirmations.question} className={cn("flex flex-col gap-2", className)}>
      <h2 className="text-[15px] font-semibold text-fg">{fr.confirmations.question}</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={fr.confirmations.question}>
        {OPTIONS.map((o) => {
          const selected = current === o.kind;
          return (
            <Button
              key={o.kind}
              size="lg"
              variant={selected ? "primary" : o.tone === "primary" ? "secondary" : o.tone}
              leftIcon={o.icon}
              aria-pressed={selected}
              disabled={inactive}
              loading={pending && selected}
              onClick={() => onVote(o.kind)}
              data-kind={o.kind}
              className={cn(selected && "ring-2 ring-ring/50")}
            >
              {o.label}
            </Button>
          );
        })}
      </div>
      {isAuthor ? (
        <p className="text-[13px] text-muted">{fr.confirmations.ownReport}</p>
      ) : closed ? (
        <p className="text-[13px] text-muted">Ce signalement est clos : les votes sont désactivés.</p>
      ) : (
        <button
          type="button"
          onClick={onDispute}
          disabled={inactive}
          aria-pressed={current === "disputed"}
          className={cn(
            "inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-lg px-3 text-[14px] font-semibold text-muted underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
            current === "disputed" && "text-danger",
          )}
        >
          <Flag className="size-4" aria-hidden="true" />
          {current === "disputed" ? "Contesté par vous" : fr.confirmations.dispute}
          <span className="font-normal">· {fr.confirmations.disputeHint}</span>
        </button>
      )}
    </section>
  );
}
