/**
 * Assistant de signalement (sections 4 et 32) — état et logique pure.
 *
 * Tout ce qui ne dépend ni du DOM ni du réseau vit ici pour être testable :
 * le brouillon, son réducteur, les valeurs par défaut issues de la taxonomie
 * (niveau de danger, durée de validité, heure de fin), la construction du
 * `CreateReportInput` envoyé à l'API et la validation en français.
 */
import {
  CATEGORY_BY_ID,
  DANGER_LEVELS,
  SUBTYPE_BY_ID,
  createReportSchema,
  formatTtl,
  formatUntil,
  fr,
  minutesBetween,
  ttlOptions,
  type CreateReportInput,
  type DangerLevel,
  type Report,
  type ReportCategory,
  type ReportSubtype,
} from "@mountain-live/core";
import type { ZodIssue } from "zod";

/* ------------------------------------------------------------------ */
/* Étapes                                                              */
/* ------------------------------------------------------------------ */

export const WIZARD_STEPS = ["category", "subtype", "details", "done"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Étapes visibles dans l'indicateur (l'écran « done » n'en fait pas partie). */
export const PROGRESS_STEPS: readonly { step: WizardStep; label: string }[] = [
  { step: "category", label: "Catégorie" },
  { step: "subtype", label: "Type" },
  { step: "details", label: "Détails" },
];

export function parseStep(raw: string | undefined | null): WizardStep | null {
  return (WIZARD_STEPS as readonly string[]).includes(raw ?? "") ? (raw as WizardStep) : null;
}

/* ------------------------------------------------------------------ */
/* Brouillon                                                           */
/* ------------------------------------------------------------------ */

/** Origine du point : GPS de l'appareil ou centre de la dernière vue de la carte. */
export type PositionSource = "gps" | "map";

export interface DraftPosition {
  lat: number;
  lng: number;
  /** Précision GPS en mètres (null si inconnue ou point placé à la main). */
  accuracy: number | null;
  source: PositionSource;
  /** L'utilisateur a déplacé la carte pour ajuster le point. */
  adjusted: boolean;
}

export interface WizardDraft {
  category: ReportCategory | null;
  subtype: ReportSubtype | null;
  position: DraftPosition | null;
  dangerLevel: DangerLevel | null;
  /** Durée de validité choisie (sous-types sans heure de fin). */
  ttlMinutes: number | null;
  /** Heure de fin locale au format `datetime-local` (AAAA-MM-JJTHH:MM), sous-types askEndTime. */
  endsAtLocal: string | null;
  description: string;
  /** Photo réduite, prête à l'envoi (jamais sérialisée). */
  photo: Blob | null;
  /** Identifiant local : idempotence de l'API et clé de la file hors connexion. */
  clientId: string;
}

export const DESCRIPTION_MAX = 600;
export const DEFAULT_DANGER_LEVEL: DangerLevel = "moderate";

export function createDraft(clientId: string): WizardDraft {
  return {
    category: null,
    subtype: null,
    position: null,
    dangerLevel: null,
    ttlMinutes: null,
    endsAtLocal: null,
    description: "",
    photo: null,
    clientId,
  };
}

/* ------------------------------------------------------------------ */
/* Valeurs par défaut issues de la taxonomie                           */
/* ------------------------------------------------------------------ */

/** Durée par défaut du sous-type (toujours présente dans `ttlOptions`). */
export function defaultTtlMinutes(subtype: ReportSubtype): number {
  return SUBTYPE_BY_ID[subtype].defaultTtlMin;
}

/** Arrondit à la prochaine tranche de 15 minutes (heure de fin lisible : 15 h 15 plutôt que 15 h 07). */
export function roundUpToQuarter(date: Date): Date {
  const d = new Date(date.getTime());
  d.setSeconds(0, 0);
  const rest = d.getMinutes() % 15;
  if (rest !== 0) d.setMinutes(d.getMinutes() + (15 - rest));
  return d;
}

/**
 * Heure de fin proposée pour les sous-types qui en demandent une : maintenant
 * + durée par défaut de la taxonomie (chasse / battue : +6 h ; fermeture,
 * travaux : +7 j ; restriction d'accès : +14 j…), arrondie au quart d'heure.
 */
export function defaultEndsAt(subtype: ReportSubtype, now: Date = new Date()): Date {
  return roundUpToQuarter(new Date(now.getTime() + defaultTtlMinutes(subtype) * 60_000));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Date → valeur d'un `<input type="datetime-local">` (heure locale de l'appareil). */
export function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Valeur d'un `datetime-local` → Date locale, ou null si invalide. */
export function fromLocalInputValue(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Applique un sous-type au brouillon avec ses valeurs par défaut (sans toucher position, photo, commentaire). */
export function applySubtype(draft: WizardDraft, subtype: ReportSubtype, now: Date = new Date()): WizardDraft {
  const def = SUBTYPE_BY_ID[subtype];
  return {
    ...draft,
    category: def.category,
    subtype,
    dangerLevel: def.askDangerLevel ? DEFAULT_DANGER_LEVEL : null,
    ttlMinutes: def.askEndTime ? null : defaultTtlMinutes(subtype),
    endsAtLocal: def.askEndTime ? toLocalInputValue(defaultEndsAt(subtype, now)) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Réducteur                                                           */
/* ------------------------------------------------------------------ */

export type DraftAction =
  | { type: "reset"; draft: WizardDraft }
  | { type: "category"; category: ReportCategory }
  | { type: "subtype"; subtype: ReportSubtype; now?: Date }
  | { type: "position"; position: DraftPosition | null }
  | { type: "dangerLevel"; dangerLevel: DangerLevel }
  | { type: "ttl"; ttlMinutes: number }
  | { type: "endsAt"; endsAtLocal: string }
  | { type: "description"; description: string }
  | { type: "photo"; photo: Blob | null };

export function draftReducer(draft: WizardDraft, action: DraftAction): WizardDraft {
  switch (action.type) {
    case "reset":
      return action.draft;
    case "category": {
      if (draft.category === action.category) return draft;
      // Changer de catégorie invalide le sous-type et ses champs dérivés ; position, photo et commentaire sont conservés.
      return { ...draft, category: action.category, subtype: null, dangerLevel: null, ttlMinutes: null, endsAtLocal: null };
    }
    case "subtype":
      return applySubtype(draft, action.subtype, action.now);
    case "position":
      return { ...draft, position: action.position };
    case "dangerLevel":
      return { ...draft, dangerLevel: action.dangerLevel };
    case "ttl":
      return { ...draft, ttlMinutes: action.ttlMinutes };
    case "endsAt":
      return { ...draft, endsAtLocal: action.endsAtLocal };
    case "description":
      return { ...draft, description: action.description.slice(0, DESCRIPTION_MAX) };
    case "photo":
      return { ...draft, photo: action.photo };
    default:
      return draft;
  }
}

/* ------------------------------------------------------------------ */
/* Position                                                            */
/* ------------------------------------------------------------------ */

function isFiniteCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Une position est publiable si elle vient du GPS, ou si l'utilisateur a
 * lui-même placé le point (le centre de la dernière vue n'est qu'un point de
 * départ : à faible zoom, il ne désigne rien de précis).
 */
export function isPositionValid(position: DraftPosition | null | undefined): position is DraftPosition {
  if (!position || !isFiniteCoord(position.lat, position.lng)) return false;
  return position.source === "gps" || position.adjusted;
}

/* ------------------------------------------------------------------ */
/* Construction de la requête et validation                            */
/* ------------------------------------------------------------------ */

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Construit le corps de POST /reports à partir du brouillon.
 * - dangerLevel uniquement pour les sous-types qui le demandent ;
 * - endsAt (ISO UTC) pour les sous-types à heure de fin, sinon ttlMinutes ;
 * - commentaire nettoyé (omis si vide) ; coordonnées arrondies à 1e-6° (~10 cm).
 * Renvoie null si le brouillon est incomplet (pas de sous-type ou de position).
 */
export function buildCreateReportInput(draft: WizardDraft): CreateReportInput | null {
  if (!draft.subtype || !draft.position) return null;
  const def = SUBTYPE_BY_ID[draft.subtype];
  const input: CreateReportInput = {
    subtype: draft.subtype,
    lat: round6(draft.position.lat),
    lng: round6(draft.position.lng),
    clientId: draft.clientId,
  };
  if (def.askDangerLevel && draft.dangerLevel) input.dangerLevel = draft.dangerLevel;
  if (def.askEndTime) {
    const end = fromLocalInputValue(draft.endsAtLocal);
    if (end) input.endsAt = end.toISOString();
  } else {
    input.ttlMinutes = draft.ttlMinutes ?? defaultTtlMinutes(draft.subtype);
  }
  const description = draft.description.trim();
  if (description) input.description = description;
  return input;
}

export interface DraftErrors {
  subtype?: string;
  position?: string;
  dangerLevel?: string;
  endsAt?: string;
  ttlMinutes?: string;
  description?: string;
  /** Erreur non rattachée à un champ. */
  form?: string;
}

export const DRAFT_MESSAGES = {
  subtype: "Choisissez le type de signalement.",
  positionMissing: fr.wizard.needLocation,
  positionToAdjust: "Précisez la position : déplacez la carte pour placer le point.",
  dangerLevel: "Choisissez un niveau de danger.",
  endsAtInvalid: "Indiquez une heure de fin valide.",
  endsAtPast: "L'heure de fin doit être dans le futur.",
  ttl: "Choisissez une durée de validité.",
  descriptionTooLong: `Le commentaire ne doit pas dépasser ${DESCRIPTION_MAX} caractères.`,
  generic: fr.errors.validation,
} as const;

/** Traduit les problèmes zod de `createReportSchema` en messages français par champ. */
export function issuesToErrors(issues: readonly ZodIssue[]): DraftErrors {
  const errors: DraftErrors = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "");
    switch (field) {
      case "lat":
      case "lng":
        errors.position ??= DRAFT_MESSAGES.positionMissing;
        break;
      case "subtype":
        errors.subtype ??= DRAFT_MESSAGES.subtype;
        break;
      case "dangerLevel":
        errors.dangerLevel ??= DRAFT_MESSAGES.dangerLevel;
        break;
      case "endsAt":
        errors.endsAt ??= DRAFT_MESSAGES.endsAtInvalid;
        break;
      case "ttlMinutes":
        errors.ttlMinutes ??= DRAFT_MESSAGES.ttl;
        break;
      case "description":
        errors.description ??= DRAFT_MESSAGES.descriptionTooLong;
        break;
      default:
        errors.form ??= DRAFT_MESSAGES.generic;
    }
  }
  return errors;
}

export type DraftValidation = { ok: true; input: CreateReportInput } | { ok: false; errors: DraftErrors };

/** Validation complète du brouillon (schéma partagé + règles métier de l'assistant). */
export function validateDraft(draft: WizardDraft, now: Date = new Date()): DraftValidation {
  const errors: DraftErrors = {};
  if (!draft.subtype) errors.subtype = DRAFT_MESSAGES.subtype;
  if (!draft.position) errors.position = DRAFT_MESSAGES.positionMissing;
  else if (!isPositionValid(draft.position)) errors.position = DRAFT_MESSAGES.positionToAdjust;

  const input = buildCreateReportInput(draft);
  if (!input) return { ok: false, errors: Object.keys(errors).length ? errors : { form: DRAFT_MESSAGES.generic } };

  const parsed = createReportSchema.safeParse(input);
  if (!parsed.success) Object.assign(errors, { ...issuesToErrors(parsed.error.issues), ...errors });

  if (draft.subtype) {
    const def = SUBTYPE_BY_ID[draft.subtype];
    if (def.askEndTime) {
      const end = fromLocalInputValue(draft.endsAtLocal);
      if (!end) errors.endsAt ??= DRAFT_MESSAGES.endsAtInvalid;
      else if (end.getTime() <= now.getTime() + 60_000) errors.endsAt = DRAFT_MESSAGES.endsAtPast;
    }
    if (def.askDangerLevel && !draft.dangerLevel) errors.dangerLevel ??= DRAFT_MESSAGES.dangerLevel;
  }
  if (draft.description.length > DESCRIPTION_MAX) errors.description ??= DRAFT_MESSAGES.descriptionTooLong;

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, input: parsed.success ? (parsed.data as CreateReportInput) : input };
}

/* ------------------------------------------------------------------ */
/* Libellés                                                            */
/* ------------------------------------------------------------------ */

export const DANGER_LEVEL_OPTIONS = DANGER_LEVELS;

/** Options de durée d'un sous-type (ré-export pratique pour les écrans). */
export function ttlChoices(subtype: ReportSubtype): { minutes: number; label: string }[] {
  return ttlOptions(subtype);
}

/** « Ce signalement expirera automatiquement dans 5 j ». */
export function expiryText(ttlMinutes: number): string {
  return `Ce signalement expirera automatiquement dans ${formatTtl(ttlMinutes)}.`;
}

/** « Visible pendant 5 j » / « Visible jusqu'à 15 h 15 » d'après le brouillon (écran de confirmation hors connexion). */
export function validityLabelForDraft(draft: WizardDraft, now: Date = new Date()): string {
  if (!draft.subtype) return "";
  const def = SUBTYPE_BY_ID[draft.subtype];
  if (def.askEndTime) {
    const end = fromLocalInputValue(draft.endsAtLocal);
    return end ? `Visible ${formatUntil(end, now)}` : "";
  }
  return `Visible pendant ${formatTtl(draft.ttlMinutes ?? defaultTtlMinutes(draft.subtype))}`;
}

/** Même libellé, d'après le signalement renvoyé par l'API. */
export function validityLabelForReport(report: Pick<Report, "expiresAt" | "endsAt">, now: Date = new Date()): string {
  if (report.endsAt) return `Visible ${formatUntil(report.endsAt, now)}`;
  const minutes = Math.max(1, Math.round(minutesBetween(now, report.expiresAt)));
  return `Visible pendant ${formatTtl(minutes)}`;
}

export function categoryLabel(category: ReportCategory | null | undefined): string {
  return category ? CATEGORY_BY_ID[category].label : "";
}

export function subtypeLabel(subtype: ReportSubtype | null | undefined): string {
  return subtype ? SUBTYPE_BY_ID[subtype].label : "";
}
