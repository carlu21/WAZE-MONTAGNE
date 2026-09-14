import type {
  Report,
  ReportComment,
  UserMe,
  UserPublic,
  OfficialAlert,
  Area,
  AreaSummary,
  Trail,
  WaterPoint,
  Notification,
  ContentFlag,
  PresenceCell,
  OfflineBundle,
  AdminStats,
  ProDashboard,
  Confirmation,
  Photo,
} from "./types";

/**
 * Contrat HTTP de l'API (préfixe `/api/v1`).
 * Authentification : `Authorization: Bearer <jwt>`.
 * Toutes les erreurs : `{ error: { code: string; message: string; details?: unknown } }`.
 */
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface AuthResponse {
  token: string;
  user: UserMe;
}

export interface ListReportsResponse {
  reports: Report[];
  officialAlerts: OfficialAlert[];
  generatedAt: string;
}

export interface AroundResponse {
  center: { lat: number; lng: number };
  radiusM: number;
  items: Report[]; // triés par distance croissante, distanceM renseigné
  officialAlerts: OfficialAlert[];
  waterPoints: (WaterPoint & { distanceM: number })[];
}

export interface ReportDetailResponse {
  report: Report;
  comments: ReportComment[];
  confirmations: Confirmation[];
  /** Fiche utilisateur publique du contributeur, ou null (compte supprimé / officiel). */
  author: UserPublic | null;
}

export interface CreateReportResponse {
  report: Report;
}

export interface ConfirmResponse {
  report: Report;
  confirmation: Confirmation;
}

export interface UploadPhotoResponse {
  photo: Photo;
  report: Report;
}

export interface SearchAreasResponse {
  areas: Area[];
}

export interface PresenceResponse {
  cells: PresenceCell[];
  /** Estimation globale dans la bbox. */
  activeUsersEstimate: number;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

export interface AdminReportsResponse {
  reports: Report[];
  total: number;
}

export interface AdminFlagsResponse {
  flags: (ContentFlag & { report: Report | null })[];
  total: number;
}

export interface AdminUsersResponse {
  users: (UserPublic & { email: string; suspendedUntil: string | null })[];
  total: number;
}

/**
 * Tableau des routes. Documentation vivante utilisée par les deux côtés.
 *
 * Auth
 *  POST   /auth/register            RegisterInput            -> AuthResponse
 *  POST   /auth/login               LoginInput               -> AuthResponse
 *  GET    /auth/me                                           -> { user: UserMe }
 *  PATCH  /users/me                 UpdateMeInput            -> { user: UserMe }
 *  PUT    /users/me/preferences     PreferencesInput         -> { user: UserMe }
 *  DELETE /users/me                                          -> 204 (RGPD : suppression + anonymisation)
 *  GET    /users/:id                                         -> { user: UserPublic }
 *
 * Signalements
 *  GET    /reports?bbox&categories&source&since&lat&lng&limit -> ListReportsResponse
 *  GET    /reports/:id?lat&lng                               -> ReportDetailResponse
 *  POST   /reports                  CreateReportInput        -> CreateReportResponse (201)
 *  PATCH  /reports/:id              UpdateReportInput        -> { report }   (auteur ou modérateur)
 *  POST   /reports/:id/confirm      ConfirmInput             -> ConfirmResponse
 *  GET    /reports/:id/comments                              -> { comments }
 *  POST   /reports/:id/comments     CommentInput             -> { comment } (201)
 *  POST   /reports/:id/photos       multipart "photo"        -> UploadPhotoResponse (201)
 *  POST   /flags                    FlagInput                -> { flag } (201)
 *
 * Autour de moi / explorer
 *  GET    /around?lat&lng&radius&categories                  -> AroundResponse
 *  GET    /areas/search?q                                    -> SearchAreasResponse
 *  GET    /areas/:id                                         -> AreaSummary
 *  GET    /trails?bbox                                       -> { trails: Trail[] }
 *  GET    /water-points?bbox                                 -> { waterPoints: WaterPoint[] }
 *  GET    /alerts/official?bbox                              -> { officialAlerts: OfficialAlert[] }
 *
 * Présence agrégée (jamais individuelle)
 *  POST   /presence                 { lat, lng }             -> 204
 *  GET    /presence?bbox                                     -> PresenceResponse
 *
 * Notifications
 *  GET    /notifications                                     -> NotificationsResponse
 *  POST   /notifications/:id/read                            -> 204
 *  POST   /notifications/read-all                            -> 204
 *
 * Hors connexion
 *  GET    /offline/bundle?bbox                               -> OfflineBundle
 *
 * Communauté
 *  GET    /community/activity                                -> { reports: Report[]; topContributors: UserPublic[]; partners: UserPublic[] }
 *
 * Administration (rôle moderator/admin)
 *  GET    /admin/stats                                       -> AdminStats
 *  GET    /admin/reports?status&category&q&page             -> AdminReportsResponse
 *  PATCH  /admin/reports/:id        adminUpdateReportSchema  -> { report }
 *  DELETE /admin/reports/:id                                 -> 204
 *  GET    /admin/flags?status                                -> AdminFlagsResponse
 *  PATCH  /admin/flags/:id          adminFlagUpdateSchema    -> { flag }
 *  GET    /admin/users?q                                     -> AdminUsersResponse
 *  POST   /admin/users/:id/suspend  adminSuspendSchema       -> { user }
 *  POST   /admin/alerts             OfficialAlertInput       -> { officialAlert } (201)
 *  DELETE /admin/alerts/:id                                  -> 204
 *
 * Tableau de bord professionnel (rôle official/manager/admin)
 *  GET    /pro/dashboard?areaId&from&to                      -> ProDashboard
 *
 * Divers
 *  GET    /health                                            -> { ok: true, time }
 *  GET    /taxonomy                                          -> { categories, subtypes }
 */
export const API_PREFIX = "/api/v1";
export type { AdminStats, ProDashboard, OfflineBundle, AreaSummary, Area, Trail, WaterPoint };
