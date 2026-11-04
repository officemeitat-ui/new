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

/** Streams end after this long; EventSource reconnects and continues at the last id. */
const MAX_STREAM_MS = 5 * 60_000;

/**
 * Each stream holds its own Redis connection (blocking XREAD), so one person may only keep a
 * few open at a time (security review: unbounded Redis connections). Per web process.
 */
const MAX_STREAMS_PER_USER = 8;
const openStreams = new Map<string, number>();

function acquireStream(userId: string): (() => void) | null {
  const count = openStreams.get(userId) ?? 0;
  if (count >= MAX_STREAMS_PER_USER) return null;
  openStreams.set(userId, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (openStreams.get(userId) ?? 1) - 1;
    if (left > 0) openStreams.set(userId, left);
    else openStreams.delete(userId);
  };
}

async function runStatus(tenantId: string, runId: string): Promise<string | null> {
  const [run] = await withTenant(getDatabase().db, tenantId, (tx) =>
    tx.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)),
  );
  return run?.status ?? null;
}

async function isActiveAgain(tenantId: string, runId: string): Promise<boolean> {
  const status = await runStatus(tenantId, runId);
  return status === "queued" || status === "running";
}

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

  const release = acquireStream(ctx.user.id);
  if (!release) {
    return new Response("Zu viele offene Live-Verbindungen.", {
      status: 429,
      headers: { "retry-after": "10" },
    });
  }
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
  const key = runEventsKey(runId);

  // After a reconnect the browser sends the last event id it saw: continue there, so no text
  // arrives twice (robustness review).
  const resumeFrom = request.headers.get("last-event-id");
  const startedAt = Date.now();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastId = resumeFrom && /^\d+-\d+$/.test(resumeFrom) ? resumeFrom : "0";
      const finish = (status: string) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", status })}\n\n`));
      try {
        while (!request.signal.aborted) {
          // The browser reconnects by itself; a bounded stream frees server resources.
          if (Date.now() - startedAt > MAX_STREAM_MS) return;
          const result = await redis.xread("COUNT", 200, "BLOCK", 15_000, "STREAMS", key, lastId);
          if (!result) {
            // Nothing new for 15 s: the database has the final word (worker died, event lost).
            const status = await runStatus(ctx.tenant.tenantId, runId);
            if (status && FINISHED.has(status)) {
              finish(status);
              return;
            }
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            continue;
          }
          for (const [, entries] of result) {
            for (const [id, fields] of entries) {
              lastId = id;
              const payload = fields[1] ?? "{}";
              const event = JSON.parse(payload) as { type?: string; status?: string };
              // A run that paused for an approval and was resumed keeps its stream: the old
              // "done" of the paused pass is skipped while the run is active again.
              if (
                event.type === "done" &&
                event.status === "awaiting_approval" &&
                (await isActiveAgain(ctx.tenant.tenantId, runId))
              ) {
                continue;
              }
              controller.enqueue(encoder.encode(`id: ${id}\ndata: ${payload}\n\n`));
              if (event.type === "done") return;
            }
          }
        }
      } catch {
        // Redis went away or the client left: tell the browser to look at the database.
        const status = await runStatus(ctx.tenant.tenantId, runId).catch(() => null);
        if (status && FINISHED.has(status)) finish(status);
      } finally {
        redis.disconnect();
        release();
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      redis.disconnect();
      release();
    },
  });
  return new Response(body, { headers });
}
