import { providerFromEnv } from "@nexus/agents";
import { QUEUES, type AgentRunJob } from "@nexus/core";
import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { DEFAULT_PRICES, type ModelPrice } from "@nexus/agents";
import { getDatabase } from "@nexus/db";
import { loadCurrentPrices } from "@nexus/domain";
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
