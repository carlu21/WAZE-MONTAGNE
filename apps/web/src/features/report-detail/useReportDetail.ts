/**
 * Chargement d'une fiche de signalement avec repli hors connexion (cache Dexie),
 * et mutations : vote, résolution, commentaire, photo.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { fr, type ConfirmationKind, type ReportDetailResponse } from "@mountain-live/core";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { db } from "@/lib/db";
import { enqueueConfirmation } from "@/lib/outbox";
import { useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { toast } from "@/components/ui";

export interface ReportDetailData extends ReportDetailResponse {
  fromCache: boolean;
}

async function fromCache(id: string): Promise<ReportDetailData | null> {
  const cached = await db.reports.get(id);
  if (!cached) return null;
  const { cachedAt: _c, ...report } = cached;
  return { report, comments: [], confirmations: [], author: null, fromCache: true };
}

export function useReportDetail(id: string | undefined) {
  const online = useUiStore((s) => s.online);
  const position = useUiStore((s) => s.position);
  const token = useSessionStore((s) => s.token);
  return useQuery<ReportDetailData>({
    queryKey: [...qk.report(id ?? ""), token ? "auth" : "anon"],
    enabled: Boolean(id),
    staleTime: 20_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const rid = id as string;
      if (!online) {
        const c = await fromCache(rid);
        if (c) return c;
      }
      try {
        const data = await api.reports.get(rid, position ? { lat: position.lat, lng: position.lng } : undefined);
        void db.reports.put({ ...data.report, cachedAt: Date.now() });
        return { ...data, fromCache: false };
      } catch (e) {
        if (e instanceof ApiError) throw e;
        const c = await fromCache(rid);
        if (c) return c;
        throw e;
      }
    },
  });
}

export function describeApiError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "own_report") return fr.confirmations.ownReport;
    if (e.code === "report_closed") return fr.errors.conflict;
    if (e.code === "rate_limited") return fr.errors.rateLimited;
    if (e.status === 401) return fr.errors.unauthorized;
    if (e.status === 403) return fr.errors.forbidden;
    if (e.status === 404) return fr.errors.notFound;
    return e.message || fr.errors.generic;
  }
  return fr.errors.network;
}

export function useReportActions(reportId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const online = useUiStore((s) => s.online);
  const token = useSessionStore((s) => s.token);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: qk.report(reportId) });
    void queryClient.invalidateQueries({ queryKey: qk.reportsRoot });
    void queryClient.invalidateQueries({ queryKey: qk.comments(reportId) });
  };

  const requireLogin = (): boolean => {
    if (token) return true;
    toast.info(fr.confirmations.loginRequired);
    navigate("/auth/login", { state: { from: `/reports/${reportId}` } });
    return false;
  };

  const vote = useMutation({
    mutationFn: (p: { kind: ConfirmationKind; comment?: string | null }) => api.reports.confirm(reportId, { kind: p.kind, comment: p.comment ?? null }),
    onSuccess: () => {
      toast.success(fr.confirmations.thanks);
      invalidate();
    },
    onError: (e) => toast.warning(describeApiError(e)),
  });

  const voteOrQueue = async (kind: ConfirmationKind, comment?: string | null) => {
    if (!requireLogin()) return;
    if (!online) {
      await enqueueConfirmation(reportId, kind, comment);
      toast.info(fr.confirmations.offlineQueued);
      return;
    }
    vote.mutate({ kind, comment });
  };

  const resolve = useMutation({
    mutationFn: () => api.reports.update(reportId, { status: "resolved" }),
    onSuccess: () => {
      toast.success("Signalement déclaré résolu. Merci !");
      invalidate();
    },
    onError: (e) => toast.warning(describeApiError(e)),
  });

  const updateDescription = useMutation({
    mutationFn: (description: string) => api.reports.update(reportId, { description: description.trim() || null }),
    onSuccess: () => {
      toast.success(fr.profilePage.saved);
      invalidate();
    },
    onError: (e) => toast.warning(describeApiError(e)),
  });

  const comment = useMutation({
    mutationFn: (body: string) => api.reports.addComment(reportId, { body }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.warning(describeApiError(e)),
  });

  const photo = useMutation({
    mutationFn: (blob: Blob) => api.reports.uploadPhoto(reportId, blob),
    onSuccess: () => {
      toast.success("Photo ajoutée.");
      invalidate();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 413) toast.warning("Photo trop lourde (5 Mo maximum).");
      else if (e instanceof ApiError && e.status === 415) toast.warning(fr.errors.photoInvalid);
      else toast.warning(describeApiError(e));
    },
  });

  return { vote, voteOrQueue, resolve, updateDescription, comment, photo, requireLogin, online };
}
