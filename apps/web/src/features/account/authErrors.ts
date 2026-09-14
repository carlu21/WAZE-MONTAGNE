import { fr } from "@mountain-live/core";
import { ApiError } from "@/lib/api";

/** Message FR pour une erreur d'authentification ou d'inscription. */
export function authErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "invalid_credentials":
        return fr.auth.errors.invalidCredentials;
      case "email_taken":
        return fr.auth.errors.emailTaken;
      case "pseudo_taken":
        return fr.auth.errors.pseudoTaken;
      case "suspended":
        return e.message || fr.auth.errors.suspended;
      case "rate_limited":
        return fr.errors.rateLimited;
      case "validation_error":
        return fr.errors.validation;
      default:
        return e.message || fr.errors.generic;
    }
  }
  return fr.errors.network;
}
