"use server";

import { isUuid, validationError } from "@nexus/core";
import { getDatabase, withTenant } from "@nexus/db";
import { approvalScopeFor, decideApproval, requirePermission } from "@nexus/domain";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/lib/actions";
import { enqueueAgentRun } from "@/lib/queue";
import { requireTenant } from "@/lib/session";

export async function decideApprovalAction(input: {
  approvalId: string;
  approve: boolean;
  editedInput?: Record<string, unknown> | null;
  reason?: string | null;
}): Promise<ActionResult> {
  return runAction("decideApproval", async () => {
    const ctx = await requireTenant();
    requirePermission(ctx.tenant, "approval.decide");
    if (!isUuid(input.approvalId)) throw validationError("Ungültige Freigabe.");
    const tenantId = ctx.tenant.tenantId;
    const { runId, resume } = await withTenant(getDatabase().db, tenantId, (tx) =>
      decideApproval(tx, {
        tenantId,
        approvalId: input.approvalId,
        approve: input.approve,
        editedInput: input.editedInput ?? null,
        reason: input.reason ?? null,
        actorId: ctx.user.id,
        scope: approvalScopeFor(ctx.tenant),
        permissions: ctx.tenant.permissions,
      }),
    );
    // The last open decision of the run lets the agent continue where it paused.
    if (resume) await enqueueAgentRun({ runId, tenantId });
    revalidatePath("/approvals");
    revalidatePath("/", "layout");
    return {
      message: input.approve
        ? "Freigegeben – der Agent arbeitet weiter."
        : "Abgelehnt – der Agent wird informiert.",
    };
  });
}
