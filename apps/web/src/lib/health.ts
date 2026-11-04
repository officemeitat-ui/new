import "server-only";
import { getDatabase, sql } from "@nexus/db";
import { Redis } from "ioredis";

export type CheckResult = { ok: boolean; latencyMs: number; error?: string };
export type HealthReport = {
  status: "ok" | "degraded";
  checks: { database: CheckResult; redis: CheckResult };
};

async function timed(fn: () => Promise<unknown>): Promise<CheckResult> {
  const started = performance.now();
  try {
    await fn();
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Results are shared for a few seconds: the public health route must not open a Redis
 * connection per request (security review). */
const CACHE_MS = 5_000;
let cached: { at: number; report: Promise<HealthReport> } | null = null;

export function checkHealth(): Promise<HealthReport> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.report;
  const report = runChecks();
  cached = { at: now, report };
  return report;
}

async function runChecks(): Promise<HealthReport> {
  const [database, redis] = await Promise.all([
    timed(() => getDatabase().db.execute(sql`select 1`)),
    timed(async () => {
      const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        connectTimeout: 2000,
      });
      try {
        await client.connect();
        await client.ping();
      } finally {
        client.disconnect();
      }
    }),
  ]);
  return { status: database.ok && redis.ok ? "ok" : "degraded", checks: { database, redis } };
}
