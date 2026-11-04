/**
 * Queue names and job payloads shared by web (producer) and worker (consumer).
 * Payloads carry IDs only; the state lives in Postgres (docs/adr/0005-jobs-bullmq.md).
 */
export const QUEUES = {
  system: "system",
  agentRuns: "agent-runs",
  knowledge: "knowledge",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type AgentRunJob = { runId: string; tenantId: string };

/** Extract, chunk and index an uploaded knowledge document (job name "ingest"). */
export type KnowledgeIngestJob = { documentId: string; tenantId: string };

/** Synchronise a SharePoint library into its collection (job name "sync", same queue). */
export type KnowledgeSyncJob = { sourceId: string; tenantId: string };

/** Redis stream with the live events of one run (replayable for late SSE subscribers). */
export const runEventsKey = (runId: string) => `nexus:run:${runId}:events`;
export const RUN_EVENTS_TTL_SECONDS = 60 * 60;
