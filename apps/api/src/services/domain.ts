import {
  blurLocation as coreBlurLocation,
  computeBadges as coreComputeBadges,
  computeExpiresAt as coreComputeExpiresAt,
  computeReliability as coreComputeReliability,
  deriveStatus as coreDeriveStatus,
  SUBTYPE_BY_ID,
  type BadgeInput,
  type DeriveStatusInput,
  type ReliabilityInput,
  type ReportSubtype,
} from "@mountain-live/core";

/**
 * Point d'entrée unique des fonctions métier partagées (packages/core) utilisées par l'API :
 * expiration, statut dérivé, floutage, fiabilité et badges. Centralisé ici pour que les
 * services n'aient qu'un seul import à changer si le contrat évolue.
 */
export const computeExpiresAt = coreComputeExpiresAt;
export const deriveStatus = coreDeriveStatus;
export const blurLocation = coreBlurLocation;
export const computeReliability = coreComputeReliability;
export const computeBadges = coreComputeBadges;
export type { BadgeInput, DeriveStatusInput, ReliabilityInput };

/** Sous-types dont la position doit être floutée (espèces sensibles, section 8). */
export function isSensitiveSubtype(subtype: ReportSubtype): boolean {
  return SUBTYPE_BY_ID[subtype].sensitive;
}
