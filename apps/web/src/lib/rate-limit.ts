import "server-only";
import { Redis } from "ioredis";

const globalForLimit = globalThis as unknown as { __nexusLimitRedis?: Redis };

function redis(): Redis {
  globalForLimit.__nexusLimitRedis ??= new Redis(
    process.env.REDIS_URL ?? "redis://localhost:6379",
    {
      maxRetriesPerRequest: 1,
      connectTimeout: 3_000,
      enableOfflineQueue: true,
    },
  );
  return globalForLimit.__nexusLimitRedis;
}

/**
 * Fixed-window counter in Redis (shared by all web instances). Returns false once `max` hits
 * happened in the window. If Redis is unreachable it lets the request through – the public
 * forms stay usable, and the error is visible in the logs.
 */
export async function allow(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const client = redis();
    const count = await client.incr(`nexus:limit:${key}`);
    if (count === 1) await client.expire(`nexus:limit:${key}`, windowSeconds);
    return count <= max;
  } catch {
    return true;
  }
}
