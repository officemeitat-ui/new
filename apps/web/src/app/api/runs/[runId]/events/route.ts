import { can } from "@nexus/domain";
import { isUuid, runEventsKey } from "@nexus/core";
import { eq, getDatabase, withTenant } from "@nexus/db";
import { runs } from "@nexus/db/schema";
import { Redis } from "ioredis";
import type { NextRequest } from "next/server";
import { getApiTenantContext } from "@/lib/api-context";

export const dynamic = "force-dynamic";

const FINISHED = new Set([
  "completed",
  "awaiting_approval",
  "refused",
  "incomplete",
  "max_steps",
  "budget_exceeded",
  "cancelled",
  "failed",
]);

/**
 * Server-Sent Events with the live events of a run. Reads the run's Redis stream from the
 * beginning, so a client that connects late still gets every event (docs/ARCHITECTURE.md §5).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!isUuid(runId)) return new Response(null, { status: 404 });
  const ctx = await getApiTenantContext();
  if (!ctx) return new Response(null, { status: 401 });

  const [run] = await withTenant(getDatabase().db, ctx.tenant.tenantId, (tx) =>
    tx
      .select({ status: runs.status, triggeredBy: runs.triggeredBy })
      .from(runs)
      .where(eq(runs.id, runId)),
  );
  if (!run || (run.triggeredBy !== ctx.user.id && !can(ctx.tenant, "conversation.read_all"))) {
    return new Response(null, { status: 404 });
  }

  const encoder = new TextEncoder();
  const headers = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };

  if (FINISHED.has(run.status)) {
    const done = JSON.stringify({ type: "done", status: run.status });
    return new Response(encoder.encode(`data: ${done}\n\n`), { headers });
  }

  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
  });
  const key = runEventsKey(runId);

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastId = "0";
      try {
        while (!request.signal.aborted) {
          const result = await redis.xread("COUNT", 200, "BLOCK", 15_000, "STREAMS", key, lastId);
          if (!result) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            continue;
          }
          for (const [, entries] of result) {
            for (const [id, fields] of entries) {
              lastId = id;
              const payload = fields[1] ?? "{}";
              controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
              if ((JSON.parse(payload) as { type?: string }).type === "done") return;
            }
          }
        }
      } catch {
        // Client went away or Redis closed – nothing to report.
      } finally {
        redis.disconnect();
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      redis.disconnect();
    },
  });
  return new Response(body, { headers });
}
