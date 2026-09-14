import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import {
  computeConfidence,
  confidenceLabel,
  isExpired,
  recencyWindowMin,
  SUBTYPE_BY_ID,
  summarizeVotes,
  TERMINAL_STATUSES,
  VISIBLE_STATUSES,
  type BBox,
  type ConfirmationKind,
  type ConfirmInput,
  type CreateReportInput,
  type LatLng,
  type Report,
  type ReportCategory,
  type ReportSource,
  type ReportStatus,
  type ReportSubtype,
  type UpdateReportInput,
} from "@mountain-live/core";
import { config } from "../config";
import { db } from "../db/client";
import {
  moderationReports,
  reportConfirmations,
  reports,
  users,
  type ConfirmationRow,
  type ReportRow,
  type UserRow,
} from "../db/schema";
import { deriveZoneName } from "./areas";
import { blurLocation, computeExpiresAt, deriveStatus, isSensitiveSubtype } from "./domain";
import { HttpError } from "./errors";
import { notifyNearbyUsers, notifyUser } from "./notifications";
import { listPhotosForReports } from "./photos";
import { nearestWaterPoint, updateWaterPointState } from "./reference";
import { addReputationEvent, recomputeUserStanding, removeReputationEvents, replaceReputationEvent } from "./reputation";
import { toPhoto, toReport, type ReportSerializeContext } from "./serializers";
import { formatDateFr, newId, nowIso } from "./util";

/** Entrées validées par zod, avec le sous-type déjà rétréci au type de domaine. */
export type CreateReportData = Omit<CreateReportInput, "subtype"> & { subtype: ReportSubtype };
export type UpdateReportData = Omit<UpdateReportInput, "subtype"> & { subtype?: ReportSubtype };

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/** Conditions SQL d'un signalement visible sur la carte : statut visible, non expiré. */
export function visibleConditions(now: Date): SQL[] {
  const iso = now.toISOString();
  return [
    inArray(reports.status, [...VISIBLE_STATUSES]),
    gt(reports.expiresAt, iso),
    or(isNull(reports.endsAt), gt(reports.endsAt, iso)) as SQL,
  ];
}

export function bboxConditions(box: BBox): SQL[] {
  return [
    gte(reports.displayLat, box.south),
    lte(reports.displayLat, box.north),
    gte(reports.displayLng, box.west),
    lte(reports.displayLng, box.east),
  ];
}

export interface ListFilters {
  bbox?: BBox;
  categories?: ReportCategory[];
  source?: ReportSource;
  since?: string;
  limit?: number;
}

/** Signalements visibles, priorité d'affichage décroissante puis plus récents d'abord. */
export function listVisibleReports(filters: ListFilters, now = new Date()): ReportRow[] {
  const conds: SQL[] = [...visibleConditions(now)];
  if (filters.bbox) conds.push(...bboxConditions(filters.bbox));
  if (filters.categories?.length) conds.push(inArray(reports.category, filters.categories));
  if (filters.source) conds.push(eq(reports.source, filters.source));
  if (filters.since) conds.push(gte(reports.updatedAt, filters.since));
  return db
    .select()
    .from(reports)
    .where(and(...conds))
    .orderBy(desc(reports.priority), desc(reports.createdAt))
    .limit(Math.min(2000, filters.limit ?? 500))
    .all();
}

export function getReportRow(id: string): ReportRow | undefined {
  return db.select().from(reports).where(eq(reports.id, id)).get();
}

export function isVisibleRow(row: ReportRow, now = new Date()): boolean {
  if (!VISIBLE_STATUSES.includes(row.status)) return false;
  const t = now.getTime();
  if (Date.parse(row.expiresAt) <= t) return false;
  if (row.endsAt && Date.parse(row.endsAt) <= t) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sérialisation groupée (évite les requêtes N+1)
// ---------------------------------------------------------------------------

export interface SerializeOptions {
  now?: Date;
  origin?: LatLng | null;
  /** Utilisateur courant : permet de renseigner `myConfirmation`. */
  viewerId?: string | null;
}

export function buildSerializeContext(rows: ReportRow[], opts: SerializeOptions = {}): ReportSerializeContext {
  const now = opts.now ?? new Date();
  const ids = rows.map((r) => r.id);
  const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
  const photosByReport = listPhotosForReports(ids);
  const pseudoByUser = new Map<string, string | null>();
  if (userIds.length) {
    for (const u of db
      .select({ id: users.id, pseudo: users.pseudo, deletedAt: users.deletedAt })
      .from(users)
      .where(inArray(users.id, userIds))
      .all()) {
      pseudoByUser.set(u.id, u.deletedAt ? null : u.pseudo);
    }
  }
  let myVotes: Map<string, ConfirmationKind> | null = null;
  if (opts.viewerId && ids.length) {
    myVotes = new Map();
    for (const v of db
      .select({ reportId: reportConfirmations.reportId, kind: reportConfirmations.kind })
      .from(reportConfirmations)
      .where(and(eq(reportConfirmations.userId, opts.viewerId), inArray(reportConfirmations.reportId, ids)))
      .all()) {
      myVotes.set(v.reportId, v.kind);
    }
  }
  const ctx: ReportSerializeContext = {
    now,
    origin: opts.origin ?? null,
    authorPseudo: (userId) => (userId ? (pseudoByUser.get(userId) ?? null) : null),
    photos: (reportId) => (photosByReport.get(reportId) ?? []).map(toPhoto),
  };
  if (myVotes) {
    const votes = myVotes;
    ctx.myConfirmation = (reportId) => votes.get(reportId) ?? null;
  }
  return ctx;
}

export function serializeReports(rows: ReportRow[], opts: SerializeOptions = {}): Report[] {
  const ctx = buildSerializeContext(rows, opts);
  return rows.map((r) => toReport(r, ctx));
}

export function serializeReport(row: ReportRow, opts: SerializeOptions = {}): Report {
  return serializeReports([row], opts)[0];
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

function sourceForRole(role: UserRow["role"]): ReportSource {
  if (role === "official") return "official";
  if (role === "partner") return "partner";
  return "community";
}

/** Niveau de fiabilité du contributeur utilisé par le score de confiance. */
function reporterLevel(userId: string | null, source: ReportSource): number {
  if (source === "official") return 5;
  if (!userId) return 1;
  const u = db.select({ level: users.reliabilityLevel }).from(users).where(eq(users.id, userId)).get();
  return u?.level ?? 1;
}

export function createReport(user: UserRow, input: CreateReportData): { row: ReportRow; created: boolean } {
  // Idempotence hors connexion : même clientId pour le même utilisateur → signalement existant.
  if (input.clientId) {
    const existing = db
      .select()
      .from(reports)
      .where(and(eq(reports.userId, user.id), eq(reports.clientId, input.clientId)))
      .get();
    if (existing) return { row: existing, created: false };
  }

  const def = SUBTYPE_BY_ID[input.subtype];
  const now = new Date();
  const id = newId();
  const source = sourceForRole(user.role);
  const expiresAt = computeExpiresAt(input.subtype, now, input.ttlMinutes ?? null, input.endsAt ?? null);

  // Floutage automatique des espèces sensibles (section 8) : les coordonnées exactes
  // restent en base, seules display_lat/lng sont servies.
  const sensitive = isSensitiveSubtype(input.subtype);
  const display = sensitive ? blurLocation(input.lat, input.lng, id, config.blurRadiusM) : { lat: input.lat, lng: input.lng };

  const zone = input.zone?.trim() || deriveZoneName({ lat: input.lat, lng: input.lng }, config.zoneMaxDistanceM);
  const level = reporterLevel(user.id, source);
  const score = computeConfidence({
    source,
    reporterLevel: level,
    confirmations: [],
    disputes: [],
    goneVotes: [],
    createdAt: now,
    now,
    ttlMin: lifetimeMin(now.toISOString(), expiresAt.toISOString()),
  });

  const row: ReportRow = {
    id,
    userId: user.id,
    category: def.category,
    subtype: input.subtype,
    lat: input.lat,
    lng: input.lng,
    displayLat: display.lat,
    displayLng: display.lng,
    blurred: sensitive,
    dangerLevel: input.dangerLevel ?? null,
    description: input.description?.trim() || null,
    zone,
    source,
    status: "active",
    priority: def.priority,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    confirmationsCount: 0,
    disputesCount: 0,
    resolvedVotesCount: 0,
    improvedVotesCount: 0,
    lastConfirmationAt: null,
    confidenceScore: score,
    confidenceLabel: confidenceLabel(score),
    resolvedAt: null,
    deletedAt: null,
    clientId: input.clientId ?? null,
  };
  db.insert(reports).values(row).run();

  addReputationEvent({ userId: user.id, type: "report_created", reportId: id });
  recomputeUserStanding(user.id, now);

  // État des points d'eau : une source sèche / active signalée à moins de 300 m met à jour le point.
  if (input.subtype === "spring_dry" || input.subtype === "spring_active") {
    const wp = nearestWaterPoint({ lat: input.lat, lng: input.lng }, 300);
    if (wp) updateWaterPointState(wp.id, input.subtype === "spring_dry" ? "dry" : "active", row.createdAt);
  }

  dispatchProximityAlerts(row, user.id);
  return { row, created: true };
}

/** Alertes de proximité (section 12) selon le type de signalement. */
function dispatchProximityAlerts(row: ReportRow, authorId: string | null): void {
  const label = SUBTYPE_BY_ID[row.subtype].label;
  const where = row.zone ? ` (${row.zone})` : "";
  const at = { lat: row.lat, lng: row.lng };
  if (row.subtype === "battue" || row.subtype === "hunting") {
    const until = row.endsAt ? ` jusqu'à ${formatDateFr(row.endsAt)}` : "";
    notifyNearbyUsers({
      at,
      category: row.category,
      type: "new_battue_nearby",
      title: `${label} signalée à proximité`,
      body: (d) => `Attention : ${label.toLowerCase()} signalée à ${distanceText(d)}${where}${until}.`,
      reportId: row.id,
      excludeUserId: authorId,
    });
  } else if (row.category === "danger") {
    notifyNearbyUsers({
      at,
      category: row.category,
      type: "new_danger_on_route",
      title: `${label} signalé à proximité`,
      body: (d) => `${label} signalé à ${distanceText(d)}${where}. Redoublez de prudence.`,
      reportId: row.id,
      excludeUserId: authorId,
    });
  } else if (row.subtype === "path_closed" || row.subtype === "access_restriction") {
    notifyNearbyUsers({
      at,
      category: row.category,
      type: "trail_closed",
      title: "Fermeture signalée à proximité",
      body: (d) => `${label} à ${distanceText(d)}${where}.`,
      reportId: row.id,
      excludeUserId: authorId,
    });
  } else if (row.subtype === "guard_dogs" || row.subtype === "aggressive_animal") {
    notifyNearbyUsers({
      at,
      category: row.category,
      type: "new_danger_on_route",
      title: `${label} signalés à proximité`,
      body: (d) => `${label} signalés à ${distanceText(d)}${where}.`,
      reportId: row.id,
      excludeUserId: authorId,
    });
  }
}

function distanceText(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace(".0", "").replace(".", ",")} km`;
}

// ---------------------------------------------------------------------------
// Recalcul (compteurs, confiance, statut)
// ---------------------------------------------------------------------------

interface VoteWithLevel {
  userId: string;
  kind: ConfirmationKind;
  at: string;
  voterLevel: number;
}

function votesWithLevels(reportId: string): VoteWithLevel[] {
  return db
    .select({
      userId: reportConfirmations.userId,
      kind: reportConfirmations.kind,
      at: reportConfirmations.updatedAt,
      voterLevel: users.reliabilityLevel,
    })
    .from(reportConfirmations)
    .innerJoin(users, eq(users.id, reportConfirmations.userId))
    .where(eq(reportConfirmations.reportId, reportId))
    .all();
}

export function openFlagsCount(reportId: string): number {
  return (
    db
      .select({ n: sql<number>`COUNT(DISTINCT ${moderationReports.reporterId})` })
      .from(moderationReports)
      .where(and(eq(moderationReports.reportId, reportId), inArray(moderationReports.status, ["open", "reviewing"])))
      .get()?.n ?? 0
  );
}

/** Durée de vie effective d'un signalement (minutes), pour la récence des votes. */
function lifetimeMin(createdAt: string, expiresAt: string): number {
  return Math.max(15, (Date.parse(expiresAt) - Date.parse(createdAt)) / 60_000);
}

/**
 * Recalcule compteurs, dernière confirmation, score de confiance et statut d'un signalement
 * à partir des votes réels (règles de packages/core : deriveStatus, computeConfidence).
 * Idempotent ; renvoie la ligne mise à jour.
 */
export function recomputeReport(row: ReportRow, now = new Date()): ReportRow {
  const votes = votesWithLevels(row.id);
  const ttlMin = lifetimeMin(row.createdAt, row.expiresAt);
  const summary = summarizeVotes(
    votes.map((v) => ({ kind: v.kind, createdAt: v.at })),
    now,
    recencyWindowMin(ttlMin),
  );
  const by = (k: ConfirmationKind) => votes.filter((v) => v.kind === k).map((v) => ({ at: v.at, voterLevel: v.voterLevel }));

  const score = computeConfidence({
    source: row.source,
    reporterLevel: reporterLevel(row.userId, row.source),
    confirmations: by("still_present"),
    disputes: by("disputed"),
    goneVotes: by("gone"),
    createdAt: row.createdAt,
    now,
    ttlMin,
  });

  let status: ReportStatus = deriveStatus({
    current: row.status,
    source: row.source,
    stillPresent: summary.stillPresent,
    improved: summary.improved,
    gone: summary.gone,
    disputed: summary.disputed,
    recentStillPresent: summary.recentStillPresent,
    recentGone: summary.recentGone,
    expired: isExpired({ expiresAt: row.expiresAt, endsAt: row.endsAt }, now),
    manuallyResolved: row.status === "resolved",
  });
  // Modération : trois signalements de contenu ouverts (auteurs distincts) → contesté,
  // sauf pour une source officielle (les informations officielles restent prioritaires, section 27).
  if (
    row.source !== "official" &&
    VISIBLE_STATUSES.includes(status) &&
    status !== "disputed" &&
    openFlagsCount(row.id) >= 3
  ) {
    status = "disputed";
  }

  const patch = {
    confirmationsCount: summary.stillPresent,
    disputesCount: summary.disputed,
    resolvedVotesCount: summary.gone,
    improvedVotesCount: summary.improved,
    lastConfirmationAt: summary.lastStillPresentAt,
    confidenceScore: score,
    confidenceLabel: confidenceLabel(score),
    status,
    // Résolution par consensus communautaire : on date la résolution.
    resolvedAt: status === "resolved" ? (row.resolvedAt ?? now.toISOString()) : row.resolvedAt,
    updatedAt: now.toISOString(),
  };
  db.update(reports).set(patch).where(eq(reports.id, row.id)).run();
  return { ...row, ...patch };
}

// ---------------------------------------------------------------------------
// Vote communautaire
// ---------------------------------------------------------------------------

export interface CastVoteResult {
  report: ReportRow;
  confirmation: ConfirmationRow;
  previousKind: ConfirmationKind | null;
}

export function castVote(row: ReportRow, voter: UserRow, input: ConfirmInput): CastVoteResult {
  if (row.userId === voter.id) {
    throw new HttpError(400, "own_report", "Vous ne pouvez pas voter sur votre propre signalement");
  }
  if (row.status === "deleted") throw new HttpError(404, "not_found", "Signalement introuvable");
  if (TERMINAL_STATUSES.includes(row.status)) {
    throw new HttpError(
      409,
      "report_closed",
      row.status === "expired"
        ? "Ce signalement a expiré : publiez un nouveau signalement si la situation persiste"
        : "Ce signalement est clôturé",
    );
  }

  const now = new Date();
  const iso = now.toISOString();
  const existing = db
    .select()
    .from(reportConfirmations)
    .where(and(eq(reportConfirmations.reportId, row.id), eq(reportConfirmations.userId, voter.id)))
    .get();
  const comment = input.comment?.trim() || null;
  let confirmation: ConfirmationRow;
  if (existing) {
    confirmation = { ...existing, kind: input.kind, comment, updatedAt: iso };
    db.update(reportConfirmations)
      .set({ kind: input.kind, comment, updatedAt: iso })
      .where(eq(reportConfirmations.id, existing.id))
      .run();
  } else {
    confirmation = {
      id: newId(),
      reportId: row.id,
      userId: voter.id,
      kind: input.kind,
      comment,
      createdAt: iso,
      updatedAt: iso,
    };
    db.insert(reportConfirmations).values(confirmation).run();
  }

  // « Toujours présent » prolonge la durée de vie (reconfirmation, section 5), dans la limite du maximum.
  let current = row;
  if (input.kind === "still_present") {
    const extended = extendedExpiry(row, now);
    if (extended !== row.expiresAt) {
      db.update(reports).set({ expiresAt: extended }).where(eq(reports.id, row.id)).run();
      current = { ...row, expiresAt: extended };
    }
  }

  const previousStatus = row.status;
  const updated = recomputeReport(current, now);
  applyVoteReputation(updated, voter.id, input.kind, existing?.kind ?? null);
  sendVoteNotifications(updated, voter, input.kind, previousStatus);
  return { report: updated, confirmation, previousKind: existing?.kind ?? null };
}

function extendedExpiry(row: ReportRow, now: Date): string {
  const def = SUBTYPE_BY_ID[row.subtype];
  const created = Date.parse(row.createdAt);
  const extensionMin = def.recurring ? def.defaultTtlMin : Math.max(60, Math.round(def.defaultTtlMin / 2));
  let candidate = now.getTime() + extensionMin * 60_000;
  if (row.endsAt) candidate = Math.min(candidate, Date.parse(row.endsAt));
  const maxAllowed = created + def.maxTtlMin * 60_000;
  const next = Math.min(Math.max(Date.parse(row.expiresAt), candidate), maxAllowed);
  return new Date(next).toISOString();
}

/** Journal de réputation : auteur (+/−), votant (+1), votes majoritaires (« utiles »). */
function applyVoteReputation(row: ReportRow, voterId: string, kind: ConfirmationKind, previous: ConfirmationKind | null): void {
  replaceReputationEvent({ userId: voterId, type: "confirmation_given", reportId: row.id, actorId: voterId });
  if (row.userId) {
    removeReputationEvents({ userId: row.userId, reportId: row.id, actorId: voterId, types: ["report_confirmed", "report_disputed"] });
    if (kind === "still_present") {
      addReputationEvent({ userId: row.userId, type: "report_confirmed", reportId: row.id, actorId: voterId });
    } else if (kind === "disputed") {
      addReputationEvent({ userId: row.userId, type: "report_disputed", reportId: row.id, actorId: voterId });
    }
  }
  // Vote « utile » : celui qui rejoint la majorité quand au moins deux votes sont exprimés.
  const votes = db
    .select({ userId: reportConfirmations.userId, kind: reportConfirmations.kind })
    .from(reportConfirmations)
    .where(eq(reportConfirmations.reportId, row.id))
    .all();
  const touched = new Set<string>([voterId]);
  if (row.userId) touched.add(row.userId);
  if (votes.length >= 2) {
    const tally = new Map<ConfirmationKind, number>();
    for (const v of votes) tally.set(v.kind, (tally.get(v.kind) ?? 0) + 1);
    const max = Math.max(...tally.values());
    const majority = [...tally.entries()].filter(([, n]) => n === max).map(([k]) => k);
    const unanimous = majority.length === 1;
    for (const v of votes) {
      const useful = unanimous && v.kind === majority[0];
      if (useful) {
        replaceReputationEvent({ userId: v.userId, type: "confirmation_useful", reportId: row.id, actorId: v.userId });
      } else {
        removeReputationEvents({ userId: v.userId, reportId: row.id, actorId: v.userId, types: ["confirmation_useful"] });
      }
      touched.add(v.userId);
    }
  } else if (previous !== null) {
    removeReputationEvents({ userId: voterId, reportId: row.id, actorId: voterId, types: ["confirmation_useful"] });
  }
  for (const id of touched) recomputeUserStanding(id);
}

function sendVoteNotifications(row: ReportRow, voter: UserRow, kind: ConfirmationKind, previousStatus: ReportStatus): void {
  if (!row.userId) return;
  const label = SUBTYPE_BY_ID[row.subtype].label;
  const zone = row.zone ? ` (${row.zone})` : "";
  if (kind === "still_present") {
    notifyUser({
      userId: row.userId,
      type: "report_confirmed",
      title: "Signalement confirmé",
      body: `${voter.pseudo} confirme votre signalement « ${label} »${zone}. ${row.confirmationsCount} confirmation${row.confirmationsCount > 1 ? "s" : ""} au total.`,
      reportId: row.id,
    });
  }
  if (row.status === "probably_resolved" && previousStatus !== "probably_resolved") {
    notifyUser({
      userId: row.userId,
      type: "report_resolved",
      title: "Signalement probablement résolu",
      body: `Plusieurs utilisateurs indiquent que « ${label} »${zone} n'est plus présent. Vous pouvez le clôturer ou le reconfirmer.`,
      reportId: row.id,
    });
  } else if (row.status === "resolved" && previousStatus !== "resolved") {
    notifyUser({
      userId: row.userId,
      type: "report_resolved",
      title: "Signalement résolu",
      body: `La communauté a confirmé que « ${label} »${zone} n'est plus présent : le signalement est clôturé.`,
      reportId: row.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Mise à jour / suppression
// ---------------------------------------------------------------------------

/** Mise à jour par l'auteur ou un modérateur (PATCH /reports/:id). */
export function updateReport(row: ReportRow, input: UpdateReportData, editor: UserRow): ReportRow {
  const now = new Date();
  const iso = now.toISOString();
  const patch: Partial<ReportRow> = { updatedAt: iso };
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.dangerLevel !== undefined) patch.dangerLevel = input.dangerLevel ?? null;
  if (input.endsAt !== undefined) patch.endsAt = input.endsAt ?? null;

  const subtype = input.subtype ?? row.subtype;
  if (input.subtype && input.subtype !== row.subtype) {
    const def = SUBTYPE_BY_ID[input.subtype];
    patch.subtype = input.subtype;
    patch.category = def.category;
    patch.priority = def.priority;
    const sensitive = isSensitiveSubtype(input.subtype);
    const display = sensitive ? blurLocation(row.lat, row.lng, row.id, config.blurRadiusM) : { lat: row.lat, lng: row.lng };
    patch.displayLat = display.lat;
    patch.displayLng = display.lng;
    patch.blurred = sensitive;
    // Nouveau sous-type : la durée de vie repart de maintenant.
    patch.expiresAt = computeExpiresAt(input.subtype, now, null, patch.endsAt ?? row.endsAt).toISOString();
  } else if (input.endsAt !== undefined) {
    patch.expiresAt = computeExpiresAt(subtype, new Date(row.createdAt), null, patch.endsAt ?? null).toISOString();
    if (!patch.endsAt) patch.expiresAt = row.expiresAt;
  }

  if (input.status === "resolved") {
    patch.status = "resolved";
    patch.resolvedAt = iso;
  } else if (input.status === "active") {
    patch.status = "active";
    patch.resolvedAt = null;
    if (Date.parse(patch.expiresAt ?? row.expiresAt) <= now.getTime()) {
      patch.expiresAt = computeExpiresAt(subtype, now, null, patch.endsAt ?? row.endsAt).toISOString();
    }
  }

  db.update(reports).set(patch).where(eq(reports.id, row.id)).run();
  let updated: ReportRow = { ...row, ...patch };
  // Le statut dérivé est recalculé sauf clôture manuelle (résolu) qui prime.
  updated = recomputeReport(updated, now);

  notifyVoters(updated, editor, input.status === "resolved" ? "resolved" : "updated");
  return updated;
}

/** Prévient les utilisateurs ayant voté (hors éditeur) d'une mise à jour ou d'une clôture. */
function notifyVoters(row: ReportRow, editor: UserRow, kind: "resolved" | "updated"): void {
  const voters = db
    .select({ userId: reportConfirmations.userId })
    .from(reportConfirmations)
    .where(and(eq(reportConfirmations.reportId, row.id), ne(reportConfirmations.userId, editor.id)))
    .all();
  const label = SUBTYPE_BY_ID[row.subtype].label;
  const zone = row.zone ? ` (${row.zone})` : "";
  for (const v of voters) {
    notifyUser({
      userId: v.userId,
      type: kind === "resolved" ? "report_resolved" : "report_updated",
      title: kind === "resolved" ? "Signalement résolu" : "Signalement mis à jour",
      body:
        kind === "resolved"
          ? `Le signalement « ${label} »${zone} que vous aviez commenté est déclaré résolu.`
          : `Le signalement « ${label} »${zone} que vous aviez commenté a été mis à jour.`,
      reportId: row.id,
    });
  }
}

export function softDeleteReport(row: ReportRow): ReportRow {
  const iso = nowIso();
  db.update(reports).set({ status: "deleted", deletedAt: iso, updatedAt: iso }).where(eq(reports.id, row.id)).run();
  if (row.userId) recomputeUserStanding(row.userId);
  return { ...row, status: "deleted", deletedAt: iso, updatedAt: iso };
}

// ---------------------------------------------------------------------------
// Administration / communauté
// ---------------------------------------------------------------------------

export interface AdminListFilters {
  status?: ReportStatus;
  category?: ReportCategory;
  q?: string;
  page: number;
  includeInactive: boolean;
  pageSize?: number;
}

export function adminListReports(f: AdminListFilters, now = new Date()): { rows: ReportRow[]; total: number } {
  const conds: SQL[] = [];
  if (f.status) conds.push(eq(reports.status, f.status));
  else if (!f.includeInactive) conds.push(...visibleConditions(now));
  else conds.push(ne(reports.status, "deleted"));
  if (f.category) conds.push(eq(reports.category, f.category));
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conds.push(
      or(
        sql`${reports.description} LIKE ${like} ESCAPE '\\'`,
        sql`${reports.zone} LIKE ${like} ESCAPE '\\'`,
        sql`${reports.subtype} LIKE ${like} ESCAPE '\\'`,
        eq(reports.id, f.q.trim()),
      ) as SQL,
    );
  }
  const where = conds.length ? and(...conds) : undefined;
  const pageSize = f.pageSize ?? 20;
  const total = db.select({ n: sql<number>`COUNT(*)` }).from(reports).where(where).get()?.n ?? 0;
  const rows = db
    .select()
    .from(reports)
    .where(where)
    .orderBy(desc(reports.createdAt))
    .limit(pageSize)
    .offset((Math.max(1, f.page) - 1) * pageSize)
    .all();
  return { rows, total };
}

export function listConfirmations(reportId: string): ConfirmationRow[] {
  return db
    .select()
    .from(reportConfirmations)
    .where(eq(reportConfirmations.reportId, reportId))
    .orderBy(asc(reportConfirmations.createdAt))
    .all();
}
