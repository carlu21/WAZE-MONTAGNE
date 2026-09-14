/** Graphiques SVG légers (barres, courbe) — sans bibliothèque. */
import { cn } from "@/components/ui";

export function barScale(values: readonly number[], height: number): (v: number) => number {
  const max = Math.max(1, ...values);
  return (v) => Math.round((Math.max(0, v) / max) * height);
}

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

export function BarChart({ data, height = 140, className, "aria-label": ariaLabel }: { data: BarDatum[]; height?: number; className?: string; "aria-label"?: string }) {
  const scale = barScale(data.map((d) => d.value), height - 24);
  const w = Math.max(240, data.length * 56);
  const bw = Math.min(40, (w - 16) / data.length - 12);
  return (
    <figure className={cn("overflow-x-auto", className)}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel ?? "Graphique en barres"}>
        {data.map((d, i) => {
          const h = scale(d.value);
          const x = 8 + i * ((w - 16) / data.length) + ((w - 16) / data.length - bw) / 2;
          return (
            <g key={d.label}>
              <rect x={x} y={height - 24 - h} width={bw} height={h} rx={4} fill={d.color ?? "var(--primary)"} />
              <text x={x + bw / 2} y={height - 28 - h} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--fg)">
                {d.value}
              </text>
              <text x={x + bw / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--fg-muted)">
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export function LineChart({ points, height = 120, className, "aria-label": ariaLabel }: { points: { label: string; value: number }[]; height?: number; className?: string; "aria-label"?: string }) {
  const w = 480;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? (w - 32) / (points.length - 1) : 0;
  const y = (v: number) => height - 20 - (v / max) * (height - 32);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${16 + i * step},${y(p.value)}`).join(" ");
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <figure className={cn("overflow-x-auto", className)}>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel ?? "Courbe"}>
        <line x1={16} y1={height - 20} x2={w - 16} y2={height - 20} stroke="var(--border)" />
        <path d={d} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((p, i) =>
          i % every === 0 ? (
            <text key={p.label} x={16 + i * step} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--fg-muted)">
              {p.label}
            </text>
          ) : null,
        )}
        <text x={w - 16} y={12} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--fg)">
          max {max}
        </text>
      </svg>
    </figure>
  );
}
