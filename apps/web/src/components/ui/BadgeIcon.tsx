/**
 * Badge utilisateur (section 15) : Éclaireur, Contributeur, Expert local,
 * Sentinelle, Partenaire vérifié — icône dans un disque, libellé optionnel.
 */
import { BADGES, type BadgeId } from "@mountain-live/core";
import { cn } from "./cn";
import { CategoryIcon } from "./CategoryIcon";

export interface BadgeIconProps {
  id: BadgeId;
  size?: "sm" | "md" | "lg";
  /** Badge non encore obtenu : grisé. */
  earned?: boolean;
  showLabel?: boolean;
  showDescription?: boolean;
  className?: string;
}

const DISC: Record<NonNullable<BadgeIconProps["size"]>, { disc: string; icon: number }> = {
  sm: { disc: "size-8", icon: 16 },
  md: { disc: "size-12", icon: 24 },
  lg: { disc: "size-16", icon: 32 },
};

const BADGE_COLORS: Record<BadgeId, string> = {
  scout: "var(--info)",
  contributor: "var(--primary)",
  local_expert: "var(--accent)",
  sentinel: "var(--water)",
  verified_partner: "var(--gold)",
};

export function BadgeIcon({ id, size = "md", earned = true, showLabel = false, showDescription = false, className }: BadgeIconProps) {
  const def = BADGES[id];
  const s = DISC[size];
  const color = earned ? BADGE_COLORS[id] : "var(--fg-subtle)";
  return (
    <span
      className={cn("inline-flex items-center gap-2", showDescription && "items-start", className)}
      title={showLabel ? undefined : `${def.label} — ${def.description}`}
      data-badge={id}
      data-earned={earned}
    >
      <span
        className={cn("inline-flex shrink-0 items-center justify-center rounded-full", s.disc, !earned && "opacity-60")}
        style={{ background: `color-mix(in srgb, ${color} 16%, var(--surface))`, color }}
        role="img"
        aria-label={showLabel ? undefined : def.label}
      >
        <CategoryIcon name={def.icon} size={s.icon} strokeWidth={2.25} />
      </span>
      {showLabel ? (
        <span className="min-w-0">
          <span className={cn("block font-semibold leading-tight", size === "lg" ? "text-[17px]" : "text-[15px]", !earned && "text-muted")}>{def.label}</span>
          {showDescription ? <span className="mt-0.5 block text-[13px] leading-snug text-muted">{def.description}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
