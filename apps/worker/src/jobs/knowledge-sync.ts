import type { KnowledgeSyncJob } from "@nexus/core";
import type { Logger } from "@nexus/core/logger";
import type { Database } from "@nexus/db";
import { syncKnowledgeSource, type ConnectorEnv, type MicrosoftAppConfig } from "@nexus/domain";

export type KnowledgeSyncDeps = {
  db: Database;
  log: Logger;
  enqueueIngest: (job: { documentId: string; tenantId: string }) => Promise<void>;
  /** Defaults to the environment. */
  microsoft?: MicrosoftAppConfig | null;
  /** Defaults to the environment (Atera URL, private hosts in development). */
  connectors?: ConnectorEnv;
};

/**
 * Synchronises one knowledge source (SharePoint, BookStack or Atera); parsing of new documents
 * runs as normal ingest jobs.
 */
export async function processKnowledgeSync(job: KnowledgeSyncJob, deps: KnowledgeSyncDeps) {
  const result = await syncKnowledgeSource(deps.db, {
    tenantId: job.tenantId,
    sourceId: job.sourceId,
    ...(deps.microsoft !== undefined ? { microsoft: deps.microsoft } : {}),
    ...(deps.connectors ? { env: deps.connectors } : {}),
    enqueueIngest: (documentId) => deps.enqueueIngest({ documentId, tenantId: job.tenantId }),
  });
  deps.log.info({ sourceId: job.sourceId, ...result }, "knowledge sync finished");
  return result;
}
