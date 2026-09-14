import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Erreur HTTP applicative. Sérialisée par le gestionnaire global de app.ts
 * sous la forme `{ error: { code, message, details? } }` (contrat api-contract.ts).
 */
export class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = "Authentification requise") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Accès refusé", code = "forbidden") => new HttpError(403, code, message);
export const notFound = (message = "Ressource introuvable") => new HttpError(404, "not_found", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
