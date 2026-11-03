"use server";

import { isUuid, validationError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { requirePermission, startRun } from "@nexus/domain";
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
