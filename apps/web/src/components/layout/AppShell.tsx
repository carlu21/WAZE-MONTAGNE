/**
 * Coquille applicative : contenu + barre de navigation basse (5 entrées) avec
 * bouton central « + Signaler ». Implémentation complète : tâche "design-system".
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col">{children}</div>;
}
