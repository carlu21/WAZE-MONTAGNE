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
  trail: (id: string) => ["trail", id] as const,
  trailSummaries: (bbox: BBox) => ["trailSummaries", [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(2)).join(",")] as const,
  networkStats: ["networkStats"] as const,
  paths: (cell: string) => ["paths", cell] as const,
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
  activities: ["activities"] as const,
  activity: (id: string) => ["activity", id] as const,
  networkSegment: (id: string) => ["networkSegment", id] as const,
  heatmap: (bbox: BBox, period: string, activity: string) =>
    ["heatmap", [bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(2)).join(","), period, activity] as const,
  networkOverview: (p: Record<string, unknown>) => ["networkOverview", p] as const,
  networkCandidates: (p: Record<string, unknown>) => ["networkCandidates", p] as const,
  privacyZones: ["privacyZones"] as const,
  // Collecte des traces existantes (back-office).
  collectSources: (p: Record<string, unknown>) => ["collectSources", p] as const,
  collectTraces: (p: Record<string, unknown>) => ["collectTraces", p] as const,
  collectTerritories: ["collectTerritories"] as const,
  collectPlan: (id: string) => ["collectPlan", id] as const,
  segmentSources: (id: string) => ["segmentSources", id] as const,
  // Écran d'accueil : randonnées autour de la position.
  nearby: (p: Record<string, unknown>) => ["nearby", p] as const,
  trailGeometry: (id: string) => ["trailGeometry", id] as const,
};
