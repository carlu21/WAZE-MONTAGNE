/**
 * Chargement des signalements de la vue courante (sections 3, 10 et 11).
 *
 * - bbox de la vue élargie de 30 % puis alignée sur une grille dépendant du
 *   zoom : les petits déplacements ne déclenchent pas de nouvelle requête.
 * - Filtres actifs (catégories, « officiel uniquement ») et position de
 *   l'appareil (distanceM) transmis à l'API ; rafraîchissement toutes les 60 s ;
 *   les données précédentes restent affichées pendant le chargement.
 * - Hors connexion (ou serveur injoignable) : repli sur le cache Dexie
 *   (db.reports), alimenté à chaque réponse réussie.
 */
import { useEffect, useMemo } from "react";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  SUBTYPE_BY_ID,
  computeFade,
  expandBBox,
  haversineM,
  inBBox,
  isExpired,
  isVisibleStatus,
  type BBox,
  type ListReportsResponse,
  type OfficialAlert,
  type Report,
  type ReportCategory,
} from "@mountain-live/core";
import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/queryKeys";
import { db } from "@/lib/db";
import { offlineExtras } from "@/features/offline/extras";
import { applyExcludedSubtypes } from "@/features/map/facets";
import { useUiStore } from "@/store/ui";

export interface ReportsData extends ListReportsResponse {
  /** Données issues du cache local (hors connexion). */
  fromCache: boolean;
  /** Date (ms) de la mise en cache la plus récente, si `fromCache`. */
  cachedAt: number | null;
}

/** Facteur d'élargissement de la bbox de la vue (30 %). */
export const BBOX_EXPAND_FACTOR = 1.3;
export const REPORTS_REFETCH_MS = 60_000;
export const REPORTS_LIMIT = 1000;

/** Pas de grille (°) selon le zoom : ~1/4 de tuile, pour stabiliser la clé de requête. */
export function gridStepForZoom(zoom: number): number {
  const z = Math.max(0, Math.min(20, Math.floor(Number.isFinite(zoom) ? zoom : 8)));
  return 360 / 2 ** z / 4;
}

/** Bbox de requête : élargie de 30 % puis étendue aux bords de la grille. */
export function queryBBoxFor(view: BBox, zoom: number): BBox {
  const expanded = expandBBox(view, BBOX_EXPAND_FACTOR);
  const step = gridStepForZoom(zoom);
  const snap = (v: number, fn: (x: number) => number) => Number((fn(v / step) * step).toFixed(6));
  return {
    west: Math.max(-180, snap(expanded.west, Math.floor)),
    south: Math.max(-90, snap(expanded.south, Math.floor)),
    east: Math.min(180, snap(expanded.east, Math.ceil)),
    north: Math.min(90, snap(expanded.north, Math.ceil)),
  };
}

interface CacheFilter {
  bbox: BBox;
  categories: ReportCategory[];
  officialOnly: boolean;
  position: { lat: number; lng: number } | null;
}

function priorityOf(r: Report): number {
  return SUBTYPE_BY_ID[r.subtype]?.priority ?? 2;
}

/** Lecture du cache local : mêmes règles de visibilité et de tri que l'API. */
export async function reportsFromCache(f: CacheFilter): Promise<ReportsData> {
  const now = new Date();
  let cachedAt: number | null = null;
  const all = await db.reports.toArray();
  const reports: Report[] = [];
  for (const cached of all) {
    const { cachedAt: at, ...report } = cached;
    if (!inBBox(report, f.bbox)) continue;
    if (!isVisibleStatus(report.status) || isExpired(report, now)) continue;
    if (f.categories.length > 0 && !f.categories.includes(report.category)) continue;
    if (f.officialOnly && report.source !== "official") continue;
    cachedAt = cachedAt === null ? at : Math.max(cachedAt, at);
    reports.push({
      ...report,
      fade: computeFade(report.createdAt, report.expiresAt, now),
      distanceM: f.position ? Math.round(haversineM(f.position, report)) : report.distanceM,
    });
  }
  reports.sort((a, b) => priorityOf(b) - priorityOf(a) || b.createdAt.localeCompare(a.createdAt));
  // Alertes officielles des zones téléchargées couvrant la vue (section 9).
  const officialAlerts: OfficialAlert[] = (await offlineExtras(f.bbox, now.getTime())).officialAlerts;
  return { reports, officialAlerts, generatedAt: new Date(cachedAt ?? now.getTime()).toISOString(), fromCache: true, cachedAt };
}

/** Mise en cache des signalements reçus et purge des entrées expirées. */
export async function cacheReports(reports: readonly Report[]): Promise<void> {
  try {
    const cachedAt = Date.now();
    if (reports.length > 0) await db.reports.bulkPut(reports.map((r) => ({ ...r, cachedAt })));
    await db.reports.where("expiresAt").below(new Date().toISOString()).delete();
  } catch {
    /* IndexedDB indisponible : le cache est facultatif */
  }
}

export interface UseReportsResult extends Pick<UseQueryResult<ReportsData>, "isLoading" | "isFetching" | "isError" | "error" | "refetch"> {
  data: ReportsData | undefined;
  reports: Report[];
  officialAlerts: OfficialAlert[];
  /** Bbox réellement demandée (élargie). */
  queryBBox: BBox | null;
}

const NO_REPORTS: Report[] = [];
const NO_ALERTS: OfficialAlert[] = [];

export function useReports(viewBBox: BBox | null, zoom: number): UseReportsResult {
  const filters = useUiStore((s) => s.filters);
  const officialOnly = useUiStore((s) => s.showOfficialOnly);
  const online = useUiStore((s) => s.online);
  const position = useUiStore((s) => s.position);
  const excludedSubtypes = useUiStore((s) => s.excludedSubtypes);

  const bboxKey = viewBBox ? `${viewBBox.west},${viewBBox.south},${viewBBox.east},${viewBBox.north}` : "";
  const zoomInt = Math.floor(zoom);
  const queryBBox = useMemo(
    () => (viewBBox ? queryBBoxFor(viewBBox, zoomInt) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bboxKey, zoomInt],
  );

  const query = useQuery<ReportsData>({
    queryKey: qk.reports(queryBBox, filters, officialOnly),
    enabled: queryBBox !== null,
    placeholderData: keepPreviousData,
    refetchInterval: online ? REPORTS_REFETCH_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    retry: online ? 1 : false,
    networkMode: "always",
    queryFn: async () => {
      const bbox = queryBBox as BBox;
      const cacheFilter: CacheFilter = { bbox, categories: filters, officialOnly, position: position ? { lat: position.lat, lng: position.lng } : null };
      if (!online) return reportsFromCache(cacheFilter);
      try {
        const res = await api.reports.list({
          bbox,
          categories: filters,
          source: officialOnly ? "official" : undefined,
          lat: position?.lat,
          lng: position?.lng,
          limit: REPORTS_LIMIT,
        });
        void cacheReports(res.reports);
        return { ...res, fromCache: false, cachedAt: null };
      } catch (err) {
        // Erreur HTTP réelle (401, 429…) : on la remonte. Serveur injoignable : repli sur le cache.
        if (err instanceof ApiError) throw err;
        const cached = await reportsFromCache(cacheFilter);
        if (cached.reports.length > 0) return cached;
        throw err;
      }
    },
  });

  // Retour du réseau : on recharge sans attendre l'intervalle.
  const { refetch } = query;
  useEffect(() => {
    if (online && queryBBox) void refetch();
  }, [online, queryBBox, refetch]);

  const reports = useMemo(() => applyExcludedSubtypes(query.data?.reports ?? NO_REPORTS, excludedSubtypes), [query.data, excludedSubtypes]);

  return {
    data: query.data,
    reports,
    officialAlerts: query.data?.officialAlerts ?? NO_ALERTS,
    queryBBox,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch,
  };
}
