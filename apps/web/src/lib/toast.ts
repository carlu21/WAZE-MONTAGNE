/**
 * Système global de notifications éphémères (« toasts »).
 *
 * Le magasin est indépendant de React pour pouvoir être appelé depuis n'importe
 * où (file d'attente hors connexion, alertes de proximité, mutations) :
 *
 *   import { toast } from "@/lib/toast";
 *   toast.success("Signalement publié");
 *   toast.alert({ title: "Battue signalée à 600 m", action: { label: "Voir", onClick } });
 *
 * L'affichage est assuré par <ToastProvider /> (src/components/ui/Toast.tsx),
 * monté une seule fois dans App.tsx (autour du routeur, donc disponible aussi hors
 * de la coquille : connexion, assistant). Le hook `useToasts()` expose la liste.
 */
import { useSyncExternalStore, type ReactNode } from "react";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Identifiant stable : un nouvel appel avec le même id remplace le toast existant. */
  id?: string;
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Durée d'affichage en ms. 0 ou null = persistant (jusqu'à fermeture manuelle). */
  duration?: number | null;
  action?: ToastAction;
  /** Bouton de fermeture (défaut : true). */
  dismissible?: boolean;
  /** Icône personnalisée (par défaut : selon la tonalité). */
  icon?: ReactNode;
  /** Annoncé immédiatement par les lecteurs d'écran (défaut : true pour danger). */
  assertive?: boolean;
}

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  /** 0 = persistant. */
  duration: number;
  action?: ToastAction;
  dismissible: boolean;
  icon?: ReactNode;
  assertive: boolean;
  createdAt: number;
}

/** Durées par défaut (ms) selon la tonalité. */
export const TOAST_DURATIONS: Record<ToastTone, number> = {
  info: 4500,
  success: 4000,
  warning: 6500,
  danger: 8000,
};

/** Nombre maximal de toasts empilés (les plus anciens non persistants sont évincés). */
export const TOAST_MAX = 4;

type Listener = () => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function emit(): void {
  for (const l of listeners) l();
}

function nextId(): string {
  counter += 1;
  return `toast-${Date.now().toString(36)}-${counter}`;
}

function show(opts: ToastOptions): string {
  const tone = opts.tone ?? "info";
  const id = opts.id ?? nextId();
  const item: ToastItem = {
    id,
    title: opts.title,
    description: opts.description,
    tone,
    duration: opts.duration === null ? 0 : (opts.duration ?? TOAST_DURATIONS[tone]),
    action: opts.action,
    dismissible: opts.dismissible ?? true,
    icon: opts.icon,
    assertive: opts.assertive ?? tone === "danger",
    createdAt: Date.now(),
  };
  const without = items.filter((t) => t.id !== id);
  let next = [...without, item];
  // Éviction : on retire d'abord les plus anciens non persistants.
  while (next.length > TOAST_MAX) {
    const idx = next.findIndex((t) => t.duration > 0);
    if (idx === -1) break;
    next = [...next.slice(0, idx), ...next.slice(idx + 1)];
  }
  items = next;
  emit();
  return id;
}

function dismiss(id: string): void {
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

function clear(): void {
  if (items.length === 0) return;
  items = [];
  emit();
}

function update(id: string, patch: Partial<Omit<ToastOptions, "id">>): void {
  const existing = items.find((t) => t.id === id);
  if (!existing) return;
  items = items.map((t) =>
    t.id !== id
      ? t
      : {
          ...t,
          ...patch,
          tone: patch.tone ?? t.tone,
          duration: patch.duration === null ? 0 : (patch.duration ?? t.duration),
          dismissible: patch.dismissible ?? t.dismissible,
          assertive: patch.assertive ?? t.assertive,
        },
  );
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastItem[] {
  return items;
}

const EMPTY: ToastItem[] = [];
function getServerSnapshot(): ToastItem[] {
  return EMPTY;
}

type Shorthand = string | Omit<ToastOptions, "tone">;
function normalize(input: Shorthand, tone: ToastTone): ToastOptions {
  return typeof input === "string" ? { title: input, tone } : { ...input, tone };
}

/** API impérative globale. */
export const toast = {
  show,
  dismiss,
  clear,
  update,
  info: (input: Shorthand) => show(normalize(input, "info")),
  success: (input: Shorthand) => show(normalize(input, "success")),
  warning: (input: Shorthand) => show(normalize(input, "warning")),
  danger: (input: Shorthand) => show(normalize(input, "danger")),
  /**
   * Alerte de proximité (section 12) : persistante, tonalité warning par défaut,
   * avec une action (« Voir »). Reste affichée jusqu'à fermeture.
   */
  alert: (input: Omit<ToastOptions, "duration"> & { duration?: number | null }) =>
    show({ tone: "warning", ...input, duration: input.duration ?? 0 }),
  subscribe,
  getSnapshot,
};

export type ToastApi = typeof toast;

/** Liste réactive des toasts affichés. */
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
