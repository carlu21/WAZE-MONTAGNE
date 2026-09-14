import type { BBox, ReportCategory } from "@mountain-live/core";

/** Clés TanStack Query partagées par toutes les fonctionnalités. */
export const qk = {
  me: ["me"] as const,
  reports: (bbox?: BBox | null, categories?: ReportCategory[], officialOnly?: boolean) =>
    ["reports", bbox ? [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(3)).join(",") : "all", categories?.slice().sort().join(",") ?? "", officialOnly ?? false] as const,
  reportsRoot: ["reports"] as const,
  report: (id: string) => ["report", id] as const,
  comments: (id: string) => ["comments", id] as const,
  around: (lat: number, lng: number, radius: number) => ["around", lat.toFixed(3), lng.toFixed(3), radius] as const,
  areaSearch: (q: string) => ["areaSearch", q] as const,
  area: (id: string) => ["area", id] as const,
  trails: (bbox: BBox) => ["trails", [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(2)).join(",")] as const,
  waterPoints: (bbox: BBox) => ["waterPoints", [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(2)).join(",")] as const,
  presence: (bbox: BBox) => ["presence", [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(2)).join(",")] as const,
  notifications: ["notifications"] as const,
  community: ["community"] as const,
  adminStats: ["admin", "stats"] as const,
  adminReports: (p: Record<string, unknown>) => ["admin", "reports", p] as const,
  adminFlags: (p: Record<string, unknown>) => ["admin", "flags", p] as const,
  adminUsers: (p: Record<string, unknown>) => ["admin", "users", p] as const,
  pro: (p: Record<string, unknown>) => ["pro", p] as const,
  offlineZones: ["offlineZones"] as const,
};
