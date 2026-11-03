import "server-only";
import { QUEUES, type AgentRunJob, type KnowledgeIngestJob } from "@nexus/core";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const globalForQueue = globalThis as unknown as {
  __nexusAgentQueue?: Queue<AgentRunJob>;
  __nexusKnowledgeQueue?: Queue<KnowledgeIngestJob>;
};

const connection = () =>
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

function agentRunQueue(): Queue<AgentRunJob> {
  globalForQueue.__nexusAgentQueue ??= new Queue<AgentRunJob>(QUEUES.agentRuns, {
    connection: connection(),
  });
  return globalForQueue.__nexusAgentQueue;
}

function knowledgeQueue(): Queue<KnowledgeIngestJob> {
  globalForQueue.__nexusKnowledgeQueue ??= new Queue<KnowledgeIngestJob>(QUEUES.knowledge, {
    connection: connection(),
  });
  return globalForQueue.__nexusKnowledgeQueue;
}

/** Parsing is deterministic, so failed ingests may be retried. */
export async function enqueueKnowledgeIngest(job: KnowledgeIngestJob): Promise<void> {
  await knowledgeQueue().add("ingest", job, {
    jobId: `ingest-${job.documentId}`,
    attempts: 2,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}

/** No automatic retries (ADR 0005); the worker skips runs that are not queued, so duplicates are harmless. */
export async function enqueueAgentRun(job: AgentRunJob): Promise<void> {
  await agentRunQueue().add("run", job, {
    // One job per run segment: a run resumed after an approval gets a new job.
    jobId: `${job.runId}-${Date.now()}`,
    attempts: 1,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
