import "server-only";
import {
  QUEUES,
  type AgentRunJob,
  type KnowledgeIngestJob,
  type KnowledgeSyncJob,
} from "@nexus/core";
import { unavailable } from "@nexus/core";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const globalForQueue = globalThis as unknown as {
  __nexusAgentQueue?: Queue<AgentRunJob>;
  __nexusKnowledgeQueue?: Queue<KnowledgeIngestJob | KnowledgeSyncJob>;
};

const connection = () =>
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    connectTimeout: 5_000,
  });

/**
 * Handing work to the worker may never block a click for long: after 5 s the user gets a clear
 * message. The run/document is already stored and the worker's recovery job (every 5 minutes)
 * queues it again – nothing gets lost (robustness review).
 */
async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          unavailable(
            "Der Hintergrunddienst ist gerade nicht erreichbar. Ihr Auftrag ist gespeichert und wird automatisch bearbeitet, sobald er wieder läuft.",
          ),
        ),
      5_000,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function agentRunQueue(): Queue<AgentRunJob> {
  globalForQueue.__nexusAgentQueue ??= new Queue<AgentRunJob>(QUEUES.agentRuns, {
    connection: connection(),
  });
  return globalForQueue.__nexusAgentQueue;
}

function knowledgeQueue(): Queue<KnowledgeIngestJob | KnowledgeSyncJob> {
  globalForQueue.__nexusKnowledgeQueue ??= new Queue<KnowledgeIngestJob | KnowledgeSyncJob>(
    QUEUES.knowledge,
    {
      connection: connection(),
    },
  );
  return globalForQueue.__nexusKnowledgeQueue;
}

/** Parsing is deterministic, so failed ingests may be retried. */
export async function enqueueKnowledgeIngest(job: KnowledgeIngestJob): Promise<void> {
  await within(
    knowledgeQueue().add("ingest", job, {
      jobId: `ingest-${job.documentId}-${Date.now()}`,
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }),
  );
}

/** No automatic retries (ADR 0005); the worker skips runs that are not queued, so duplicates are harmless. */
export async function enqueueAgentRun(job: AgentRunJob): Promise<void> {
  await within(
    agentRunQueue().add("run", job, {
      // One job per run segment: a run resumed after an approval gets a new job.
      jobId: `${job.runId}-${Date.now()}`,
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    }),
  );
}

/** SharePoint sync in the background; a second request while one runs is skipped by the worker. */
export async function enqueueKnowledgeSync(job: KnowledgeSyncJob): Promise<void> {
  await within(
    knowledgeQueue().add("sync", job, {
      jobId: `sync-${job.sourceId}-${Date.now()}`,
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 500,
    }),
  );
}
