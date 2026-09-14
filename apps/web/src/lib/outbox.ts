import type { CreateReportInput } from "@mountain-live/core";
import { db, type OutboxItem } from "./db";

/**
 * File d'attente hors connexion. `enqueue*` est utilisé par les formulaires ;
 * `flushOutbox` est appelé par le gestionnaire de synchronisation (features/offline).
 */
export function newClientId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function enqueueReport(payload: CreateReportInput, photo?: Blob): Promise<string> {
  const id = payload.clientId ?? newClientId();
  const item: OutboxItem = { id, kind: "create_report", createdAt: Date.now(), attempts: 0, payload: { ...payload, clientId: id }, photo };
  await db.outbox.put(item);
  return id;
}

export async function enqueueConfirmation(reportId: string, kind: "still_present" | "improved" | "gone" | "disputed", comment?: string | null) {
  const id = newClientId();
  await db.outbox.put({ id, kind: "confirm", createdAt: Date.now(), attempts: 0, payload: { reportId, kind, comment } });
  return id;
}

export async function outboxCount(): Promise<number> {
  return db.outbox.count();
}

/** Implémenté par features/offline/sync.ts (enregistré au démarrage). */
export type FlushFn = () => Promise<{ sent: number; failed: number }>;
let flushImpl: FlushFn | null = null;
export function registerFlush(fn: FlushFn) {
  flushImpl = fn;
}
export async function flushOutbox() {
  if (!flushImpl) return { sent: 0, failed: 0 };
  return flushImpl();
}
