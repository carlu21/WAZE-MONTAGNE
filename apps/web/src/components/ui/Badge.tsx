/**
 * Pastilles d'information : Badge générique, SourceBadge (section 7),
 * ConfidenceBadge (section 6), DangerPill (niveau de danger), StatusPill (section 26).
 *
 * La couleur est pilotée par la variable CSS --badge-color (voir .ml-badge dans
 * styles/index.css) : lisible en clair comme en sombre sans variantes `dark:`.
 */
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import {
  BadgeCheck,
  CircleCheck,
  CircleDashed,
  CircleDot,
  OctagonAlert,
  Shield,
  ShieldCheck,
  TriangleAlert,
  Users,
} from "lucide-react";
import {
  CONFIDENCE_LABELS,
  DANGER_LEVELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  type ConfidenceLabel,
  type DangerLevel,
  type ReportSource,
  type ReportStatus,
} from "@mountain-live/core";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "primary" | "accent" | "danger" | "success" | "info" | "gold" | "water";
export type BadgeSize = "sm" | "md";

const TONE_COLORS: Record<BadgeTone, string> = {
  neutral: "var(--fg-muted)",
  primary: "var(--primary)",
  accent: "var(--warning)",
  danger: "var(--danger)",
  success: "var(--success)",
  info: "var(--info)",
  gold: "var(--gold)",
  water: "var(--water)",
};

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "color"> {
  tone?: BadgeTone;
  /** Couleur libre (hex ou var CSS) : prioritaire sur `tone`. */
  color?: string;
  size?: BadgeSize;
  /** Fond plein et texte blanc (alertes importantes). */
  solid?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export function Badge({ tone = "neutral", color, size = "md", solid = false, icon, className, style, children, ...rest }: BadgeProps) {
  const vars = { "--badge-color": color ?? TONE_COLORS[tone] } as CSSProperties;
  return (
    <span
      className={cn(
        "ml-badge inline-flex max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none",
        size === "sm" ? "h-6 px-2 text-[12px] [&_svg]:size-3.5" : "h-7 px-2.5 text-[13px] [&_svg]:size-4",
        solid && "ml-badge--solid",
        className,
      )}
      style={{ ...vars, ...style }}
      {...rest}
    >
      {icon ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* SourceBadge : Officiel / Partenaire vérifié / Communauté            */
/* ------------------------------------------------------------------ */

export interface SourceBadgeProps extends Omit<BadgeProps, "tone" | "icon" | "children"> {
  source: ReportSource;
  /** Libellé long (« Source officielle ») plutôt que court (« Officiel »). */
  long?: boolean;
}

const SOURCE_STYLE: Record<ReportSource, { tone: BadgeTone; icon: ReactNode }> = {
  official: { tone: "gold", icon: <BadgeCheck /> },
  partner: { tone: "primary", icon: <Shield /> },
  community: { tone: "neutral", icon: <Users /> },
};

export function SourceBadge({ source, long = false, ...rest }: SourceBadgeProps) {
  const def = SOURCE_LABELS[source];
  const style = SOURCE_STYLE[source];
  return (
    <Badge tone={style.tone} icon={style.icon} title={def.label} {...rest}>
      {long ? def.label : def.badge}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* ConfidenceBadge : Faible confiance / Probable / Confirmé / Très fiable */
/* ------------------------------------------------------------------ */

export interface ConfidenceBadgeProps extends Omit<BadgeProps, "tone" | "icon" | "children" | "color"> {
  label: ConfidenceLabel;
  /** Score 0..100 affiché entre parenthèses si fourni. */
  score?: number | null;
}

const CONFIDENCE_ICONS: Record<ConfidenceLabel, ReactNode> = {
  low: <CircleDashed />,
  probable: <CircleDot />,
  confirmed: <CircleCheck />,
  high: <ShieldCheck />,
};

export function ConfidenceBadge({ label, score, ...rest }: ConfidenceBadgeProps) {
  const def = CONFIDENCE_LABELS[label];
  const hasScore = typeof score === "number" && Number.isFinite(score);
  return (
    <Badge
      color={def.color}
      icon={CONFIDENCE_ICONS[label]}
      data-confidence={label}
      title={hasScore ? `Indice de confiance : ${Math.round(score)} / 100` : undefined}
      {...rest}
    >
      {def.label}
      {hasScore ? <span className="ml-1 font-normal opacity-80">{Math.round(score)} %</span> : null}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* DangerPill : Faible / Modéré / Important / Critique                 */
/* ------------------------------------------------------------------ */

export interface DangerPillProps extends Omit<BadgeProps, "tone" | "icon" | "children" | "color"> {
  level: DangerLevel;
  /** Préfixe « Niveau : » (défaut : false). */
  withPrefix?: boolean;
}

export function DangerPill({ level, withPrefix = false, ...rest }: DangerPillProps) {
  const def = DANGER_LEVELS.find((d) => d.id === level) ?? DANGER_LEVELS[0];
  const severe = level === "high" || level === "critical";
  return (
    <Badge
      color={def.color}
      solid={level === "critical"}
      icon={level === "critical" ? <OctagonAlert /> : severe ? <TriangleAlert /> : undefined}
      data-danger-level={level}
      {...rest}
    >
      {withPrefix ? `Niveau : ${def.label.toLowerCase()}` : def.label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* StatusPill : statuts de signalement (section 26)                    */
/* ------------------------------------------------------------------ */

const STATUS_TONES: Record<ReportStatus, BadgeTone> = {
  active: "primary",
  confirmed: "success",
  probably_resolved: "info",
  resolved: "neutral",
  expired: "neutral",
  disputed: "accent",
  deleted: "danger",
};

export interface StatusPillProps extends Omit<BadgeProps, "tone" | "children" | "color"> {
  status: ReportStatus;
}

export function StatusPill({ status, ...rest }: StatusPillProps) {
  return (
    <Badge tone={STATUS_TONES[status]} data-status={status} {...rest}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
