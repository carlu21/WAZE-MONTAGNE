import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  partners,
  reportConfirmations,
  reports,
  userReputationEvents,
  users,
  type ReputationEventType,
  type UserRow,
} from "../db/schema";
import { computeBadges, computeReliability } from "./domain";
import { newId, nowIso } from "./util";

/**
 * Réputation (section 16) : journal interne d'événements pondérés, jamais exposé tel quel.
 * Le niveau public (1..5) et les badges sont recalculés après chaque événement.
 */

export const REPUTATION_DELTAS: Record<ReputationEventType, number> = {
  report_created: 2,
  report_confirmed: 3,
  report_disputed: -3,
  confirmation_given: 1,
  confirmation_useful: 1,
  flag_upheld: -15,
  manual: 0,
};

export interface ReputationEventInput {
  userId: string;
  type: ReputationEventType;
  delta?: number;
  reportId?: string | null;
  actorId?: string | null;
  refId?: string | null;
}

export function addReputationEvent(input: ReputationEventInput): void {
  db.insert(userReputationEvents)
    .values({
      id: newId(),
      userId: input.userId,
      type: input.type,
      delta: input.delta ?? REPUTATION_DELTAS[input.type],
      reportId: input.reportId ?? null,
      actorId: input.actorId ?? null,
      refId: input.refId ?? null,
      createdAt: nowIso(),
    })
    .run();
}

/**
 * Remplace les événements (user, type, report, actor) existants : un vote modifié
 * ne doit compter qu'une fois.
 */
export function replaceReputationEvent(input: ReputationEventInput & { reportId: string; actorId: string }): void {
  db.delete(userReputationEvents)
    .where(
      and(
        eq(userReputationEvents.userId, input.userId),
        eq(userReputationEvents.type, input.type),
        eq(userReputationEvents.reportId, input.reportId),
        eq(userReputationEvents.actorId, input.actorId),
      ),
    )
    .run();
  addReputationEvent(input);
}

export function removeReputationEvents(filter: { userId: string; reportId: string; actorId: string; types: ReputationEventType[] }): void {
  for (const type of filter.types) {
    db.delete(userReputationEvents)
      .where(
        and(
          eq(userReputationEvents.userId, filter.userId),
          eq(userReputationEvents.type, type),
          eq(userReputationEvents.reportId, filter.reportId),
          eq(userReputationEvents.actorId, filter.actorId),
        ),
      )
      .run();
  }
}

/** Un événement référencé (ex. flag) existe-t-il déjà ? (idempotence) */
export function hasReputationEvent(userId: string, type: ReputationEventType, refId: string): boolean {
  return !!db
    .select({ id: userReputationEvents.id })
    .from(userReputationEvents)
    .where(
      and(eq(userReputationEvents.userId, userId), eq(userReputationEvents.type, type), eq(userReputationEvents.refId, refId)),
    )
    .get();
}

/**
 * Recalcule compteurs publics, score de réputation, niveau de fiabilité et badges
 * d'un utilisateur à partir des données réelles (idempotent).
 */
export function recomputeUserStanding(userId: string, now = new Date()): UserRow | undefined {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return undefined;

  const reportStats = db
    .select({
      total: sql<number>`COUNT(*)`,
      // « Confirmé » : a atteint le statut confirmé (deux votes communautaires, ou un seul pour un
      // partenaire) ; « contesté » : est passé au statut contesté (deux contestations au moins).
      confirmed: sql<number>`SUM(CASE WHEN ${reports.confirmationsCount} >= 2 OR ${reports.status} IN ('confirmed', 'probably_resolved') THEN 1 ELSE 0 END)`,
      disputed: sql<number>`SUM(CASE WHEN ${reports.disputesCount} >= 2 OR ${reports.status} = 'disputed' THEN 1 ELSE 0 END)`,
    })
    .from(reports)
    .where(and(eq(reports.userId, userId), ne(reports.status, "deleted")))
    .get();

  const zoneStats = db
    .select({ zone: reports.zone, n: sql<number>`COUNT(*)` })
    .from(reports)
    .where(and(eq(reports.userId, userId), sql`${reports.confirmationsCount} >= 2`, isNotNull(reports.zone)))
    .groupBy(reports.zone)
    .all();
  const confirmedInSameZoneMax = zoneStats.reduce((m, z) => Math.max(m, z.n), 0);

  const confirmationsTotal =
    db
      .select({ n: sql<number>`COUNT(*)` })
      .from(reportConfirmations)
      .where(eq(reportConfirmations.userId, userId))
      .get()?.n ?? 0;

  const events = db
    .select({ type: userReputationEvents.type, n: sql<number>`COUNT(*)`, sum: sql<number>`SUM(${userReputationEvents.delta})` })
    .from(userReputationEvents)
    .where(eq(userReputationEvents.userId, userId))
    .groupBy(userReputationEvents.type)
    .all();
  const count = (t: ReputationEventType) => events.find((e) => e.type === t)?.n ?? 0;
  const reputationScore = Math.max(0, events.reduce((s, e) => s + (e.sum ?? 0), 0));

  const isPartner = user.role === "partner" || user.role === "official";
  const verified = isPartner
    ? !!db.select({ id: partners.id }).from(partners).where(and(eq(partners.userId, userId), isNotNull(partners.verifiedAt))).get()
    : false;

  const accountAgeDays = Math.max(0, (now.getTime() - Date.parse(user.createdAt)) / 86_400_000);
  const reliability = computeReliability({
    reportsTotal: reportStats?.total ?? 0,
    reportsConfirmed: reportStats?.confirmed ?? 0,
    reportsDisputed: reportStats?.disputed ?? 0,
    usefulConfirmations: count("confirmation_useful"),
    flagsUpheldAgainst: count("flag_upheld"),
    accountAgeDays,
  });
  // Les comptes officiels et partenaires vérifiés sont considérés fiables d'emblée.
  const reliabilityLevel = user.role === "official" ? 5 : verified ? Math.max(4, reliability.level) : reliability.level;

  const badges = computeBadges({
    reportsTotal: reportStats?.total ?? 0,
    confirmationsTotal,
    confirmedInSameZoneMax,
    usefulConfirmations: count("confirmation_useful"),
    isVerifiedPartner: verified,
  });

  const patch = {
    reportsCount: reportStats?.total ?? 0,
    confirmationsCount: confirmationsTotal,
    reputationScore,
    reliabilityLevel,
    badges,
    updatedAt: nowIso(),
  };
  db.update(users).set(patch).where(eq(users.id, userId)).run();
  return { ...user, ...patch };
}
