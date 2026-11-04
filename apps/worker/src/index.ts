import { providerFromEnv } from "@nexus/agents";
import {
  QUEUES,
  type AgentRunJob,
  type KnowledgeIngestJob,
  type KnowledgeSyncJob,
} from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { DEFAULT_PRICES, type ModelPrice } from "@nexus/agents";
import { getDatabase } from "@nexus/db";
import { loadCurrentPrices } from "@nexus/domain";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { startHealthServer } from "./health-server";
import { processAgentRun, redisPublisher } from "./jobs/agent-run";
import { processKnowledgeIngest } from "./jobs/knowledge-ingest";
import { processKnowledgeSync } from "./jobs/knowledge-sync";
import { handleSystemJob } from "./jobs/system";

const env = getEnv();
const log = createLogger("worker");

// BullMQ requires maxRetriesPerRequest: null for blocking connections.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
const db = getDatabase(env.DATABASE_URL).db;

// Prices come from the price_tables table (ADR 0006), refreshed every five minutes.
// Built-in defaults only fill models that are missing there – and that is logged.
let priceCache: { at: number; prices: Record<string, ModelPrice> } | undefined;
async function loadPrices(): Promise<Record<string, ModelPrice>> {
  if (priceCache && Date.now() - priceCache.at < 5 * 60_000) return priceCache.prices;
  const fromDb = await loadCurrentPrices(db);
  const missing = Object.keys(DEFAULT_PRICES).filter((model) => !(model in fromDb));
  if (missing.length > 0)
    log.warn({ missing }, "models without a price in price_tables – using defaults");
  priceCache = { at: Date.now(), prices: { ...DEFAULT_PRICES, ...fromDb } };
  return priceCache.prices;
}
const agentDeps = {
  db,
  provider: providerFromEnv(env),
  loadPrices,
  publish: redisPublisher(publisher),
  platformName: env.BRAND_PRODUCT_NAME,
  log,
};

// Producers inside the worker: sync jobs hand new files to ingest, the hourly job queues syncs.
const knowledgeQueue = new Queue<KnowledgeIngestJob | KnowledgeSyncJob>(QUEUES.knowledge, {
  connection,
});
const enqueueIngest = async (job: KnowledgeIngestJob) => {
  await knowledgeQueue.add("ingest", job, {
    jobId: `ingest-${job.documentId}-${Date.now()}`,
    attempts: 2,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
};
const enqueueSync = async (job: KnowledgeSyncJob) => {
  await knowledgeQueue.add("sync", job, {
    jobId: `sync-${job.sourceId}-${Date.now()}`,
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 500,
  });
};

const agentQueue = new Queue<AgentRunJob>(QUEUES.agentRuns, { connection });
const enqueueRun = async (job: AgentRunJob) => {
  await agentQueue.add("run", job, {
    jobId: `${job.runId}-${Date.now()}`,
    attempts: 1,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
};

const workers = [
  new Worker(
    QUEUES.system,
    (job) => handleSystemJob(job, { db, log, enqueueSync, enqueueRun, enqueueIngest }),
    {
      connection,
      concurrency: 5,
    },
  ),
  new Worker<AgentRunJob>(QUEUES.agentRuns, (job) => processAgentRun(job.data, agentDeps), {
    connection,
    concurrency: Number(process.env.WORKER_AGENT_CONCURRENCY ?? 4),
  }),
  // Parsing is CPU-bound; two at a time keep agent runs responsive.
  new Worker<KnowledgeIngestJob | KnowledgeSyncJob>(
    QUEUES.knowledge,
    (job) =>
      job.name === "sync"
        ? processKnowledgeSync(job.data as KnowledgeSyncJob, { db, log, enqueueIngest })
        : processKnowledgeIngest(job.data as KnowledgeIngestJob, {
            db,
            log,
            finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
          }),
    { connection, concurrency: 2 },
  ),
];

for (const worker of workers) {
  worker.on("failed", (job, error) =>
    log.error({ queue: worker.name, jobId: job?.id, err: error }, "job failed"),
  );
  worker.on("error", (error) => log.error({ queue: worker.name, err: error }, "worker error"));
}

// Nightly deletion of expired data (DSGVO retention, M13). Idempotent: upsert keeps one schedule.
const systemQueue = new Queue(QUEUES.system, { connection });
await systemQueue.upsertJobScheduler(
  "retention-nightly",
  { pattern: "30 2 * * *", tz: "Europe/Vienna" },
  { name: "retention", opts: { removeOnComplete: 30, removeOnFail: 100 } },
);
// Repairs stuck runs, documents and syncs (worker crash, lost jobs) – every five minutes.
await systemQueue.upsertJobScheduler(
  "recover-stuck",
  { pattern: "*/5 * * * *" },
  { name: "recover", opts: { removeOnComplete: 20, removeOnFail: 100 } },
);
await systemQueue.add(
  "recover",
  {},
  { jobId: `recover-start-${Date.now()}`, removeOnComplete: 20 },
);
// SharePoint libraries: hourly incremental sync (delta – only changes are fetched).
await systemQueue.upsertJobScheduler(
  "sharepoint-hourly",
  { pattern: "17 * * * *", tz: "Europe/Vienna" },
  { name: "sharepoint-sync-all", opts: { removeOnComplete: 50, removeOnFail: 100 } },
);

const port = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
const healthServer = startHealthServer(port, () => workers.every((w) => w.isRunning()));
log.info({ queues: workers.map((w) => w.name), healthPort: port }, "worker started");

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down: finishing running jobs");
  await Promise.all(workers.map((w) => w.close()));
  await systemQueue.close();
  await knowledgeQueue.close();
  await agentQueue.close();
  healthServer.close();
  connection.disconnect();
  publisher.disconnect();
  await getDatabase(env.DATABASE_URL).close();
  log.info("worker stopped");
  process.exit(0);
}

// A stray rejection (e.g. a Redis hiccup) must not take every running job down with it.
process.on("unhandledRejection", (reason) => log.error({ err: reason }, "unhandled rejection"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
