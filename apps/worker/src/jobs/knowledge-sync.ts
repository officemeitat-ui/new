import type { KnowledgeSyncJob } from "@nexus/core";
import type { Logger } from "@nexus/core/logger";
import type { Database } from "@nexus/db";
import { syncSharePointSource, type MicrosoftAppConfig } from "@nexus/domain";

export type KnowledgeSyncDeps = {
  db: Database;
  log: Logger;
  enqueueIngest: (job: { documentId: string; tenantId: string }) => Promise<void>;
  /** Defaults to the environment. */
  microsoft?: MicrosoftAppConfig | null;
};

/** Synchronises one SharePoint library; parsing of new files runs as normal ingest jobs. */
export async function processKnowledgeSync(job: KnowledgeSyncJob, deps: KnowledgeSyncDeps) {
  const result = await syncSharePointSource(deps.db, {
    tenantId: job.tenantId,
    sourceId: job.sourceId,
    ...(deps.microsoft !== undefined ? { config: deps.microsoft } : {}),
    enqueueIngest: (documentId) => deps.enqueueIngest({ documentId, tenantId: job.tenantId }),
  });
  deps.log.info({ sourceId: job.sourceId, ...result }, "sharepoint sync finished");
  return result;
}
