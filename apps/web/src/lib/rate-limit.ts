import "server-only";
import { createHash } from "node:crypto";
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

/** INCR and EXPIRE in one step: a counter can never be left without expiry. */
const INCREMENT = `local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count`;

/**
 * Fixed-window counter in Redis (shared by all web instances). Returns false once `max` hits
 * happened in the window. Keys are hashed, so client input can never make a key large
 * (security review: memory exhaustion via oversized keys). With `failClosed`, an unreachable
 * Redis blocks the request instead of letting it through – for anonymous endpoints.
 */
export async function allow(
  key: string,
  max: number,
  windowSeconds: number,
  options: { failClosed?: boolean } = {},
): Promise<boolean> {
  const hashed = `nexus:limit:${createHash("sha256").update(key).digest("hex")}`;
  try {
    const count = Number(await redis().eval(INCREMENT, 1, hashed, String(windowSeconds)));
    return count <= max;
  } catch {
    return !options.failClosed;
  }
}
