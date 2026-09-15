/**
 * Coquille applicative (sections 3, 20 et 31).
 *
 * - Contenu plein écran (la carte occupe 100 % de la zone de contenu sur l'Accueil).
 * - QUATRE entrées, et quatre seulement : Accueil · Explorer · Activités · Profil.
 *   L'ACCUEIL EST LA CARTE — il n'y a donc pas d'onglet « Carte » à côté : deux
 *   entrées pour la même expérience, c'est une hésitation, pas une navigation.
 *   « Signaler » n'est pas un onglet : c'est une ACTION, et elle vit en bouton
 *   flottant sur la carte de l'Accueil et pendant l'activité, là où on la
 *   déclenche vraiment.
 * - Écran ≥ 1024 px : les mêmes entrées dans une barre latérale gauche.
 * - Expose l'encombrement de la coquille aux surcouches fixes (feuille basse,
 *   toasts) via --shell-bottom / --shell-left sur <html>.
 * - Applique le thème, monte la bannière hors connexion et le veilleur d'alertes.
 */
import { useLayoutEffect, type ComponentType, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Compass, Footprints, Navigation2, UserRound } from "lucide-react";
import { fr } from "@mountain-live/core";
import type { LucideProps } from "lucide-react";
import { OfflineBanner } from "@/features/offline/OfflineBanner";
import { AlertsWatcher } from "@/features/alerts/AlertsWatcher";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatBadgeCount } from "@/lib/format";
import { useApplyTheme } from "@/lib/theme";
import { useIsAuthenticated } from "@/store/session";
import { useNavigationStore } from "@/features/navigation/store";
import { cn } from "@/components/ui/cn";
import { useIsDesktop } from "@/components/ui/hooks";

export interface NavEntry {
  key: "home" | "explore" | "activities" | "profile";
  to: string;
  label: string;
  icon: ComponentType<LucideProps>;
  /** Préfixes de chemin pour lesquels l'entrée est considérée active. */
  matches: readonly string[];
}

/**
 * Les quatre entrées, et leurs icônes — choisies pour Mountain Live, pas
 * reprises d'ailleurs :
 *
 *   Accueil    ▲ flèche de position : on est SUR la carte, orienté, en montagne
 *                (pas une maison : l'accueil n'est pas un salon, c'est le terrain)
 *   Explorer   ✦ boussole : on cherche où aller
 *   Activités  👣 empreintes : ce que l'on a réellement parcouru
 *   Profil     ◍ compte, préférences, contributions
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { key: "home", to: "/home", label: fr.nav.home, icon: Navigation2, matches: ["/home", "/navigate", "/map", "/around", "/reports"] },
  { key: "explore", to: "/explore", label: fr.nav.explore, icon: Compass, matches: ["/explore", "/community"] },
  { key: "activities", to: "/activities", label: fr.nav.activities, icon: Footprints, matches: ["/activities"] },
  { key: "profile", to: "/profile", label: fr.nav.profile, icon: UserRound, matches: ["/profile", "/notifications", "/offline"] },
];

export const REPORT_PATH = "/report";

/** L'entrée est-elle active pour ce chemin ? (préfixe exact ou suivi de « / ») */
export function isNavActive(entry: NavEntry, pathname: string): boolean {
  return entry.matches.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

/** Nombre de notifications non lues, uniquement pour un utilisateur connecté. */
function useUnreadCount(): number {
  const authenticated = useIsAuthenticated();
  const { data } = useQuery({
    queryKey: qk.notifications,
    queryFn: api.notifications.list,
    enabled: authenticated,
    select: (d) => d.unreadCount,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return authenticated ? (data ?? 0) : 0;
}

interface NavItemProps {
  entry: NavEntry;
  active: boolean;
  badge?: number;
  layout: "bottom" | "side";
}

function NavItem({ entry, active, badge = 0, layout }: NavItemProps) {
  const Icon = entry.icon;
  const count = formatBadgeCount(badge);
  return (
    <Link
      to={entry.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "ml-nav-item flex h-full w-full flex-col items-center justify-center gap-0.5 select-none rounded-lg",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:ring-inset",
        layout === "side" && "h-[72px] w-[72px]",
      )}
    >
      <span className="ml-nav-item__icon relative inline-flex h-8 w-14 items-center justify-center">
        <Icon className="size-6" strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
        {count ? (
          <span
            className="absolute -top-1 right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold leading-none text-accent-fg ring-2 ring-surface"
            aria-label={`${badge} ${badge > 1 ? "notifications non lues" : "notification non lue"}`}
          >
            {count}
          </span>
        ) : null}
      </span>
      <span className="text-[11px] font-semibold leading-none">{entry.label}</span>
    </Link>
  );
}

function BottomNav({ pathname, unread }: { pathname: string; unread: number }) {
  return (
    <nav
      aria-label="Navigation principale"
      className="glass-strong relative z-[var(--z-nav)] shrink-0 border-t border-line"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      {/* Quatre colonnes, pas de bouton central : « Signaler » est une action de
          la carte, pas une destination. */}
      <ul className="mx-auto grid h-[var(--nav-height)] max-w-2xl grid-cols-4 items-stretch px-1">
        {NAV_ENTRIES.map((entry) => (
          <li key={entry.key}>
            <NavItem entry={entry} active={isNavActive(entry, pathname)} badge={entry.key === "profile" ? unread : 0} layout="bottom" />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SideNav({ pathname, unread }: { pathname: string; unread: number }) {
  return (
    <nav
      aria-label="Navigation principale"
      className="glass-strong relative z-[var(--z-nav)] flex w-[var(--sidebar-width)] shrink-0 flex-col items-center border-r border-line"
      style={{ paddingTop: "calc(var(--safe-top) + 12px)", paddingBottom: "calc(var(--safe-bottom) + 12px)" }}
    >
      <Link to="/home" className="mb-4 inline-flex size-12 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40" aria-label={`${fr.appName} — ${fr.nav.home}`}>
        <img src="/icons/icon.svg" alt="" width={40} height={40} className="size-10 rounded-lg" />
      </Link>
      <ul className="flex flex-col items-center gap-1">
        {NAV_ENTRIES.map((entry) => (
          <li key={entry.key}>
            <NavItem entry={entry} active={isNavActive(entry, pathname)} badge={entry.key === "profile" ? unread : 0} layout="side" />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  useApplyTheme();
  const isDesktop = useIsDesktop();
  const { pathname } = useLocation();
  const unread = useUnreadCount();
  /*
   * MODE ACTIVITÉ : pendant une sortie, la barre disparaît pour de bon — elle
   * n'est pas seulement recouverte. Deux modes, jamais mélangés : on explore,
   * ou on marche. Changer d'onglet au milieu d'une randonnée n'a pas de sens,
   * et un onglet à moitié visible sous le panneau de statistiques encore moins.
   */
  const inActivity = useNavigationStore((s) => s.status === "running" || s.status === "paused");

  // Encombrement de la coquille pour les surcouches fixes (feuille basse, toasts).
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--shell-bottom", isDesktop || inActivity ? "var(--safe-bottom)" : "calc(var(--nav-height) + var(--safe-bottom))");
    root.setProperty("--shell-left", isDesktop ? "var(--sidebar-width)" : "0px");
    return () => {
      root.removeProperty("--shell-bottom");
      root.removeProperty("--shell-left");
    };
  }, [isDesktop, inActivity]);

  return (
    <div className={cn("flex h-full w-full bg-bg", isDesktop ? "flex-row" : "flex-col")} data-shell={isDesktop ? "desktop" : "mobile"}>
      <a href="#main" className="skip-link">
        Aller au contenu
      </a>
      {isDesktop && !inActivity ? <SideNav pathname={pathname} unread={unread} /> : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <main id="main" className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" tabIndex={-1}>
          {children}
        </main>
      </div>
      {!isDesktop && !inActivity ? <BottomNav pathname={pathname} unread={unread} /> : null}
      <AlertsWatcher />
    </div>
  );
}
