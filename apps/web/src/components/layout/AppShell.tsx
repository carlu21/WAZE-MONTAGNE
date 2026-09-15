/**
 * Coquille applicative (sections 3, 20 et 31).
 *
 * - Contenu plein écran (la carte peut occuper 100 % de la zone de contenu).
 * - Mobile : barre de navigation basse à 5 entrées (Itinéraire, Carte, Signaler,
 *   Explorer, Profil) avec le bouton flottant central « + Signaler ».
 * - Écran ≥ 1024 px : les mêmes entrées dans une barre latérale gauche.
 * - Expose l'encombrement de la coquille aux surcouches fixes (feuille basse,
 *   toasts) via --shell-bottom / --shell-left sur <html>.
 * - Applique le thème, monte la bannière hors connexion et le veilleur d'alertes.
 */
import { useLayoutEffect, type ComponentType, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Compass, Map as MapIcon, Navigation2, UserRound } from "lucide-react";
import { fr } from "@mountain-live/core";
import type { LucideProps } from "lucide-react";
import { OfflineBanner } from "@/features/offline/OfflineBanner";
import { AlertsWatcher } from "@/features/alerts/AlertsWatcher";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { formatBadgeCount } from "@/lib/format";
import { useApplyTheme } from "@/lib/theme";
import { useIsAuthenticated } from "@/store/session";
import { cn } from "@/components/ui/cn";
import { Fab } from "@/components/ui/Button";
import { useIsDesktop } from "@/components/ui/hooks";

export interface NavEntry {
  key: "home" | "map" | "explore" | "profile";
  to: string;
  label: string;
  icon: ComponentType<LucideProps>;
  /** Préfixes de chemin pour lesquels l'entrée est considérée active. */
  matches: readonly string[];
}

/**
 * Les quatre entrées de navigation ; « Signaler » est le bouton flottant central.
 * « Accueil » est LA carte : l'application s'ouvre dessus, avec la position et les
 * randonnées alentour. La communauté est accessible depuis Explorer et Profil.
 */
export const NAV_ENTRIES: readonly NavEntry[] = [
  { key: "home", to: "/home", label: "Accueil", icon: Navigation2, matches: ["/home", "/navigate"] },
  { key: "map", to: "/map", label: fr.nav.map, icon: MapIcon, matches: ["/map", "/around", "/reports"] },
  { key: "explore", to: "/explore", label: fr.nav.explore, icon: Compass, matches: ["/explore", "/community"] },
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

/**
 * Écrans qui portent DÉJÀ leur propre bouton « Signaler », posé sur la carte à
 * portée de pouce. La barre y renonce au sien : deux boutons identiques sur le
 * même écran, c'est la surcharge qu'on cherche à éviter.
 */
export const ROUTES_WITH_OWN_REPORT: readonly string[] = ["/home"];

export function ownsReportAction(pathname: string): boolean {
  return ROUTES_WITH_OWN_REPORT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function BottomNav({ pathname, unread }: { pathname: string; unread: number }) {
  const [navigateEntry, map, explore, profile] = NAV_ENTRIES;
  const ownReport = ownsReportAction(pathname);
  return (
    <nav
      aria-label="Navigation principale"
      className="glass-strong relative z-[var(--z-nav)] shrink-0 border-t border-line"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <ul className={cn("mx-auto grid h-[var(--nav-height)] max-w-2xl items-stretch px-1", ownReport ? "grid-cols-4" : "grid-cols-5")}>
        <li>
          <NavItem entry={navigateEntry} active={isNavActive(navigateEntry, pathname)} layout="bottom" />
        </li>
        <li>
          <NavItem entry={map} active={isNavActive(map, pathname)} layout="bottom" />
        </li>
        {!ownReport && (
        <li className="relative flex flex-col items-center justify-end pb-1.5">
          <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-[22px]">
            <Fab to={REPORT_PATH} label={fr.nav.report} />
          </span>
          <span className="text-[11px] font-semibold leading-none text-accent" aria-hidden="true">
            {fr.nav.report}
          </span>
        </li>
        )}
        <li>
          <NavItem entry={explore} active={isNavActive(explore, pathname)} layout="bottom" />
        </li>
        <li>
          <NavItem entry={profile} active={isNavActive(profile, pathname)} badge={unread} layout="bottom" />
        </li>
      </ul>
    </nav>
  );
}

function SideNav({ pathname, unread }: { pathname: string; unread: number }) {
  const [navigateEntry, map, explore, profile] = NAV_ENTRIES;
  const item = (entry: NavEntry, badge?: number) => (
    <li key={entry.key}>
      <NavItem entry={entry} active={isNavActive(entry, pathname)} badge={badge} layout="side" />
    </li>
  );
  return (
    <nav
      aria-label="Navigation principale"
      className="glass-strong relative z-[var(--z-nav)] flex w-[var(--sidebar-width)] shrink-0 flex-col items-center border-r border-line"
      style={{ paddingTop: "calc(var(--safe-top) + 12px)", paddingBottom: "calc(var(--safe-bottom) + 12px)" }}
    >
      <Link to="/home" className="mb-4 inline-flex size-12 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40" aria-label={`${fr.appName} — ${fr.nav.map}`}>
        <img src="/icons/icon.svg" alt="" width={40} height={40} className="size-10 rounded-lg" />
      </Link>
      <ul className="flex flex-col items-center gap-1">
        {item(navigateEntry)}
        {item(map)}
        <li className="my-2 flex flex-col items-center gap-1.5">
          <Fab to={REPORT_PATH} label={fr.nav.report} />
          <span className="text-[11px] font-semibold leading-none text-accent" aria-hidden="true">
            {fr.nav.report}
          </span>
        </li>
        {item(explore)}
        {item(profile, unread)}
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

  // Encombrement de la coquille pour les surcouches fixes (feuille basse, toasts).
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--shell-bottom", isDesktop ? "var(--safe-bottom)" : "calc(var(--nav-height) + var(--safe-bottom))");
    root.setProperty("--shell-left", isDesktop ? "var(--sidebar-width)" : "0px");
    return () => {
      root.removeProperty("--shell-bottom");
      root.removeProperty("--shell-left");
    };
  }, [isDesktop]);

  return (
    <div className={cn("flex h-full w-full bg-bg", isDesktop ? "flex-row" : "flex-col")} data-shell={isDesktop ? "desktop" : "mobile"}>
      <a href="#main" className="skip-link">
        Aller au contenu
      </a>
      {isDesktop ? <SideNav pathname={pathname} unread={unread} /> : null}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <main id="main" className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" tabIndex={-1}>
          {children}
        </main>
      </div>
      {!isDesktop ? <BottomNav pathname={pathname} unread={unread} /> : null}
      <AlertsWatcher />
    </div>
  );
}
