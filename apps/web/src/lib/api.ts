import {
  API_PREFIX,
  type AuthResponse,
  type ListReportsResponse,
  type AroundResponse,
  type ReportDetailResponse,
  type CreateReportResponse,
  type ConfirmResponse,
  type UploadPhotoResponse,
  type SearchAreasResponse,
  type PresenceResponse,
  type NotificationsResponse,
  type AdminReportsResponse,
  type AdminFlagsResponse,
  type AdminUsersResponse,
  type AdminStats,
  type ProDashboard,
  type OfflineBundle,
  type AreaSummary,
  type BBox,
  type UserMe,
  type UserPublic,
  type Report,
  type ReportComment,
  type ReportCategory,
  type ContentFlag,
  type OfficialAlert,
  type Trail,
  type TrailSummary,
  type NetworkStats,
  type WaterPoint,
  type PathSegment,
  type ActivitiesResponse,
  type ActivityDto,
  type CreateActivityInput,
  type CreateActivityResponse,
  type HeatmapPeriod,
  type HeatmapResponse,
  type NetworkCandidatesResponse,
  type NetworkCandidateDto,
  type NetworkOverview,
  type PrivacyZoneInput,
  type RoutePlanInput,
  type RoutePlanResponse,
  type SegmentDetail,
  type UpdateActivityInput,
  type ActivityMode,
  type ActivityPointInput,
  type CandidateReviewInput,
  type RegisterInput,
  type LoginInput,
  type UpdateMeInput,
  type PreferencesInput,
  type CreateReportInput,
  type UpdateReportInput,
  type ConfirmInput,
  type CommentInput,
  type FlagInput,
  type OfficialAlertInput,
} from "@mountain-live/core";
import { useSessionStore } from "@/store/session";

/**
 * Client HTTP typé. Une seule source de vérité pour les appels API côté web.
 * Le contrat des routes est documenté dans packages/core/src/api-contract.ts.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

function bboxParam(b: BBox): string {
  return [b.west, b.south, b.east, b.north].map((n) => n.toFixed(5)).join(",");
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { raw?: boolean; form?: FormData } = {},
): Promise<T> {
  const token = useSessionStore.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !opts.form) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${API_PREFIX}${path}`, {
    method,
    headers,
    body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    if (res.status === 401) useSessionStore.getState().logout();
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `Erreur ${res.status}`, err?.details);
  }
  return data as T;
}

const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export const api = {
  health: () => request<{ ok: boolean; time: string; lan?: string[] }>("GET", "/health"),

  auth: {
    register: (input: RegisterInput) => request<AuthResponse>("POST", "/auth/register", input),
    login: (input: LoginInput) => request<AuthResponse>("POST", "/auth/login", input),
    me: () => request<{ user: UserMe }>("GET", "/auth/me"),
  },
  users: {
    updateMe: (input: UpdateMeInput) => request<{ user: UserMe }>("PATCH", "/users/me", input),
    updatePreferences: (input: PreferencesInput) => request<{ user: UserMe }>("PUT", "/users/me/preferences", input),
    deleteMe: () => request<void>("DELETE", "/users/me"),
    get: (id: string) => request<{ user: UserPublic }>("GET", `/users/${id}`),
  },
  reports: {
    list: (p: {
      bbox?: BBox;
      categories?: ReportCategory[];
      source?: "official" | "partner" | "community";
      since?: string;
      lat?: number;
      lng?: number;
      limit?: number;
    }) =>
      request<ListReportsResponse>(
        "GET",
        `/reports${q({
          bbox: p.bbox ? bboxParam(p.bbox) : undefined,
          categories: p.categories?.length ? p.categories.join(",") : undefined,
          source: p.source,
          since: p.since,
          lat: p.lat,
          lng: p.lng,
          limit: p.limit,
        })}`,
      ),
    get: (id: string, pos?: { lat: number; lng: number }) =>
      request<ReportDetailResponse>("GET", `/reports/${id}${q({ lat: pos?.lat, lng: pos?.lng })}`),
    create: (input: CreateReportInput) => request<CreateReportResponse>("POST", "/reports", input),
    update: (id: string, input: UpdateReportInput) => request<{ report: Report }>("PATCH", `/reports/${id}`, input),
    confirm: (id: string, input: ConfirmInput) => request<ConfirmResponse>("POST", `/reports/${id}/confirm`, input),
    comments: (id: string) => request<{ comments: ReportComment[] }>("GET", `/reports/${id}/comments`),
    addComment: (id: string, input: CommentInput) =>
      request<{ comment: ReportComment }>("POST", `/reports/${id}/comments`, input),
    uploadPhoto: (id: string, file: File | Blob) => {
      const form = new FormData();
      form.append("photo", file, (file as File).name ?? "photo.jpg");
      return request<UploadPhotoResponse>("POST", `/reports/${id}/photos`, undefined, { form });
    },
  },
  flags: {
    create: (input: FlagInput) => request<{ flag: ContentFlag }>("POST", "/flags", input),
  },
  around: (p: { lat: number; lng: number; radius?: number; categories?: ReportCategory[] }) =>
    request<AroundResponse>(
      "GET",
      `/around${q({ lat: p.lat, lng: p.lng, radius: p.radius, categories: p.categories?.length ? p.categories.join(",") : undefined })}`,
    ),
  areas: {
    search: (query: string, pos?: { lat: number; lng: number } | null) =>
      request<SearchAreasResponse>("GET", `/areas/search${q({ q: query, lat: pos?.lat, lng: pos?.lng })}`),
    get: (id: string) => request<AreaSummary>("GET", `/areas/${id}`),
  },
  trails: (bbox: BBox) => request<{ trails: Trail[] }>("GET", `/trails${q({ bbox: bboxParam(bbox) })}`),
  trail: (id: string) => request<{ trail: Trail }>("GET", `/trails/${encodeURIComponent(id)}`),
  trailSummaries: (bbox: BBox) => request<{ trails: TrailSummary[] }>("GET", `/trails${q({ bbox: bboxParam(bbox), summary: 1 })}`),
  networkStats: () => request<NetworkStats>("GET", "/paths/stats"),
  paths: (bbox: BBox) => request<{ paths: PathSegment[]; truncated: boolean }>("GET", `/paths${q({ bbox: bboxParam(bbox) })}`),
  waterPoints: (bbox: BBox) =>
    request<{ waterPoints: WaterPoint[] }>("GET", `/water-points${q({ bbox: bboxParam(bbox) })}`),
  officialAlerts: (bbox: BBox) =>
    request<{ officialAlerts: OfficialAlert[] }>("GET", `/alerts/official${q({ bbox: bboxParam(bbox) })}`),
  presence: {
    ping: (p: { lat: number; lng: number }) => request<void>("POST", "/presence", p),
    get: (bbox: BBox) => request<PresenceResponse>("GET", `/presence${q({ bbox: bboxParam(bbox) })}`),
  },
  notifications: {
    list: () => request<NotificationsResponse>("GET", "/notifications"),
    read: (id: string) => request<void>("POST", `/notifications/${id}/read`),
    readAll: () => request<void>("POST", "/notifications/read-all"),
  },
  offline: {
    bundle: (bbox: BBox) => request<OfflineBundle>("GET", `/offline/bundle${q({ bbox: bboxParam(bbox) })}`),
  },
  /** Moteur cartographique collectif : activités, réseau, itinéraires. */
  activities: {
    create: (input: CreateActivityInput) => request<CreateActivityResponse>("POST", "/activities", input),
    list: (p: { limit?: number; offset?: number } = {}) => request<ActivitiesResponse>("GET", `/activities${q(p)}`),
    get: (id: string) => request<{ activity: ActivityDto; points: ActivityPointInput[] }>("GET", `/activities/${id}`),
    update: (id: string, input: UpdateActivityInput) => request<{ activity: ActivityDto }>("PATCH", `/activities/${id}`, input),
    remove: (id: string) => request<void>("DELETE", `/activities/${id}`),
  },
  network: {
    segment: (id: string) => request<SegmentDetail>("GET", `/network/segments/${encodeURIComponent(id)}`),
    heatmap: (p: { bbox: BBox; period?: HeatmapPeriod; activity?: ActivityMode | "all" }) =>
      request<HeatmapResponse>("GET", `/network/heatmap${q({ bbox: bboxParam(p.bbox), period: p.period, activity: p.activity })}`),
    routes: (input: RoutePlanInput) => request<RoutePlanResponse>("POST", "/network/routes", input),
    overview: (p: { from?: string; to?: string } = {}) => request<NetworkOverview>("GET", `/network/overview${q(p)}`),
    candidates: (p: { kind?: string; status?: string; limit?: number } = {}) =>
      request<NetworkCandidatesResponse>("GET", `/network/candidates${q(p)}`),
    reviewCandidate: (id: string, input: CandidateReviewInput) =>
      request<{ candidate: NetworkCandidateDto }>("PATCH", `/admin/network/candidates/${id}`, input),
    rebuild: () => request<{ processed: number; statistics: number; candidates: number }>("POST", "/admin/network/rebuild"),
  },
  privacyZones: {
    list: () => request<{ zones: { id: string; label: string | null; lat: number; lng: number; radiusM: number }[] }>("GET", "/users/me/privacy-zones"),
    create: (input: PrivacyZoneInput) =>
      request<{ zone: { id: string; label: string | null; lat: number; lng: number; radiusM: number } }>("POST", "/users/me/privacy-zones", input),
    remove: (id: string) => request<void>("DELETE", `/users/me/privacy-zones/${id}`),
  },

  community: {
    activity: () =>
      request<{ reports: Report[]; topContributors: UserPublic[]; partners: UserPublic[] }>(
        "GET",
        "/community/activity",
      ),
  },
  admin: {
    stats: () => request<AdminStats>("GET", "/admin/stats"),
    reports: (p: { status?: string; category?: string; q?: string; page?: number; includeInactive?: boolean }) =>
      request<AdminReportsResponse>("GET", `/admin/reports${q({ ...p, includeInactive: p.includeInactive ? 1 : undefined })}`),
    updateReport: (id: string, input: Record<string, unknown>) =>
      request<{ report: Report }>("PATCH", `/admin/reports/${id}`, input),
    deleteReport: (id: string) => request<void>("DELETE", `/admin/reports/${id}`),
    flags: (p: { status?: string; page?: number }) => request<AdminFlagsResponse>("GET", `/admin/flags${q(p)}`),
    updateFlag: (id: string, input: { status: string; resolutionNote?: string | null; action?: string }) =>
      request<{ flag: ContentFlag }>("PATCH", `/admin/flags/${id}`, input),
    users: (p: { q?: string; page?: number }) => request<AdminUsersResponse>("GET", `/admin/users${q(p)}`),
    suspendUser: (id: string, input: { hours: number; reason?: string }) =>
      request<{ user: UserPublic }>("POST", `/admin/users/${id}/suspend`, input),
    createAlert: (input: OfficialAlertInput) => request<{ officialAlert: OfficialAlert }>("POST", "/admin/alerts", input),
    deleteAlert: (id: string) => request<void>("DELETE", `/admin/alerts/${id}`),
  },
  pro: {
    dashboard: (p: { areaId?: string; from?: string; to?: string }) =>
      request<ProDashboard>("GET", `/pro/dashboard${q(p)}`),
  },
};

export function photoUrl(rel: string | null | undefined): string | undefined {
  if (!rel) return undefined;
  if (/^https?:\/\//.test(rel)) return rel;
  return `${BASE}${rel}`;
}
