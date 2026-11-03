"use server";

import { isUuid, notFound, validationError } from "@nexus/core";
import { eq, getDatabase, withTenant } from "@nexus/db";
import { runs } from "@nexus/db/schema";
import { can, listRunSteps, requirePermission, startRun } from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { enqueueAgentRun } from "@/lib/queue";
import { requireTenant } from "@/lib/session";

const MAX_MESSAGE_LENGTH = 20_000;

export async function sendMessageAction(
  conversationId: string | null,
  text: string,
): Promise<ActionResult<{ conversationId: string; runId: string }>> {
  return runAction("sendMessage", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "agent.run");
    const trimmed = text.trim();
    if (!trimmed) throw validationError("Bitte geben Sie eine Nachricht ein.");
    if (trimmed.length > MAX_MESSAGE_LENGTH) throw validationError("Die Nachricht ist zu lang.");
    if (conversationId !== null && !isUuid(conversationId))
      throw validationError("Ungültiges Gespräch.");

    const tenantId = ctx.tenant.tenantId;
    const ids = await withTenant(getDatabase().db, tenantId, (tx) =>
      startRun(tx, {
        tenantId,
        userId: ctx.user.id,
        userName: ctx.user.name,
        text: trimmed,
        conversationId,
      }),
    );
    await enqueueAgentRun({ runId: ids.runId, tenantId });
    revalidatePath("/chat", "layout");
    return { data: ids };
  });
}

export type TraceStep = {
  seq: number;
  type: "llm" | "thinking" | "tool" | "approval";
  name: string | null;
  data: Record<string, unknown>;
  isError: boolean;
  costUsdMicros: number;
  durationMs: number | null;
};

/** Steps of one run for the trace panel. Only the author (or conversation.read_all) may see it. */
export async function getRunTraceAction(runId: string): Promise<ActionResult<TraceStep[]>> {
  return runAction("getRunTrace", async () => {
    const ctx = await requireTenant();
    if (!isUuid(runId)) throw validationError("Ungültiger Lauf.");
    const steps = await withTenant(getDatabase().db, ctx.tenant.tenantId, async (tx) => {
      const [run] = await tx
        .select({ triggeredBy: runs.triggeredBy })
        .from(runs)
        .where(eq(runs.id, runId));
      if (!run || (run.triggeredBy !== ctx.user.id && !can(ctx.tenant, "conversation.read_all"))) {
        throw notFound("Lauf nicht gefunden.");
      }
      return listRunSteps(tx, runId);
    });
    return {
      data: steps.map((step) => ({
        seq: step.seq,
        type: step.type,
        name: step.name,
        data: step.data,
        isError: step.isError,
        costUsdMicros: step.costUsdMicros,
        durationMs: step.durationMs,
      })),
    };
  });
}
