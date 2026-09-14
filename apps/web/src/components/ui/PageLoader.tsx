export function PageLoader() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--border)] border-t-[var(--primary)]" />
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
