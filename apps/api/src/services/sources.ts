/**
 * Registre des sources de données (section 4 du cahier des charges GPX).
 *
 * Rôle : répondre, pour n'importe quelle géométrie de la base, à la question
 * « d'où vient ce chemin, et avons-nous le droit de l'utiliser ? ».
 *
 * Deux principes, non négociables :
 *
 * 1. **Une source n'est jamais exploitable par défaut.** Elle naît en
 *    `review_required` avec la licence `unknown`. Seule une vérification
 *    humaine, enregistrée (`lastCheckedAt`, `checkedBy`), peut la faire passer
 *    en `approved` — et `canAutoImport` refuse au-delà d'un certain âge de
 *    vérification, parce que les conditions d'utilisation changent.
 * 2. **La fiabilité se plafonne.** Une source jamais vérifiée ne peut pas
 *    dépasser `UNVERIFIED_RELIABILITY_CAP`, quoi qu'en dise l'administrateur.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  UNVERIFIED_RELIABILITY_CAP,
  attributionLine,
  canAutoImport,
  licenceTerms,
  reuseDecision,
  type DataSource,
  type LicenceId,
  type ReuseDecision,
  type SourceStatus,
  type SourceType,
} from "@mountain-live/core";
import { db } from "../db/client";
import { dataSources, type DataSourceRow } from "../db/schema";
import { HttpError } from "./errors";
import { newId, nowIso } from "./util";

export function toDataSource(row: DataSourceRow): DataSource {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.type,
    country: row.country,
    territory: row.territory,
    licence: row.licence,
    licenceUrl: row.licenceUrl,
    commercialReuseAllowed: row.commercialReuseAllowed,
    redistributionAllowed: row.redistributionAllowed,
    attributionRequired: row.attributionRequired,
    attributionText: row.attributionText,
    apiAvailable: row.apiAvailable,
    apiUrl: row.apiUrl,
    lastCheckedAt: row.lastCheckedAt,
    reliabilityScore: row.reliabilityScore,
    status: row.status,
    notes: row.notes,
  };
}

export interface SourceInput {
  name: string;
  url: string;
  type: SourceType;
  country?: string;
  territory?: string | null;
  licence?: LicenceId;
  licenceUrl?: string | null;
  attributionText?: string | null;
  apiAvailable?: boolean;
  apiUrl?: string | null;
  reliabilityScore?: number;
  notes?: string | null;
}

/**
 * Droits déduits de la licence. Les colonnes `*_allowed` sont dérivées, jamais
 * saisies à la main : personne ne doit pouvoir déclarer qu'une licence
 * non commerciale autorise un usage commercial.
 */
function rightsOf(licence: LicenceId): Pick<DataSourceRow, "commercialReuseAllowed" | "redistributionAllowed" | "attributionRequired"> {
  const terms = licenceTerms(licence);
  return {
    commercialReuseAllowed: terms.commercialReuse,
    redistributionAllowed: terms.redistribution,
    attributionRequired: terms.attributionRequired,
  };
}

export function createSource(input: SourceInput): DataSourceRow {
  const now = nowIso();
  const licence = input.licence ?? "unknown";
  const row: DataSourceRow = {
    id: newId(),
    name: input.name,
    url: input.url,
    type: input.type,
    country: input.country ?? "FR",
    territory: input.territory ?? null,
    licence,
    licenceUrl: input.licenceUrl ?? null,
    ...rightsOf(licence),
    attributionText: input.attributionText ?? null,
    apiAvailable: input.apiAvailable ?? false,
    apiUrl: input.apiUrl ?? null,
    // Une source neuve n'a jamais été vérifiée : elle ne peut rien alimenter.
    lastCheckedAt: null,
    checkedBy: null,
    reliabilityScore: Math.min(input.reliabilityScore ?? 0, UNVERIFIED_RELIABILITY_CAP),
    status: "review_required",
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(dataSources).values(row).run();
  return row;
}

export function sourceById(id: string): DataSourceRow | undefined {
  return db.select().from(dataSources).where(eq(dataSources.id, id)).get();
}

export function listSources(filter: { status?: SourceStatus; type?: SourceType; territory?: string; limit?: number } = {}): DataSourceRow[] {
  const conds = [];
  if (filter.status) conds.push(eq(dataSources.status, filter.status));
  if (filter.type) conds.push(eq(dataSources.type, filter.type));
  if (filter.territory) conds.push(eq(dataSources.territory, filter.territory));
  return db
    .select()
    .from(dataSources)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(dataSources.reliabilityScore), dataSources.name)
    .limit(Math.min(filter.limit ?? 200, 500))
    .all();
}

export interface SourceReview {
  status: SourceStatus;
  licence?: LicenceId;
  licenceUrl?: string | null;
  attributionText?: string | null;
  reliabilityScore?: number;
  notes?: string | null;
}

/**
 * Vérification humaine des conditions d'une source. C'est le SEUL chemin vers
 * `approved` : la date et l'auteur de la vérification sont enregistrés, et une
 * source approuvée sans licence identifiée est refusée — approuver « on ne
 * sait pas » n'a aucun sens juridique.
 */
export function reviewSource(row: DataSourceRow, review: SourceReview, reviewerId: string): DataSourceRow {
  const licence = review.licence ?? row.licence;
  if (review.status === "approved" && licence === "unknown") {
    throw new HttpError(400, "licence_unknown", "Impossible d'approuver une source dont la licence n'est pas identifiée.");
  }
  const now = nowIso();
  const values = {
    licence,
    licenceUrl: review.licenceUrl ?? row.licenceUrl,
    ...rightsOf(licence),
    attributionText: review.attributionText ?? row.attributionText,
    reliabilityScore: Math.max(0, Math.min(100, review.reliabilityScore ?? row.reliabilityScore)),
    status: review.status,
    notes: review.notes ?? row.notes,
    lastCheckedAt: now,
    checkedBy: reviewerId,
    updatedAt: now,
  };
  db.update(dataSources).set(values).where(eq(dataSources.id, row.id)).run();
  return { ...row, ...values };
}

/** Décision de réutilisation pour une source donnée, prête à afficher. */
export function decisionFor(row: DataSourceRow, opts: { robotsAllows?: boolean; allowShareAlike?: boolean } = {}): ReuseDecision {
  return reuseDecision({
    licence: row.licence,
    sourceStatus: row.status,
    robotsAllows: opts.robotsAllows,
    allowShareAlike: opts.allowShareAlike,
    attributionText: row.attributionText,
    sourceName: row.name,
  });
}

/** Une source peut-elle alimenter automatiquement la base ? (sections 3 et 5) */
export function autoImportAllowed(row: DataSourceRow, now = Date.now()): boolean {
  return canAutoImport(toDataSource(row), now);
}

/** Mention d'attribution à afficher pour cette source (section 22). */
export function attributionFor(row: DataSourceRow): string | null {
  return attributionLine(toDataSource(row));
}

export function countSourcesByStatus(): Record<string, number> {
  const rows = db
    .select({ status: dataSources.status, n: sql<number>`count(*)` })
    .from(dataSources)
    .groupBy(dataSources.status)
    .all();
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
