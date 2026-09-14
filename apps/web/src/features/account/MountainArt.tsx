/** Illustration sobre : courbes de niveau et silhouette de montagne (onboarding, splash). */
export function MountainArt({ className, variant = "ridge" }: { className?: string; variant?: "ridge" | "contours" | "signal" }) {
  return (
    <svg viewBox="0 0 320 200" className={className} aria-hidden="true" fill="none">
      <defs>
        <linearGradient id="ml-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--primary)" stopOpacity="0.08" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="320" height="200" rx="24" fill="url(#ml-sky)" />
      {variant === "contours" ? (
        <g stroke="var(--primary)" strokeOpacity="0.55" strokeWidth="1.5">
          <ellipse cx="160" cy="110" rx="120" ry="60" />
          <ellipse cx="160" cy="110" rx="95" ry="46" />
          <ellipse cx="160" cy="110" rx="70" ry="33" />
          <ellipse cx="160" cy="110" rx="45" ry="20" />
          <ellipse cx="160" cy="110" rx="20" ry="8" />
          <circle cx="160" cy="110" r="4" fill="var(--accent)" stroke="none" />
        </g>
      ) : null}
      {variant === "ridge" ? (
        <g>
          <path d="M0 160 L60 90 L95 125 L140 60 L185 120 L230 80 L275 130 L320 100 L320 200 L0 200 Z" fill="var(--primary)" fillOpacity="0.85" />
          <path d="M0 175 L50 130 L110 165 L170 120 L235 170 L290 140 L320 160 L320 200 L0 200 Z" fill="var(--primary)" />
          <circle cx="255" cy="45" r="14" fill="var(--accent)" />
        </g>
      ) : null}
      {variant === "signal" ? (
        <g>
          <path d="M0 170 L70 110 L120 150 L180 90 L240 150 L320 110 L320 200 L0 200 Z" fill="var(--primary)" />
          <circle cx="180" cy="90" r="6" fill="var(--accent)" />
          <circle cx="180" cy="90" r="18" stroke="var(--accent)" strokeWidth="2" strokeOpacity="0.6" />
          <circle cx="180" cy="90" r="32" stroke="var(--accent)" strokeWidth="2" strokeOpacity="0.3" />
        </g>
      ) : null}
    </svg>
  );
}
