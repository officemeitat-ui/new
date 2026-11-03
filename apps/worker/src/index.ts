import { providerFromEnv } from "@nexus/agents";
import { QUEUES, type AgentRunJob } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { getDatabase } from "@nexus/db";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { startHealthServer } from "./health-server";
import { processAgentRun, redisPublisher } from "./jobs/agent-run";
import { handleSystemJob } from "./jobs/system";

const env = getEnv();
const log = createLogger("worker");

// BullMQ requires maxRetriesPerRequest: null for blocking connections.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
const agentDeps = {
  db: getDatabase(env.DATABASE_URL).db,
  provider: providerFromEnv(env),
  publish: redisPublisher(publisher),
  platformName: env.BRAND_PRODUCT_NAME,
  log,
};

const workers = [
  new Worker(QUEUES.system, handleSystemJob, { connection, concurrency: 5 }),
  new Worker<AgentRunJob>(QUEUES.agentRuns, (job) => processAgentRun(job.data, agentDeps), {
    connection,
    concurrency: Number(process.env.WORKER_AGENT_CONCURRENCY ?? 4),
  }),
];

for (const worker of workers) {
  worker.on("failed", (job, error) =>
    log.error({ queue: worker.name, jobId: job?.id, err: error }, "job failed"),
  );
  worker.on("error", (error) => log.error({ queue: worker.name, err: error }, "worker error"));
}

const port = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
const healthServer = startHealthServer(port, () => workers.every((w) => w.isRunning()));
log.info({ queues: workers.map((w) => w.name), healthPort: port }, "worker started");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down: finishing running jobs");
  await Promise.all(workers.map((w) => w.close()));
  healthServer.close();
  connection.disconnect();
  publisher.disconnect();
  await getDatabase(env.DATABASE_URL).close();
  log.info("worker stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
