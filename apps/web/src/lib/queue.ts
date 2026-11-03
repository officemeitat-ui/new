import "server-only";
import { QUEUES, type AgentRunJob } from "@nexus/core";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const globalForQueue = globalThis as unknown as { __nexusAgentQueue?: Queue<AgentRunJob> };

function agentRunQueue(): Queue<AgentRunJob> {
  globalForQueue.__nexusAgentQueue ??= new Queue<AgentRunJob>(QUEUES.agentRuns, {
    connection: new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    }),
  });
  return globalForQueue.__nexusAgentQueue;
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
