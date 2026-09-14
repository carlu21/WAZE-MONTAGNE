/** Hooks utilitaires partagés par les composants du design system. */
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** Appelle `onEscape` sur la touche Échap tant que `active` est vrai. */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onEscape();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [active, onEscape]);
}

let scrollLocks = 0;
let previousOverflow = "";

/** Bloque le défilement de la page (modales, tiroirs). Réentrant. */
export function useLockBodyScroll(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    if (scrollLocks === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    scrollLocks += 1;
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null,
  );
}

export interface FocusTrapOptions {
  initialFocus?: RefObject<HTMLElement | null>;
  /** Rendre le focus à l'élément précédent à la fermeture (défaut : true). */
  restoreFocus?: boolean;
}

/** Piège le focus clavier dans `ref` tant que `active` est vrai (modales, tiroirs). */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, opts: FocusTrapOptions = {}): void {
  const { initialFocus, restoreFocus = true } = opts;
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const target = initialFocus?.current ?? focusables(root)[0] ?? root;
    // Laisser l'animation d'entrée démarrer avant de déplacer le focus.
    const raf = requestAnimationFrame(() => target.focus({ preventScroll: true }));

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const list = focusables(root);
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      if (restoreFocus && previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [active, ref, initialFocus, restoreFocus]);
}

/** Suit une media query (« (min-width: 1024px) »). false hors navigateur. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mq = window.matchMedia(query);
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
      }
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    },
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Point de rupture « écran large » où la barre basse devient une barre latérale. */
export const DESKTOP_QUERY = "(min-width: 1024px)";
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/**
 * Horloge partagée : retourne Date.now() rafraîchi toutes les `intervalMs`,
 * et au retour au premier plan (dates relatives, compte à rebours).
 */
export function useNow(intervalMs = 30_000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
  return now;
}
