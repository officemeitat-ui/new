import { and, eq, inArray, sql, withSystem, withTenant, type Database } from "@nexus/db";
import { knowledgeDocuments, knowledgeSources, runs } from "@nexus/db/schema";

/** A run without a heartbeat for this long has lost its worker (crash, restart, deploy). */
export const STALE_RUN_MS = 10 * 60_000;
/** A queued run nobody picked up for this long is handed to the queue again. */
export const STALE_QUEUED_MS = 2 * 60_000;
/** A document still "processing" after this long is queued again … */
export const STALE_DOCUMENT_MS = 10 * 60_000;
/** … and given up after this long. */
export const GIVE_UP_DOCUMENT_MS = 60 * 60_000;
/** A SharePoint sync running this long has crashed. */
export const STALE_SOURCE_MS = 30 * 60_000;

export type RecoveryResult = {
  failedRuns: number;
  requeueRuns: { runId: string; tenantId: string }[];
  requeueDocuments: { documentId: string; tenantId: string }[];
  failedDocuments: number;
  resetSources: number;
};

/**
 * Repairs work that is stuck in a non-final state, so no page waits forever (robustness
 * review): runs whose worker died are failed with a clear message, queued runs and documents
 * whose job got lost are handed to the queue again (all jobs are idempotent), hopeless
 * documents and crashed syncs are marked as failed. Runs every few minutes (system job).
 */
export async function recoverStuckWork(db: Database, now = new Date()): Promise<RecoveryResult> {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  return withSystem(db, "recovery: repair stuck runs, documents and syncs", async (tx) => {
    const failed = await tx
      .update(runs)
      .set({
        status: "failed",
        error:
          "Der Lauf wurde unterbrochen (z. B. durch einen Neustart des Dienstes). Bitte senden Sie die Nachricht erneut.",
        finishedAt: now,
      })
      .where(
        and(
          eq(runs.status, "running"),
          sql`coalesce(${runs.heartbeatAt}, ${runs.startedAt}, ${runs.createdAt}) < ${ago(STALE_RUN_MS)}`,
        ),
      )
      .returning({ id: runs.id });

    const queued = await tx
      .select({ runId: runs.id, tenantId: runs.tenantId })
      .from(runs)
      .where(
        and(
          eq(runs.status, "queued"),
          sql`coalesce(${runs.heartbeatAt}, ${runs.createdAt}) < ${ago(STALE_QUEUED_MS)}`,
        ),
      )
      .limit(500);
    if (queued.length > 0) {
      // Touch them, so the next pass does not queue them again right away.
      await tx
        .update(runs)
        .set({ heartbeatAt: now })
        .where(
          inArray(
            runs.id,
            queued.map((r) => r.runId),
          ),
        );
    }

    const gaveUp = await tx
      .update(knowledgeDocuments)
      .set({
        status: "failed",
        error:
          "Die Verarbeitung wurde unterbrochen. Bitte laden Sie das Dokument erneut hoch oder gleichen Sie neu ab.",
      })
      .where(
        and(
          eq(knowledgeDocuments.status, "processing"),
          sql`${knowledgeDocuments.createdAt} < ${ago(GIVE_UP_DOCUMENT_MS)}`,
          sql`${knowledgeDocuments.updatedAt} < ${ago(STALE_DOCUMENT_MS)}`,
        ),
      )
      .returning({ id: knowledgeDocuments.id });
    const documents = await tx
      .update(knowledgeDocuments)
      .set({ updatedAt: now })
      .where(
        and(
          eq(knowledgeDocuments.status, "processing"),
          sql`${knowledgeDocuments.updatedAt} < ${ago(STALE_DOCUMENT_MS)}`,
        ),
      )
      .returning({ documentId: knowledgeDocuments.id, tenantId: knowledgeDocuments.tenantId });

    const sources = await tx
      .update(knowledgeSources)
      .set({
        status: "error",
        lastError: "Der Abgleich wurde unterbrochen und startet beim nächsten Durchlauf neu.",
      })
      .where(
        and(
          eq(knowledgeSources.status, "syncing"),
          sql`${knowledgeSources.syncStartedAt} < ${ago(STALE_SOURCE_MS)}`,
        ),
      )
      .returning({ id: knowledgeSources.id });

    return {
      failedRuns: failed.length,
      requeueRuns: queued,
      requeueDocuments: documents,
      failedDocuments: gaveUp.length,
      resetSources: sources.length,
    };
  });
}

/** Called by the worker while it works on a run (throttled). */
export async function touchRun(db: Database, tenantId: string, runId: string, now = new Date()) {
  await withTenant(db, tenantId, (tx) =>
    tx.update(runs).set({ heartbeatAt: now }).where(eq(runs.id, runId)),
  );
}
