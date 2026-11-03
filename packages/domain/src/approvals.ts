import type { ApprovalDecision, PendingApproval } from "@nexus/agents";
import { conflict, hasPermission, notFound, type TenantPermission } from "@nexus/core";
import { and, desc, eq, sql, type Tx } from "@nexus/db";
import { agents, approvals, authUser, runs } from "@nexus/db/schema";
import { appendAudit } from "./audit";

/** Called by the worker when a run pauses for a human decision. */
export async function createApprovals(
  tx: Tx,
  input: { tenantId: string; runId: string; approvals: PendingApproval[] },
) {
  if (input.approvals.length === 0) return;
  await tx
    .insert(approvals)
    .values(
      input.approvals.map((a) => ({
        tenantId: input.tenantId,
        runId: input.runId,
        toolUseId: a.toolUseId,
        toolName: a.toolName,
        input: (a.input ?? {}) as Record<string, unknown>,
      })),
    )
    .onConflictDoNothing();
}

/**
 * Who sees which approvals: people with `conversation.read_all` (owners, admins) see all of
 * the tenant, everybody else only those from their own conversations.
 */
export type ApprovalScope = { userId: string; all: boolean };

export function approvalScopeFor(access: {
  userId: string;
  permissions: readonly TenantPermission[];
}): ApprovalScope {
  return { userId: access.userId, all: hasPermission(access.permissions, "conversation.read_all") };
}

const visibleIn = (scope: ApprovalScope) =>
  scope.all ? undefined : eq(runs.triggeredBy, scope.userId);

export async function countPendingApprovals(
  tx: Tx,
  tenantId: string,
  scope: ApprovalScope,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(approvals)
    .innerJoin(runs, eq(runs.id, approvals.runId))
    .where(
      and(eq(approvals.tenantId, tenantId), eq(approvals.status, "pending"), visibleIn(scope)),
    );
  return row?.count ?? 0;
}

export async function listApprovals(
  tx: Tx,
  tenantId: string,
  status: "pending" | "decided",
  scope: ApprovalScope,
) {
  const decider = sql<
    string | null
  >`(select name from ${authUser} u where u.id = ${approvals.decidedBy})`;
  return tx
    .select({
      id: approvals.id,
      runId: approvals.runId,
      conversationId: runs.conversationId,
      toolName: approvals.toolName,
      input: approvals.input,
      editedInput: approvals.editedInput,
      status: approvals.status,
      reason: approvals.reason,
      createdAt: approvals.createdAt,
      decidedAt: approvals.decidedAt,
      decidedByName: decider,
      agentName: agents.name,
      requestedByName: authUser.name,
    })
    .from(approvals)
    .innerJoin(runs, eq(runs.id, approvals.runId))
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .leftJoin(authUser, eq(authUser.id, runs.triggeredBy))
    .where(
      and(
        eq(approvals.tenantId, tenantId),
        status === "pending"
          ? eq(approvals.status, "pending")
          : sql`${approvals.status} <> 'pending'`,
        visibleIn(scope),
      ),
    )
    .orderBy(status === "pending" ? approvals.createdAt : desc(approvals.decidedAt))
    .limit(status === "pending" ? 100 : 20);
}

/**
 * Records a decision. When the last open approval of the run is decided, the run goes back
 * to "queued" and the caller enqueues it; the worker then continues where it paused.
 */
export async function decideApproval(
  tx: Tx,
  input: {
    tenantId: string;
    approvalId: string;
    approve: boolean;
    editedInput?: Record<string, unknown> | null;
    reason?: string | null;
    actorId: string;
    scope: ApprovalScope;
  },
): Promise<{ runId: string; resume: boolean }> {
  const [row] = await tx
    .select({ approval: approvals })
    .from(approvals)
    .innerJoin(runs, eq(runs.id, approvals.runId))
    .where(
      and(
        eq(approvals.id, input.approvalId),
        eq(approvals.tenantId, input.tenantId),
        visibleIn(input.scope),
      ),
    )
    .for("update", { of: approvals });
  const approval = row?.approval;
  if (!approval) throw notFound("Freigabe nicht gefunden.");
  if (approval.status !== "pending")
    throw conflict("Über diese Freigabe wurde bereits entschieden.");

  await tx
    .update(approvals)
    .set({
      status: input.approve ? "approved" : "rejected",
      editedInput: input.approve ? (input.editedInput ?? null) : null,
      reason: input.reason?.trim().slice(0, 500) || null,
      decidedBy: input.actorId,
      decidedAt: new Date(),
    })
    .where(eq(approvals.id, approval.id));
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: input.approve ? "approval.approved" : "approval.rejected",
    targetType: "approval",
    targetId: approval.id,
    metadata: {
      tool: approval.toolName,
      edited: Boolean(input.editedInput),
      runId: approval.runId,
    },
  });

  const [open] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(approvals)
    .where(and(eq(approvals.runId, approval.runId), eq(approvals.status, "pending")));
  if ((open?.count ?? 0) > 0) return { runId: approval.runId, resume: false };

  const resumed = await tx
    .update(runs)
    .set({ status: "queued" })
    .where(and(eq(runs.id, approval.runId), eq(runs.status, "awaiting_approval")))
    .returning({ id: runs.id });
  return { runId: approval.runId, resume: resumed.length === 1 };
}

/** Decisions for the paused tool calls of a run, in the form the runtime expects. */
export async function loadDecisions(
  tx: Tx,
  runId: string,
): Promise<Record<string, ApprovalDecision>> {
  const rows = await tx.select().from(approvals).where(eq(approvals.runId, runId));
  const decisions: Record<string, ApprovalDecision> = {};
  for (const row of rows) {
    if (row.status === "approved") {
      decisions[row.toolUseId] = {
        approved: true,
        ...(row.editedInput ? { input: row.editedInput } : {}),
        ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
      };
    } else if (row.status === "rejected") {
      decisions[row.toolUseId] = {
        approved: false,
        ...(row.reason ? { reason: row.reason } : {}),
        ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
      };
    }
  }
  return decisions;
}
