import { getEnv } from "@nexus/core/env";
import { createLogger } from "@nexus/core/logger";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { startHealthServer } from "./health-server";
import { handleSystemJob } from "./jobs/system";
import { QUEUES } from "./queues";

const env = getEnv();
const log = createLogger("worker");

// BullMQ requires maxRetriesPerRequest: null for blocking connections.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const workers = [new Worker(QUEUES.system, handleSystemJob, { connection, concurrency: 5 })];

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
  log.info("worker stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
