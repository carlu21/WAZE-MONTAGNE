import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { fr } from "@mountain-live/core";
import { IconButton } from "@/components/ui";

export function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}>
      <header className="flex items-center gap-2 px-2 py-2">
        <IconButton aria-label={fr.common.back} variant="ghost" size={44} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/map"))}>
          <ChevronLeft />
        </IconButton>
        <Link to="/map" className="text-[15px] font-bold text-primary">
          {fr.appName}
        </Link>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <div className="mx-auto w-full max-w-md">
          <h1 className="mb-4 text-[26px] font-extrabold leading-tight text-fg">{title}</h1>
          {children}
        </div>
      </main>
      {footer ? <footer className="px-6 pb-4 text-center text-[14px] text-muted">{footer}</footer> : null}
    </div>
  );
}

export function DemoAccounts() {
  return (
    <details className="mt-4 rounded-xl border border-line bg-surface p-3 text-[13px] text-muted">
      <summary className="cursor-pointer font-semibold text-fg">Comptes de démonstration (pilote Corse)</summary>
      <ul className="mt-2 space-y-1">
        <li>
          <code>rando@mountain-live.demo</code> — utilisateur
        </li>
        <li>
          <code>berger-asco@mountain-live.demo</code> — partenaire (berger)
        </li>
        <li>
          <code>mairie-corte@mountain-live.demo</code> — source officielle
        </li>
        <li>
          <code>moderateur@mountain-live.demo</code> — modération
        </li>
        <li>
          <code>admin@mountain-live.demo</code> — administration
        </li>
        <li>
          Mot de passe : <code>demo1234</code>
        </li>
      </ul>
    </details>
  );
}
