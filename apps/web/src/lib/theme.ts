/**
 * Thème clair / sombre (section 20 : mode sombre complet).
 *
 * La préférence vit dans useUiStore().theme ("light" | "dark" | "system").
 * Ce module la résout en un thème effectif et l'applique sur <html data-theme>,
 * ce qui pilote tous les tokens de src/styles/tokens.css. En mode « system »,
 * on écoute `matchMedia("(prefers-color-scheme: dark)")` et on suit le système
 * en direct.
 */
import { useLayoutEffect, useSyncExternalStore } from "react";
import { useUiStore } from "@/store/ui";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Couleur de la barre système (meta theme-color) par thème effectif. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#1F4D28",
  dark: "#0F1613",
};

function mediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DARK_QUERY);
}

/** Le système est-il en mode sombre ? (false hors navigateur) */
export function systemPrefersDark(): boolean {
  return mediaQuery()?.matches ?? false;
}

/** Résout une préférence en thème effectif. */
export function resolveTheme(pref: ThemePreference, prefersDark: boolean = systemPrefersDark()): ResolvedTheme {
  if (pref === "system") return prefersDark ? "dark" : "light";
  return pref;
}

/**
 * Applique une préférence sur le document : attribut data-theme, color-scheme
 * et meta theme-color. Idempotent ; retourne le thème effectif.
 */
export function applyTheme(pref: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(pref);
  if (typeof document === "undefined") return resolved;
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  if (root.dataset.themePreference !== pref) root.dataset.themePreference = pref;
  root.style.colorScheme = resolved;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && meta.content !== THEME_COLOR[resolved]) meta.content = THEME_COLOR[resolved];
  return resolved;
}

/** Applique immédiatement la préférence enregistrée (utile avant le premier rendu). */
export function initTheme(): ResolvedTheme {
  return applyTheme(useUiStore.getState().theme);
}

function subscribeMedia(onChange: () => void): () => void {
  const mq = mediaQuery();
  if (!mq) return () => {};
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }
  // Safari < 14
  mq.addListener(onChange);
  return () => mq.removeListener(onChange);
}

/** Suit la préférence système en direct. */
export function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(subscribeMedia, systemPrefersDark, () => false);
}

/** Thème effectif courant (lecture seule, réactif). */
export function useResolvedTheme(): ResolvedTheme {
  const pref = useUiStore((s) => s.theme);
  const prefersDark = useSystemPrefersDark();
  return resolveTheme(pref, prefersDark);
}

/**
 * À monter UNE fois (AppShell) : synchronise <html data-theme> avec la
 * préférence de l'utilisateur et le système. Retourne le thème effectif.
 */
export function useApplyTheme(): ResolvedTheme {
  const pref = useUiStore((s) => s.theme);
  const prefersDark = useSystemPrefersDark();
  const resolved = resolveTheme(pref, prefersDark);
  useLayoutEffect(() => {
    applyTheme(pref);
  }, [pref, prefersDark]);
  return resolved;
}

/** Préférence suivante dans le cycle système → clair → sombre (bouton de bascule). */
export function nextThemePreference(pref: ThemePreference): ThemePreference {
  if (pref === "system") return "light";
  if (pref === "light") return "dark";
  return "system";
}

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "Automatique",
  light: "Clair",
  dark: "Sombre",
};
