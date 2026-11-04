import type { Logger } from "@nexus/core/logger";
import type { Database } from "@nexus/db";
import { applyRetention, listAllKnowledgeSources, recoverStuckWork } from "@nexus/domain";
import type { Job } from "bullmq";

export type SystemJobResult =
  | { pong: true; at: string }
  | { retention: { tenants: number; conversations: number; documents: number } }
  | { sharepoint: { queued: number } }
  | {
      recovered: {
        failedRuns: number;
        requeuedRuns: number;
        requeuedDocuments: number;
        failedDocuments: number;
        resetSources: number;
      };
    };

export type SystemJobDeps = {
  db: Database;
  log: Logger;
  enqueueSync?: (job: { sourceId: string; tenantId: string }) => Promise<void>;
  enqueueRun?: (job: { runId: string; tenantId: string }) => Promise<void>;
  enqueueIngest?: (job: { documentId: string; tenantId: string }) => Promise<void>;
};

/**
 * Maintenance jobs of the platform itself. `ping` is used by monitoring to prove the queue
 * works; `retention` deletes expired data every night (DSGVO, M13).
 */
export async function handleSystemJob(
  job: Pick<Job, "name" | "id">,
  deps?: SystemJobDeps,
): Promise<SystemJobResult> {
  switch (job.name) {
    case "ping":
      return { pong: true, at: new Date().toISOString() };
    case "retention": {
      if (!deps) throw new Error("retention braucht eine Datenbank.");
      const results = await applyRetention(deps.db);
      const summary = {
        tenants: results.length,
        conversations: results.reduce((sum, r) => sum + r.conversations, 0),
        documents: results.reduce((sum, r) => sum + r.documents, 0),
      };
      deps.log.info(summary, "retention applied");
      return { retention: summary };
    }
    case "recover": {
      if (!deps?.enqueueRun || !deps.enqueueIngest) throw new Error("recover braucht Queues.");
      const result = await recoverStuckWork(deps.db);
      for (const run of result.requeueRuns) await deps.enqueueRun(run);
      for (const document of result.requeueDocuments) await deps.enqueueIngest(document);
      const summary = {
        failedRuns: result.failedRuns,
        requeuedRuns: result.requeueRuns.length,
        requeuedDocuments: result.requeueDocuments.length,
        failedDocuments: result.failedDocuments,
        resetSources: result.resetSources,
      };
      if (Object.values(summary).some((n) => n > 0)) deps.log.warn(summary, "recovered stuck work");
      return { recovered: summary };
    }
    case "sharepoint-sync-all": {
      if (!deps?.enqueueSync) throw new Error("sharepoint-sync-all braucht eine Queue.");
      const sources = await listAllKnowledgeSources(deps.db);
      for (const source of sources)
        await deps.enqueueSync({ sourceId: source.id, tenantId: source.tenantId });
      return { sharepoint: { queued: sources.length } };
    }
    default:
      throw new Error(`Unbekannter System-Job: ${job.name}`);
  }
}
