/**
 * Publication d'un signalement : en ligne → POST /reports puis photo ;
 * hors connexion (ou échec réseau) → file d'attente locale (outbox), rejouée
 * au retour du réseau grâce au clientId (idempotence côté API).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fr, isSubtype, type CreateReportInput, type Report } from "@mountain-live/core";
import { ApiError, api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { enqueueReport } from "@/lib/outbox";
import { useUiStore } from "@/store/ui";
import { recordSubtypeUse } from "./frequentSubtypes";
import { DRAFT_MESSAGES, type DraftErrors } from "./wizardState";

export type PublishOutcome =
  | { kind: "published"; report: Report; photoError: string | null }
  | { kind: "queued"; clientId: string };

export interface PublishArgs {
  input: CreateReportInput;
  photo: Blob | null;
}

export const PHOTO_UPLOAD_MESSAGES = {
  tooLarge: "Photo trop volumineuse (5 Mo maximum).",
  unsupported: "Format de photo non pris en charge (JPEG, PNG ou WebP).",
  generic: "La photo n'a pas pu être envoyée.",
} as const;

/** Échec réseau de fetch (« Failed to fetch », abandon) — jamais une réponse HTTP. */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof ApiError) return false;
  if (e instanceof TypeError) return true;
  if (typeof DOMException !== "undefined" && e instanceof DOMException) return e.name === "AbortError" || e.name === "NetworkError";
  return false;
}

export function isOffline(): boolean {
  if (!useUiStore.getState().online) return true;
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function photoUploadErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return PHOTO_UPLOAD_MESSAGES.tooLarge;
    if (e.status === 415) return PHOTO_UPLOAD_MESSAGES.unsupported;
    return e.message || PHOTO_UPLOAD_MESSAGES.generic;
  }
  return PHOTO_UPLOAD_MESSAGES.generic;
}

export async function publishReport({ input, photo }: PublishArgs): Promise<PublishOutcome> {
  if (isOffline()) {
    const clientId = await enqueueReport(input, photo ?? undefined);
    return { kind: "queued", clientId };
  }
  let report: Report;
  try {
    report = (await api.reports.create(input)).report;
  } catch (e) {
    if (isNetworkError(e)) {
      const clientId = await enqueueReport(input, photo ?? undefined);
      return { kind: "queued", clientId };
    }
    throw e;
  }
  let photoError: string | null = null;
  if (photo) {
    try {
      report = (await api.reports.uploadPhoto(report.id, photo)).report;
    } catch (e) {
      // Le signalement est publié : on ne bloque pas l'utilisateur pour la photo.
      photoError = photoUploadErrorMessage(e);
    }
  }
  return { kind: "published", report, photoError };
}

export interface PublishFailure {
  kind: "auth" | "rate_limited" | "forbidden" | "validation" | "network" | "generic";
  title: string;
  description?: string;
  errors?: DraftErrors;
}

function detailPath(d: { path?: unknown }): string {
  return Array.isArray(d.path) ? String(d.path[0] ?? "") : String(d.path ?? "");
}

/** Traduit une erreur de publication en message français et, le cas échéant, en erreurs de champs. */
export function describePublishError(e: unknown): PublishFailure {
  if (e instanceof ApiError) {
    if (e.status === 401) return { kind: "auth", title: fr.wizard.loginRequired };
    if (e.status === 429) return { kind: "rate_limited", title: fr.errors.rateLimited };
    if (e.status === 403) return { kind: "forbidden", title: e.message || fr.errors.forbidden };
    if (e.status === 400) {
      const details = Array.isArray(e.details) ? (e.details as { path?: unknown; message?: unknown }[]) : [];
      const errors: DraftErrors = {};
      for (const d of details) {
        switch (detailPath(d)) {
          case "endsAt":
          case "startsAt":
            errors.endsAt ??= DRAFT_MESSAGES.endsAtPast;
            break;
          case "lat":
          case "lng":
            errors.position ??= DRAFT_MESSAGES.positionMissing;
            break;
          case "description":
            errors.description ??= DRAFT_MESSAGES.descriptionTooLong;
            break;
          case "subtype":
            errors.subtype ??= DRAFT_MESSAGES.subtype;
            break;
          case "dangerLevel":
            errors.dangerLevel ??= DRAFT_MESSAGES.dangerLevel;
            break;
          case "ttlMinutes":
            errors.ttlMinutes ??= DRAFT_MESSAGES.ttl;
            break;
          default:
            break;
        }
      }
      const first = Object.values(errors)[0];
      return { kind: "validation", title: fr.errors.validation, description: first ?? e.message, errors };
    }
    return { kind: "generic", title: fr.errors.generic, description: e.message };
  }
  if (isNetworkError(e)) return { kind: "network", title: fr.errors.network };
  return { kind: "generic", title: fr.errors.generic };
}

export function usePublishReport() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: publishReport,
    onSuccess: (_outcome, { input }) => {
      void qc.invalidateQueries({ queryKey: qk.reportsRoot });
      void qc.invalidateQueries({ queryKey: ["around"] });
      void qc.invalidateQueries({ queryKey: qk.community });
      if (isSubtype(input.subtype)) recordSubtypeUse(input.subtype);
    },
  });
  return { publish: mutation.mutateAsync, pending: mutation.isPending };
}
