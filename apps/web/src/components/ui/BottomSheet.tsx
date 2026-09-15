/**
 * Feuille basse glissante posée sur la carte (fiche de signalement, liste
 * « autour de moi », filtres…).
 *
 * - Trois paliers : « peek » (aperçu, la carte reste utilisable), « half », « full ».
 * - Glissement au doigt (poignée, en-tête ou contenu quand il est en haut),
 *   glissement sous le palier bas = fermeture, bouton Fermer, touche Échap.
 * - Respecte la zone sûre et l'encombrement de la coquille (--shell-bottom).
 * - role="dialog" ; le voile et aria-modal n'apparaissent qu'en plein écran.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { portalRoot } from "@/lib/portal";
import { X } from "lucide-react";
import { cn } from "./cn";
import { IconButton } from "./Button";
import { useEscapeKey } from "./hooks";

export type SheetSnap = "peek" | "half" | "full";
export const SHEET_SNAPS: readonly SheetSnap[] = ["peek", "half", "full"];

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Palier contrôlé. */
  snap?: SheetSnap;
  /** Palier initial (mode non contrôlé). Défaut : « half ». */
  defaultSnap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  /**
   * Hauteur de chaque palier : > 1 = pixels, ≤ 1 = fraction de la hauteur disponible.
   * Défaut : peek 148 px, half 50 %, full 100 % (moins la zone sûre haute).
   */
  snapPoints?: Partial<Record<SheetSnap, number>>;
  /** Paliers autorisés (défaut : les trois). */
  snaps?: readonly SheetSnap[];
  title?: ReactNode;
  subtitle?: ReactNode;
  /** En-tête personnalisé (remplace titre / sous-titre / bouton Fermer). */
  header?: ReactNode;
  /** Zone d'actions collée en bas de la feuille. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  "aria-label"?: string;
  /** Voile sombre : jamais, seulement au palier « full » (défaut), toujours. */
  backdrop?: "none" | "full" | "always";
  /** Glisser sous le palier bas ou toucher le voile ferme la feuille (défaut : true). */
  dismissible?: boolean;
  showClose?: boolean;
  id?: string;
}

const DEFAULT_POINTS: Record<SheetSnap, number> = { peek: 148, half: 0.5, full: 1 };
/** Marge conservée au-dessus de la feuille en plein écran. */
const FULL_TOP_GAP = 12;
/** Vitesse (px/ms) à partir de laquelle un geste est un « flick ». */
const FLICK_VELOCITY = 0.5;
/** Déplacement (px) avant de décider si un toucher sur le contenu déplace la feuille. */
const DRAG_THRESHOLD = 8;

function readPx(el: HTMLElement | null, prop: "paddingTop" | "paddingBottom"): number {
  if (!el) return 0;
  const v = parseFloat(getComputedStyle(el)[prop]);
  return Number.isFinite(v) ? v : 0;
}

interface DragState {
  startY: number;
  startH: number;
  lastY: number;
  lastT: number;
  velocity: number;
}

export function BottomSheet({
  open,
  onClose,
  snap: controlledSnap,
  defaultSnap = "half",
  onSnapChange,
  snapPoints,
  snaps = SHEET_SNAPS,
  title,
  subtitle,
  header,
  footer,
  children,
  className,
  contentClassName,
  "aria-label": ariaLabel,
  backdrop = "full",
  dismissible = true,
  showClose = true,
  id,
}: BottomSheetProps) {
  const labelId = useId();
  const [uncontrolled, setUncontrolled] = useState<SheetSnap>(defaultSnap);
  const snap = controlledSnap ?? uncontrolled;
  const setSnap = useCallback(
    (s: SheetSnap) => {
      if (controlledSnap === undefined) setUncontrolled(s);
      onSnapChange?.(s);
    },
    [controlledSnap, onSnapChange],
  );

  // À la fermeture, on revient au palier par défaut pour la prochaine ouverture.
  useEffect(() => {
    if (!open) setUncontrolled(defaultSnap);
  }, [open, defaultSnap]);

  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ viewport: 0, safeTop: 0, shellBottom: 0 });
  const [dragging, setDragging] = useState(false);

  const measure = useCallback(() => {
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    setMetrics({
      viewport,
      safeTop: readPx(probeRef.current, "paddingTop"),
      shellBottom: readPx(probeRef.current, "paddingBottom"),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [open, measure]);

  const maxHeight = Math.max(0, metrics.viewport - metrics.shellBottom - metrics.safeTop - FULL_TOP_GAP);

  const heightFor = useCallback(
    (s: SheetSnap): number => {
      const raw = snapPoints?.[s] ?? DEFAULT_POINTS[s];
      const px = raw <= 1 ? raw * maxHeight : raw;
      return Math.min(Math.max(0, px), maxHeight);
    },
    [snapPoints, maxHeight],
  );

  const orderedSnaps = useMemo(() => SHEET_SNAPS.filter((s) => snaps.includes(s)), [snaps]);
  const lowest = orderedSnaps[0] ?? "peek";
  const highest = orderedSnaps[orderedSnaps.length - 1] ?? "full";

  /* ---------------- Glissement ---------------- */
  const drag = useRef<DragState | null>(null);

  const setPanelHeight = (h: number) => {
    const el = panelRef.current;
    if (el) el.style.height = `${Math.round(h)}px`;
  };

  const beginDrag = useCallback((y: number) => {
    const el = panelRef.current;
    if (!el) return;
    drag.current = { startY: y, startH: el.getBoundingClientRect().height, lastY: y, lastT: performance.now(), velocity: 0 };
    setDragging(true);
  }, []);

  const moveDrag = useCallback(
    (y: number) => {
      const d = drag.current;
      if (!d) return;
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT);
      d.velocity = (y - d.lastY) / dt;
      d.lastY = y;
      d.lastT = now;
      const target = d.startH - (y - d.startY);
      // Résistance élastique au-delà du plein écran.
      const h = target > maxHeight ? maxHeight + (target - maxHeight) * 0.2 : Math.max(0, target);
      setPanelHeight(h);
    },
    [maxHeight],
  );

  const settle = useCallback(
    (h: number, velocity: number) => {
      const list = orderedSnaps.map((s) => ({ s, h: heightFor(s) }));
      if (list.length === 0) return;
      const idx = Math.max(0, list.findIndex((x) => x.s === snap));
      let target: SheetSnap | "close";
      if (Math.abs(velocity) > FLICK_VELOCITY) {
        // Geste vif : palier suivant dans le sens du geste (vers le bas = fermeture au palier bas).
        if (velocity > 0) target = idx === 0 ? (dismissible ? "close" : list[0].s) : list[idx - 1].s;
        else target = list[Math.min(list.length - 1, idx + 1)].s;
      } else if (dismissible && h < list[0].h * 0.55) {
        target = "close";
      } else {
        target = list.reduce((best, x) => (Math.abs(x.h - h) < Math.abs(best.h - h) ? x : best), list[0]).s;
      }
      const el = panelRef.current;
      if (target === "close") {
        if (el) el.style.height = "";
        onClose();
        return;
      }
      if (el) el.style.height = `${Math.round(heightFor(target))}px`;
      setSnap(target);
    },
    [orderedSnaps, heightFor, snap, dismissible, onClose, setSnap],
  );

  const endDrag = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    const el = panelRef.current;
    settle(el ? el.getBoundingClientRect().height : d.startH, d.velocity);
  }, [settle]);

  // Poignée et en-tête : événements pointeur (souris et tactile).
  const onHandlePointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    beginDrag(e.clientY);
  };
  const onHandlePointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    e.preventDefault();
    moveDrag(e.clientY);
  };
  const onHandlePointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* déjà relâché */
    }
    endDrag();
  };

  // Contenu : événements tactiles natifs (non passifs) pour arbitrer entre
  // défilement du contenu et déplacement de la feuille.
  useEffect(() => {
    const el = contentRef.current;
    if (!open || !el) return;
    let startY = 0;
    let decided = false;
    let moving = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      decided = false;
      moving = false;
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      if (!decided) {
        const dy = y - startY;
        if (Math.abs(dy) < DRAG_THRESHOLD) return;
        decided = true;
        const atTop = el.scrollTop <= 0;
        const canGrow = snap !== highest;
        // Vers le bas quand le contenu est en haut, ou vers le haut quand la feuille peut grandir.
        moving = (dy > 0 && atTop) || (dy < 0 && canGrow);
        if (moving) beginDrag(y);
      }
      if (!moving) return;
      if (e.cancelable) e.preventDefault();
      moveDrag(y);
    };
    const onEnd = () => {
      if (moving) endDrag();
      moving = false;
      decided = false;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [open, snap, highest, beginDrag, moveDrag, endDrag]);

  /* ---------------- Clavier et focus ---------------- */
  const stepSnap = useCallback(
    (direction: 1 | -1) => {
      const idx = orderedSnaps.indexOf(snap);
      const next = idx + direction;
      if (next < 0) {
        if (dismissible) onClose();
        return;
      }
      if (next >= orderedSnaps.length) return;
      setSnap(orderedSnaps[next]);
    },
    [orderedSnaps, snap, dismissible, onClose, setSnap],
  );

  const onHandleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      stepSnap(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      stepSnap(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setSnap(highest);
    } else if (e.key === "End") {
      e.preventDefault();
      setSnap(lowest);
    }
  };

  const backdropVisible = open && (backdrop === "always" || (backdrop === "full" && snap === "full"));

  useEscapeKey(
    open,
    useCallback(() => {
      if (dismissible) onClose();
      else setSnap(lowest);
    }, [dismissible, onClose, setSnap, lowest]),
  );

  // Focus dans la feuille quand elle est modale (plein écran ou voile permanent).
  useEffect(() => {
    if (!backdropVisible) return;
    const el = panelRef.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [backdropVisible]);

  // Le contenu remonte en haut quand on revient à l'aperçu.
  useEffect(() => {
    if (snap === "peek" && contentRef.current) contentRef.current.scrollTop = 0;
  }, [snap]);

  if (!open || typeof document === "undefined") return null;

  const onBackdropClick = () => {
    if (dismissible) onClose();
    else setSnap(lowest);
  };

  const panelStyle: CSSProperties = {
    height: heightFor(snap),
    transitionTimingFunction: "var(--ease)",
  };

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[var(--z-sheet)]"
      style={{ bottom: "var(--shell-bottom)", left: "var(--shell-left)" }}
      data-bottom-sheet=""
    >
      {/* Sonde de mesure : résout env() et --shell-bottom en pixels. */}
      <div
        ref={probeRef}
        aria-hidden="true"
        className="invisible absolute h-0 w-0"
        style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--shell-bottom)" }}
      />
      {backdropVisible ? (
        <div
          className="anim-fade-in pointer-events-auto absolute inset-0"
          style={{ background: "var(--scrim)" }}
          onClick={onBackdropClick}
          aria-hidden="true"
        />
      ) : null}
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal={backdropVisible || undefined}
        aria-labelledby={title && !header ? labelId : undefined}
        aria-label={ariaLabel ?? (title || header ? undefined : "Panneau")}
        tabIndex={-1}
        data-snap={snap}
        data-dragging={dragging || undefined}
        className={cn(
          "anim-slide-up pointer-events-auto absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-2xl flex-col rounded-t-3xl bg-surface shadow-lg outline-none",
          !dragging && "transition-[height] duration-300",
          className,
        )}
        style={panelStyle}
      >
        <div
          className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <button
            type="button"
            className="flex h-8 w-full items-center justify-center rounded-t-3xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
            aria-label="Redimensionner le panneau"
            aria-keyshortcuts="ArrowUp ArrowDown"
            onKeyDown={onHandleKeyDown}
          >
            <span className="ml-sheet-handle" aria-hidden="true" />
          </button>
          {header ??
            (title || subtitle || showClose ? (
              <div className="flex items-start gap-3 px-4 pb-3">
                <div className="min-w-0 flex-1 pt-1">
                  {title ? (
                    <h2 id={labelId} className="truncate text-lg font-bold leading-tight text-fg">
                      {title}
                    </h2>
                  ) : null}
                  {subtitle ? <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p> : null}
                </div>
                {showClose ? (
                  <IconButton aria-label="Fermer" size={44} variant="ghost" onClick={onClose} className="-mr-2 -mt-1">
                    <X />
                  </IconButton>
                ) : null}
              </div>
            ) : null)}
        </div>
        <div
          ref={contentRef}
          className={cn(
            "min-h-0 flex-1 overscroll-contain",
            snap === "peek" ? "overflow-hidden" : "overflow-y-auto",
            contentClassName,
          )}
        >
          {children}
        </div>
        {footer ? <div className="shrink-0 border-t border-line bg-surface px-4 py-3">{footer}</div> : null}
      </div>
    </div>, portalRoot());
}
