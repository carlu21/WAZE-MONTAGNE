import {
  computeFade,
  haversineM,
  type Area,
  type Confirmation,
  type ConfirmationKind,
  type ContentFlag,
  type LatLng,
  type Notification,
  type OfficialAlert,
  type Photo,
  type Report,
  type ReportComment,
  type Trail,
  type UserMe,
  type UserPublic,
  type UserPreferences,
  type WaterPoint,
} from "@mountain-live/core";
import type {
  AreaRow,
  CommentRow,
  ConfirmationRow,
  FlagRow,
  NotificationRow,
  OfficialAlertRow,
  PhotoRow,
  ReportRow,
  TrailRow,
  UserRow,
  WaterPointRow,
} from "../db/schema";

/**
 * Sérialiseurs : convertissent les lignes SQL en objets du contrat (packages/core/src/types.ts).
 * Règles de confidentialité appliquées ici, une fois pour toutes :
 *  - un signalement flouté n'expose JAMAIS lat/lng exacts (display_lat/lng uniquement) ;
 *  - aucun e-mail ni hash ne sort d'un profil public ;
 *  - un compte supprimé apparaît comme « Utilisateur supprimé ».
 */

export const DELETED_USER_PSEUDO = "Utilisateur supprimé";

export interface ReportSerializeContext {
  now: Date;
  /** Position du demandeur pour calculer distanceM (facultatif). */
  origin?: LatLng | null;
  /** Pseudo public d'un contributeur (null si supprimé / inconnu). */
  authorPseudo: (userId: string | null) => string | null;
  /** Photos non supprimées du signalement. */
  photos: (reportId: string) => Photo[];
  /** Vote de l'utilisateur courant (undefined = anonyme, null = pas de vote). */
  myConfirmation?: (reportId: string) => ConfirmationKind | null;
}

export function toReport(row: ReportRow, ctx: ReportSerializeContext): Report {
  // Position servie : toujours display_lat/lng. Les coordonnées exactes ne quittent jamais la base.
  const lat = row.displayLat;
  const lng = row.displayLng;
  const photos = ctx.photos(row.id);
  const report: Report = {
    id: row.id,
    userId: row.userId,
    authorPseudo: ctx.authorPseudo(row.userId),
    category: row.category,
    subtype: row.subtype,
    lat,
    lng,
    blurred: row.blurred,
    dangerLevel: row.dangerLevel ?? null,
    description: row.description ?? null,
    photoUrl: photos[0]?.url ?? null,
    photos,
    source: row.source,
    status: row.status,
    zone: row.zone ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    startsAt: row.startsAt ?? null,
    endsAt: row.endsAt ?? null,
    confirmationsCount: row.confirmationsCount,
    disputesCount: row.disputesCount,
    resolvedVotesCount: row.resolvedVotesCount,
    lastConfirmationAt: row.lastConfirmationAt ?? null,
    confidenceScore: row.confidenceScore,
    confidenceLabel: row.confidenceLabel,
    fade: computeFade(row.createdAt, row.expiresAt, ctx.now),
  };
  if (ctx.origin) report.distanceM = Math.round(haversineM(ctx.origin, { lat, lng }));
  if (ctx.myConfirmation) report.myConfirmation = ctx.myConfirmation(row.id);
  return report;
}

export function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    reportId: row.reportId,
    url: row.url,
    width: row.width ?? null,
    height: row.height ?? null,
    createdAt: row.createdAt,
  };
}

export function toComment(row: CommentRow, authorPseudo: string | null): ReportComment {
  return {
    id: row.id,
    reportId: row.reportId,
    userId: row.userId ?? "",
    authorPseudo: authorPseudo ?? DELETED_USER_PSEUDO,
    body: row.body,
    createdAt: row.createdAt,
  };
}

export function toConfirmation(row: ConfirmationRow): Confirmation {
  return {
    id: row.id,
    reportId: row.reportId,
    userId: row.userId,
    kind: row.kind,
    comment: row.comment ?? null,
    createdAt: row.updatedAt ?? row.createdAt,
  };
}

export function toUserPublic(row: UserRow): UserPublic {
  const deleted = !!row.deletedAt;
  return {
    id: row.id,
    pseudo: deleted ? DELETED_USER_PSEUDO : row.pseudo,
    avatarUrl: deleted ? null : (row.avatarUrl ?? null),
    practices: deleted ? [] : row.practices,
    region: deleted ? null : (row.region ?? null),
    role: row.role,
    reportsCount: row.reportsCount,
    confirmationsCount: row.confirmationsCount,
    // Niveau public 1..5 uniquement, jamais le score brut (section 16).
    reliabilityLevel: Math.max(1, Math.min(5, row.reliabilityLevel)),
    badges: row.badges,
    createdAt: row.createdAt,
  };
}

export function toUserMe(row: UserRow, preferences: UserPreferences): UserMe {
  return {
    ...toUserPublic(row),
    email: row.email,
    preferences,
    consentGivenAt: row.consentGivenAt ?? null,
    suspendedUntil: row.suspendedUntil ?? null,
  };
}

export function toOfficialAlert(row: OfficialAlertRow): OfficialAlert {
  return {
    id: row.id,
    organisation: row.organisation,
    title: row.title,
    body: row.body,
    category: row.category,
    severity: row.severity,
    geometry: row.geometry,
    centroidLat: row.centroidLat,
    centroidLng: row.centroidLng,
    startsAt: row.startsAt,
    endsAt: row.endsAt ?? null,
    url: row.url ?? null,
    createdAt: row.createdAt,
  };
}

export function toArea(row: AreaRow): Area {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    lat: row.lat,
    lng: row.lng,
    bbox: row.bbox ?? null,
    elevation: row.elevation ?? null,
    description: row.description ?? null,
    commune: row.commune ?? null,
  };
}

export function toTrail(row: TrailRow): Trail {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    difficulty: row.difficulty,
    distanceKm: row.distanceKm,
    elevationGainM: row.elevationGainM,
    geometry: row.geometry,
    description: row.description ?? null,
  };
}

export function toWaterPoint(row: WaterPointRow): WaterPoint {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    lat: row.lat,
    lng: row.lng,
    lastState: row.lastState,
    lastStateAt: row.lastStateAt ?? null,
    elevation: row.elevation ?? null,
  };
}

export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    body: row.body,
    reportId: row.reportId ?? null,
    readAt: row.readAt ?? null,
    createdAt: row.createdAt,
  };
}

export function toFlag(row: FlagRow): ContentFlag {
  return {
    id: row.id,
    reporterId: row.reporterId,
    reportId: row.reportId ?? null,
    commentId: row.commentId ?? null,
    photoId: row.photoId ?? null,
    reason: row.reason,
    details: row.details ?? null,
    status: row.status,
    resolvedBy: row.resolvedBy ?? null,
    resolutionNote: row.resolutionNote ?? null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt ?? null,
  };
}
