import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  campaignSchema,
  dataSourceSchema,
  sourceReviewSchema,
  territorySchema,
  type CampaignResponse,
  type DataSourceDto,
  type DiscoveriesResponse,
  type SourcesResponse,
  type TerritoriesResponse,
  type TerritoryDto,
  type TerritoryPlanResponse,
} from "@mountain-live/core";
import { z } from "zod";
import { db } from "../db/client";
import { importedTraces, type SourceDiscoveryRow, type TerritoryRow } from "../db/schema";
import { requireAuth, requireRole, type AppEnv } from "../middleware/auth";
import { readJson, readQuery } from "../middleware/validate";
import { HttpError } from "../services/errors";
import { coverageReport } from "../services/segment-knowledge";
import {
  countDiscoveriesByStatus,
  createTerritory,
  inspectUrl,
  listDiscoveries,
  listTerritories,
  planFor,
  queriesFor,
  requireTerritory,
  reviewDiscovery,
  runCampaign,
  toTerritory,
} from "../services/source-discovery";
import { attributionFor, autoImportAllowed, countSourcesByStatus, createSource, decisionFor, listSources, reviewSource, sourceById, toDataSource } from "../services/sources";

/**
 * Back-office de la collecte (sections 4, 5, 15, 16, 23).
 *
 * Tout ce qui touche aux droits passe par ici et par un modérateur : une source
 * ne devient exploitable que par une décision humaine tracée. Aucune route de
 * ce fichier ne peut approuver quoi que ce soit automatiquement.
 */
export const adminSourcesRoutes = new Hono<AppEnv>();

adminSourcesRoutes.use("*", requireAuth, requireRole("moderator", "admin"));

function toSourceDto(row: Parameters<typeof decisionFor>[0]): DataSourceDto {
  const traceCount =
    db.select({ n: sql<number>`count(*)` }).from(importedTraces).where(eq(importedTraces.sourceId, row.id)).get()?.n ?? 0;
  return {
    ...toDataSource(row),
    attributionText: row.attributionText,
    decision: decisionFor(row),
    autoImport: autoImportAllowed(row),
    traceCount,
  };
}

adminSourcesRoutes.get("/sources", (c) => {
  const q = readQuery(
    c,
    z.object({
      status: z.enum(["approved", "review_required", "forbidden"]).optional(),
      type: z.string().max(30).optional(),
      territory: z.string().max(80).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
  );
  const rows = listSources({ status: q.status, type: q.type as never, territory: q.territory, limit: q.limit });
  const body: SourcesResponse = { sources: rows.map(toSourceDto), byStatus: countSourcesByStatus() };
  return c.json(body);
});

adminSourcesRoutes.post("/sources", async (c) => {
  const input = await readJson(c, dataSourceSchema);
  const row = createSource({
    name: input.name,
    url: input.url,
    type: input.type,
    country: input.country,
    territory: input.territory ?? null,
    licence: input.licence,
    licenceUrl: input.licenceUrl ?? null,
    attributionText: input.attributionText ?? null,
    apiAvailable: input.apiAvailable,
    apiUrl: input.apiUrl ?? null,
    reliabilityScore: input.reliabilityScore,
    notes: input.notes ?? null,
  });
  return c.json({ source: toSourceDto(row) }, 201);
});

adminSourcesRoutes.patch("/sources/:id", async (c) => {
  const row = sourceById(c.req.param("id"));
  if (!row) throw new HttpError(404, "not_found", "Source introuvable");
  const input = await readJson(c, sourceReviewSchema);
  const user = c.get("user")!;
  const updated = reviewSource(row, input, user.id);
  return c.json({ source: toSourceDto(updated), attribution: attributionFor(updated) });
});

/* ------------------------------------------------------------------ */
/* Ressources découvertes                                              */
/* ------------------------------------------------------------------ */

function toResource(row: SourceDiscoveryRow) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    sourceId: row.sourceId,
    territory: row.territory,
    activity: row.activity as "all",
    discoveredAt: Date.parse(row.discoveredAt),
    hasGpxFile: row.hasGpxFile,
    format: row.format,
    licence: row.licence,
    status: row.status,
    reason: row.reason ?? "",
  };
}

adminSourcesRoutes.get("/discoveries", (c) => {
  const q = readQuery(c, z.object({ status: z.string().max(30).optional(), territory: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }));
  const rows = listDiscoveries(q);
  const body: DiscoveriesResponse = { discoveries: rows.map(toResource), byStatus: countDiscoveriesByStatus() };
  return c.json(body);
});

adminSourcesRoutes.patch("/discoveries/:id", async (c) => {
  const row = listDiscoveries({ limit: 500 }).find((d) => d.id === c.req.param("id"));
  if (!row) throw new HttpError(404, "not_found", "Ressource introuvable");
  const input = await readJson(c, z.object({ status: z.enum(["approved", "review_required", "forbidden"]), notes: z.string().max(2000).nullable().optional() }));
  const user = c.get("user")!;
  const updated = reviewDiscovery(row, input.status, user.id, input.notes ?? null);
  return c.json({ discovery: toResource(updated) });
});

/** Examen d'une URL candidate : constat, jamais importation. */
adminSourcesRoutes.post("/inspect", async (c) => {
  const input = await readJson(c, z.object({ url: z.string().url().max(2000), territory: z.string().max(80).nullable().optional() }));
  const result = await inspectUrl(input.url, { territory: input.territory ?? null });
  return c.json(result);
});

/* ------------------------------------------------------------------ */
/* Territoires et campagnes                                            */
/* ------------------------------------------------------------------ */

function toTerritoryDto(row: TerritoryRow): TerritoryDto {
  const territory = toTerritory(row);
  const bbox = territory.bbox;
  const traces = db.select({ n: sql<number>`count(*)` }).from(importedTraces).where(eq(importedTraces.territory, row.id)).get()?.n ?? 0;
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    parentId: row.parentId,
    aliases: row.aliases,
    bbox,
    coverage: bbox ? coverageReport(bbox) : { segments: 0, withSource: 0, withTrace: 0, withPassages: 0, averageConfidence: null },
    traces,
  };
}

adminSourcesRoutes.get("/territories", (c) => {
  const body: TerritoriesResponse = { territories: listTerritories().map(toTerritoryDto) };
  return c.json(body);
});

adminSourcesRoutes.post("/territories", async (c) => {
  const input = await readJson(c, territorySchema);
  const row = createTerritory({
    id: input.id,
    name: input.name,
    country: input.country,
    parentId: input.parentId ?? null,
    aliases: input.aliases,
    bbox: input.bbox ?? null,
  });
  return c.json({ territory: toTerritoryDto(row) }, 201);
});

/** Plan d'ouverture : les huit étapes et les requêtes, AVANT toute exécution. */
adminSourcesRoutes.get("/territories/:id/plan", (c) => {
  const row = requireTerritory(c.req.param("id"));
  const body: TerritoryPlanResponse = {
    territory: toTerritoryDto(row),
    steps: planFor(row),
    queries: queriesFor(row),
    // Renseigné pour de bon par une campagne : ici, on ne présume rien.
    networkAvailable: false,
    note: "Plan et requêtes prêts. Lancez la campagne pour savoir ce qui est réellement accessible depuis ce serveur.",
  };
  return c.json(body);
});

adminSourcesRoutes.post("/territories/:id/discover", async (c) => {
  const row = requireTerritory(c.req.param("id"));
  const input = await readJson(c, campaignSchema);
  const result = await runCampaign(row, input.urls);
  const body: CampaignResponse = {
    territory: result.territory,
    inspected: result.inspected,
    summary: result.summary,
    networkAvailable: result.networkAvailable,
    note: result.note,
  };
  return c.json(body);
});
