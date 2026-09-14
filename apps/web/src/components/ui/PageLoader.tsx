/**
 * Indicateur de chargement de page (Suspense, écrans en attente de données).
 */
import { cn } from "./cn";

export interface PageLoaderProps {
  label?: string;
  /** Occupe tout l'écran (démarrage) plutôt que la zone de contenu. */
  fullscreen?: boolean;
  className?: string;
}

export function PageLoader({ label = "Chargement…", fullscreen = false, className }: PageLoaderProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 bg-bg text-muted", fullscreen ? "fixed inset-0 z-[var(--z-modal)]" : "h-full min-h-[40vh]", className)}
      role="status"
      aria-live="polite"
    >
      <span className="size-9 animate-spin rounded-full border-4 border-line border-t-primary" aria-hidden="true" />
      <span className="text-[15px] font-medium">{label}</span>
    </div>
  );
}
