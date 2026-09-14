/**
 * Persistance légère du brouillon dans sessionStorage : survit à un
 * rafraîchissement ou à un détour par l'écran de connexion (401 pendant la
 * publication), sans jamais stocker la photo (Blob) ni survivre à la session.
 */
import { isCategory, isSubtype, type DangerLevel } from "@mountain-live/core";
import { DESCRIPTION_MAX, type DraftPosition, type WizardDraft } from "./wizardState";

export const DRAFT_STORAGE_KEY = "ml.report.draft";
/** Un brouillon plus ancien est ignoré (la situation a probablement changé). */
export const DRAFT_MAX_AGE_MS = 30 * 60_000;

type StoredDraft = Omit<WizardDraft, "photo"> & { savedAt: number };

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function saveDraft(draft: WizardDraft): void {
  const s = storage();
  if (!s) return;
  try {
    const { photo: _photo, ...rest } = draft;
    const stored: StoredDraft = { ...rest, savedAt: Date.now() };
    s.setItem(DRAFT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* quota ou stockage bloqué : sans conséquence */
  }
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    /* ignoré */
  }
}

const DANGER: readonly string[] = ["low", "moderate", "high", "critical"];

function sanitizePosition(raw: unknown): DraftPosition | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<DraftPosition>;
  if (typeof p.lat !== "number" || typeof p.lng !== "number" || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  return {
    lat: p.lat,
    lng: p.lng,
    accuracy: typeof p.accuracy === "number" && Number.isFinite(p.accuracy) ? p.accuracy : null,
    source: p.source === "gps" ? "gps" : "map",
    adjusted: Boolean(p.adjusted),
  };
}

/** Relit un brouillon récent et cohérent, ou null. */
export function loadDraft(now: number = Date.now(), maxAgeMs: number = DRAFT_MAX_AGE_MS): WizardDraft | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof data.savedAt !== "number" || now - data.savedAt > maxAgeMs) return null;
    if (typeof data.clientId !== "string" || !data.clientId) return null;
    const subtype = typeof data.subtype === "string" && isSubtype(data.subtype) ? data.subtype : null;
    const category = typeof data.category === "string" && isCategory(data.category) ? data.category : null;
    return {
      category: subtype ? category : category,
      subtype,
      position: sanitizePosition(data.position),
      dangerLevel: typeof data.dangerLevel === "string" && DANGER.includes(data.dangerLevel) ? (data.dangerLevel as DangerLevel) : null,
      ttlMinutes: typeof data.ttlMinutes === "number" && Number.isFinite(data.ttlMinutes) ? data.ttlMinutes : null,
      endsAtLocal: typeof data.endsAtLocal === "string" ? data.endsAtLocal : null,
      description: typeof data.description === "string" ? data.description.slice(0, DESCRIPTION_MAX) : "",
      photo: null,
      clientId: data.clientId,
    };
  } catch {
    return null;
  }
}
