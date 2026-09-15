/**
 * Découverte des sources et campagnes par territoire (sections 1, 2, 3, 16, 23).
 *
 * Ce service ORCHESTRE ; l'intelligence (construction des requêtes,
 * classification, robots.txt, décision de réutilisation) vit dans
 * `@mountain-live/core`, qui reste pur et testable.
 *
 * Trois garde-fous, dans cet ordre :
 *
 * 1. **robots.txt d'abord.** Aucune récupération n'est tentée sur un chemin
 *    que le site interdit (section 3). Le fichier est relu à chaque campagne,
 *    jamais mis en cache indéfiniment.
 * 2. **Les droits ensuite.** Une ressource dont la licence n'est pas identifiée
 *    est enregistrée en `review_required` : elle apparaît au back-office, elle
 *    n'entre pas dans la base.
 * 3. **Aucun nombre inventé.** Le bilan d'une campagne ne compte que ce qui a
 *    réellement été constaté. Quand le réseau sortant est fermé, la campagne le
 *    dit et rend un plan d'action, pas des résultats imaginaires.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  buildDiscoveryQueries,
  classifySource,
  detectLicence,
  gpxHints,
  parseRobotsTxt,
  resourceId,
  reuseDecision,
  robotsAllows,
  summarizeDiscovery,
  territoryPlan,
  type DiscoveredResource,
  type DiscoveryQuery,
  type Territory,
  type TerritoryStep,
} from "@mountain-live/core";
import { db } from "../db/client";
import { sourceDiscoveries, territories, type SourceDiscoveryRow, type TerritoryRow } from "../db/schema";
import { HttpError } from "./errors";
import { newId, nowIso } from "./util";

/** Agent déclaré lors de toute requête sortante : une collecte s'annonce. */
export const USER_AGENT = "MountainLiveBot/0.1 (+https://mountain-live.example/bot)";

/** Délai d'attente d'une requête sortante (ms). */
export const FETCH_TIMEOUT_MS = 15_000;

/** Taille maximale récupérée pour une page ou un fichier (octets). */
export const MAX_FETCH_BYTES = 8 * 1024 * 1024;

export function toTerritory(row: TerritoryRow, parents: readonly TerritoryRow[] = []): Territory {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    parents: parents.map((p) => p.name),
    bbox:
      row.minLat !== null && row.minLng !== null && row.maxLat !== null && row.maxLng !== null
        ? { west: row.minLng, south: row.minLat, east: row.maxLng, north: row.maxLat }
        : null,
    aliases: row.aliases,
  };
}

export function territoryById(id: string): TerritoryRow | undefined {
  return db.select().from(territories).where(eq(territories.id, id)).get();
}

/** Chaîne de rattachement d'un territoire, du plus proche au plus large. */
export function ancestorsOf(row: TerritoryRow, maxDepth = 5): TerritoryRow[] {
  const out: TerritoryRow[] = [];
  let current = row.parentId;
  const seen = new Set<string>([row.id]);
  while (current && out.length < maxDepth && !seen.has(current)) {
    const parent = territoryById(current);
    if (!parent) break;
    seen.add(parent.id);
    out.push(parent);
    current = parent.parentId;
  }
  return out;
}

export function listTerritories(): TerritoryRow[] {
  return db.select().from(territories).orderBy(territories.country, territories.name).all();
}

/** Plan d'ouverture d'un territoire (section 23) : les huit étapes, en clair. */
export function planFor(row: TerritoryRow): TerritoryStep[] {
  return territoryPlan(toTerritory(row, ancestorsOf(row)));
}

/** Requêtes que la campagne soumettrait (section 1) : visibles avant d'être lancées. */
export function queriesFor(row: TerritoryRow, limit = 120): DiscoveryQuery[] {
  return buildDiscoveryQueries(toTerritory(row, ancestorsOf(row)), { limit });
}

/* ------------------------------------------------------------------ */
/* Accès réseau sortant                                                */
/* ------------------------------------------------------------------ */

export type FetchOutcome =
  | { ok: true; status: number; body: string; contentType: string | null; finalUrl: string }
  | { ok: false; reason: "blocked" | "robots" | "http" | "timeout" | "too_large" | "invalid"; detail: string };

/**
 * Récupère une ressource. Distingue explicitement un refus de la politique
 * réseau de l'environnement (`blocked`) d'une erreur du site : sans cette
 * distinction, une campagne vide passerait pour « rien à trouver » alors que
 * rien n'a pu être tenté.
 */
export async function fetchResource(url: string, opts: { accept?: string } = {}): Promise<FetchOutcome> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid", detail: "URL invalide." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "invalid", detail: "Seuls http et https sont acceptés." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: opts.accept ?? "*/*" },
    });
    if (!res.ok) return { ok: false, reason: "http", detail: `Réponse ${res.status} du serveur.` };
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MAX_FETCH_BYTES) return { ok: false, reason: "too_large", detail: "Ressource trop volumineuse." };
    const body = await res.text();
    if (body.length > MAX_FETCH_BYTES) return { ok: false, reason: "too_large", detail: "Ressource trop volumineuse." };
    return { ok: true, status: res.status, body, contentType: res.headers.get("content-type"), finalUrl: res.url || parsed.toString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(message)) return { ok: false, reason: "timeout", detail: "Délai dépassé." };
    // Un refus du mandataire sortant (403 CONNECT, DNS coupé) n'est pas une
    // absence de données : c'est une absence d'accès, et cela se dit.
    return { ok: false, reason: "blocked", detail: `Accès sortant refusé ou indisponible (${message}).` };
  } finally {
    clearTimeout(timer);
  }
}

/** Vérifie le robots.txt d'un hôte avant toute récupération (section 3). */
export async function robotsGate(url: string): Promise<{ allowed: boolean; checked: boolean; detail: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, checked: false, detail: "URL invalide." };
  }
  const res = await fetchResource(`${parsed.origin}/robots.txt`, { accept: "text/plain" });
  if (!res.ok) {
    // Robots.txt introuvable (404) : le site n'interdit rien. Injoignable :
    // on ne présume pas de l'autorisation, la ressource part en revue.
    if (res.reason === "http") return { allowed: true, checked: true, detail: "Aucun robots.txt : rien n'est interdit." };
    return { allowed: false, checked: false, detail: `robots.txt non vérifiable : ${res.detail}` };
  }
  const rules = parseRobotsTxt(res.body);
  const allowed = robotsAllows(rules, parsed.pathname + parsed.search, USER_AGENT);
  return { allowed, checked: true, detail: allowed ? "Autorisé par robots.txt." : "Chemin interdit par robots.txt." };
}

/* ------------------------------------------------------------------ */
/* Ressources découvertes                                              */
/* ------------------------------------------------------------------ */

export function recordDiscovery(resource: DiscoveredResource, query: string | null = null): SourceDiscoveryRow {
  const existing = db.select().from(sourceDiscoveries).where(eq(sourceDiscoveries.id, resource.id)).get();
  const row: SourceDiscoveryRow = {
    id: resource.id,
    url: resource.url,
    title: resource.title,
    sourceId: resource.sourceId,
    territory: resource.territory,
    activity: resource.activity,
    format: resource.format,
    hasGpxFile: resource.hasGpxFile,
    licence: resource.licence,
    // Une décision humaine déjà prise n'est jamais écrasée par une relance.
    status: existing?.reviewedAt ? existing.status : resource.status,
    reason: resource.reason,
    query: query ?? existing?.query ?? null,
    discoveredAt: existing?.discoveredAt ?? new Date(resource.discoveredAt).toISOString(),
    reviewedBy: existing?.reviewedBy ?? null,
    reviewedAt: existing?.reviewedAt ?? null,
    notes: existing?.notes ?? null,
  };
  db.insert(sourceDiscoveries).values(row).onConflictDoUpdate({ target: sourceDiscoveries.id, set: row }).run();
  return row;
}

export function listDiscoveries(filter: { status?: string; territory?: string; limit?: number } = {}): SourceDiscoveryRow[] {
  const conds = [];
  if (filter.status) conds.push(eq(sourceDiscoveries.status, filter.status as SourceDiscoveryRow["status"]));
  if (filter.territory) conds.push(eq(sourceDiscoveries.territory, filter.territory));
  return db
    .select()
    .from(sourceDiscoveries)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sourceDiscoveries.discoveredAt))
    .limit(Math.min(filter.limit ?? 100, 500))
    .all();
}

export function reviewDiscovery(row: SourceDiscoveryRow, status: SourceDiscoveryRow["status"], reviewerId: string, notes: string | null): SourceDiscoveryRow {
  const values = { status, reviewedBy: reviewerId, reviewedAt: nowIso(), notes };
  db.update(sourceDiscoveries).set(values).where(eq(sourceDiscoveries.id, row.id)).run();
  return { ...row, ...values };
}

/* ------------------------------------------------------------------ */
/* Examen d'une URL candidate                                          */
/* ------------------------------------------------------------------ */

export interface InspectionResult {
  resource: DiscoveredResource;
  robots: { allowed: boolean; checked: boolean; detail: string };
  /** Liens de traces repérés dans la page (non résolus, non téléchargés). */
  links: string[];
  /** Le réseau sortant a-t-il pu être utilisé ? */
  reachable: boolean;
}

/**
 * Examine une URL candidate : robots.txt, type de source, présence de traces,
 * licence détectée, décision. **Rien n'est importé ici** — c'est un constat.
 */
export async function inspectUrl(url: string, context: { territory?: string | null; query?: string | null } = {}): Promise<InspectionResult> {
  const now = Date.now();
  const classification = classifySource(url);
  const robots = await robotsGate(url);

  const base: DiscoveredResource = {
    id: resourceId(url),
    url,
    title: null,
    sourceId: null,
    territory: context.territory ?? null,
    activity: "all",
    discoveredAt: now,
    hasGpxFile: false,
    format: "unknown",
    licence: "unknown",
    status: "review_required",
    reason: "Ressource non encore examinée.",
  };

  if (!robots.allowed) {
    const decision = reuseDecision({ licence: "unknown", robotsAllows: false });
    return {
      resource: { ...base, status: robots.checked ? "forbidden" : "review_required", reason: robots.detail },
      robots,
      links: [],
      reachable: robots.checked,
    };
  }

  const page = await fetchResource(url, { accept: "application/gpx+xml,application/xml,text/html;q=0.9,*/*;q=0.8" });
  if (!page.ok) {
    return {
      resource: {
        ...base,
        reason:
          page.reason === "blocked"
            ? "Accès sortant indisponible depuis cet environnement : à réexaminer depuis un environnement connecté."
            : `Ressource non récupérable : ${page.detail}`,
      },
      robots,
      links: [],
      reachable: page.reason !== "blocked",
    };
  }

  const isGpxBody = /<gpx\b/i.test(page.body);
  const hints = gpxHints(page.body);
  const licence = detectLicence(`${page.body.slice(0, 20_000)} ${url}`);
  const decision = reuseDecision({ licence, robotsAllows: true });

  return {
    resource: {
      ...base,
      title: page.body.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1]?.trim() ?? null,
      hasGpxFile: isGpxBody || hints.links.some((l) => /\.gpx(\?|$)/i.test(l)),
      format: isGpxBody ? "gpx" : hints.mentionsApi ? "api" : hints.links.length > 0 ? "gpx" : "unknown",
      licence,
      status: decision.status,
      reason: decision.reason,
    },
    robots,
    links: hints.links.slice(0, 50),
    reachable: true,
  };
}

/* ------------------------------------------------------------------ */
/* Campagne sur un territoire                                          */
/* ------------------------------------------------------------------ */

export interface CampaignResult {
  territory: string;
  steps: TerritoryStep[];
  queries: DiscoveryQuery[];
  /** Ressources examinées au cours de cette campagne. */
  inspected: DiscoveredResource[];
  summary: ReturnType<typeof summarizeDiscovery>;
  /** Le réseau sortant est-il utilisable depuis cet environnement ? */
  networkAvailable: boolean;
  /** Ce qu'il reste à faire, en clair, quand la campagne n'a pas pu tout faire. */
  note: string;
}

/**
 * Lance une campagne sur un territoire. Les URL candidates sont fournies par
 * l'appelant (back-office, catalogue open data, liste partenaire) : ce service
 * n'interroge aucun moteur de recherche généraliste, ce que leurs conditions
 * d'utilisation interdisent généralement.
 */
export async function runCampaign(row: TerritoryRow, candidateUrls: readonly string[] = []): Promise<CampaignResult> {
  const territory = toTerritory(row, ancestorsOf(row));
  const steps = territoryPlan(territory);
  const queries = buildDiscoveryQueries(territory, { limit: 120 });
  const inspected: DiscoveredResource[] = [];
  let networkAvailable = candidateUrls.length === 0;

  for (const url of candidateUrls.slice(0, 50)) {
    const result = await inspectUrl(url, { territory: row.id });
    if (result.reachable) networkAvailable = true;
    inspected.push(result.resource);
    recordDiscovery(result.resource, null);
  }

  const summary = summarizeDiscovery(inspected);
  return {
    territory: row.id,
    steps,
    queries,
    inspected,
    summary,
    networkAvailable,
    note: networkAvailable
      ? `${inspected.length} ressource(s) examinée(s) ; ${summary.byStatus.review_required ?? 0} à vérifier avant toute exploitation.`
      : "Aucun accès réseau sortant depuis cet environnement : les requêtes et le plan sont prêts, la collecte doit être relancée depuis un environnement connecté.",
  };
}

export function countDiscoveriesByStatus(): Record<string, number> {
  const rows = db
    .select({ status: sourceDiscoveries.status, n: sql<number>`count(*)` })
    .from(sourceDiscoveries)
    .groupBy(sourceDiscoveries.status)
    .all();
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export function requireTerritory(id: string): TerritoryRow {
  const row = territoryById(id);
  if (!row) throw new HttpError(404, "not_found", "Territoire introuvable");
  return row;
}

export function createTerritory(input: { id?: string; name: string; country?: string; parentId?: string | null; aliases?: string[]; bbox?: { west: number; south: number; east: number; north: number } | null }): TerritoryRow {
  const row: TerritoryRow = {
    id: input.id ?? newId(),
    name: input.name,
    country: input.country ?? "FR",
    parentId: input.parentId ?? null,
    aliases: input.aliases ?? [],
    minLat: input.bbox?.south ?? null,
    minLng: input.bbox?.west ?? null,
    maxLat: input.bbox?.north ?? null,
    maxLng: input.bbox?.east ?? null,
    createdAt: nowIso(),
  };
  db.insert(territories).values(row).onConflictDoUpdate({ target: territories.id, set: row }).run();
  return row;
}
