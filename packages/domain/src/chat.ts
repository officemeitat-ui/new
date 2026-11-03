import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages";
import { conflict, notFound } from "@nexus/core";
import { and, asc, desc, eq, sql, type Tx } from "@nexus/db";
import {
  agents,
  agentVersions,
  conversations,
  messages,
  runs,
  runSteps,
  tenants,
  usageEvents,
  type AgentConfig,
  type RunStatus,
} from "@nexus/db/schema";
import { contextBlock, isModelTier, resolveModel, type RunResult } from "@nexus/agents";

/** The general assistant every tenant gets on first use of the chat. */
export const DEFAULT_AGENT = {
  name: "Assistent",
  description: "Allgemeiner Assistent für Fragen, Texte und Berechnungen im Arbeitsalltag.",
  config: {
    instructions: `Sie sind der allgemeine Assistent des Teams. Sie helfen bei Fragen aus dem Arbeitsalltag, formulieren und verbessern Texte (E-Mails, Angebote, Notizen) und rechnen Beträge, Prozente und Fristen exakt nach.

- Für jede Rechnung verwenden Sie das Werkzeug rechner, statt im Kopf zu rechnen.
- Wenn Sie Texte schreiben, liefern Sie einen fertigen Vorschlag, den man direkt übernehmen kann, und nennen danach in einem Satz, was angepasst werden sollte.
- Haben Sie keinen Zugriff auf eine Information (z. B. Kundendaten, Preislisten, Kalender), sagen Sie das klar; diese Zugänge kommen über Integrationen und die Wissensdatenbank.`,
    tier: "smart",
    effort: "medium",
    tools: [
      { name: "aktuelle_zeit", mode: "auto" },
      { name: "rechner", mode: "auto" },
    ],
    maxSteps: 10,
    maxCostUsdMicros: 500_000,
    roiMinutesPerTask: 5,
  } satisfies AgentConfig,
};

export async function ensureDefaultAgent(tx: Tx, tenantId: string, userId: string | null) {
  const [existing] = await tx
    .select()
    .from(agents)
    .where(and(eq(agents.tenantId, tenantId), eq(agents.isDefault, true)));
  if (existing?.currentVersionId) return existing;

  const [agent] = await tx
    .insert(agents)
    .values({
      tenantId,
      name: DEFAULT_AGENT.name,
      description: DEFAULT_AGENT.description,
      isDefault: true,
      createdBy: userId,
    })
    .returning();
  const [version] = await tx
    .insert(agentVersions)
    .values({
      tenantId,
      agentId: agent!.id,
      version: 1,
      config: DEFAULT_AGENT.config,
      publishedAt: new Date(),
      createdBy: userId,
    })
    .returning();
  const [updated] = await tx
    .update(agents)
    .set({ currentVersionId: version!.id })
    .where(eq(agents.id, agent!.id))
    .returning();
  return updated!;
}

export async function listConversations(tx: Tx, tenantId: string, userId: string) {
  return tx
    .select({
      id: conversations.id,
      title: conversations.title,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.userId, userId)))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(50);
}

/** Conversations are private to their author unless the role may read all (permission check upstream). */
export async function getConversation(
  tx: Tx,
  input: { tenantId: string; conversationId: string; userId: string; canReadAll: boolean },
) {
  const [conversation] = await tx
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, input.conversationId), eq(conversations.tenantId, input.tenantId)),
    );
  if (!conversation || (!input.canReadAll && conversation.userId !== input.userId)) {
    throw notFound("Gespräch nicht gefunden.");
  }
  const history = await tx
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(asc(messages.seq));
  const runRows = await tx
    .select()
    .from(runs)
    .where(eq(runs.conversationId, conversation.id))
    .orderBy(asc(runs.createdAt));
  const [agent] = await tx
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, conversation.agentId));
  return { conversation, messages: history, runs: runRows, agentName: agent?.name ?? null };
}

function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()} …` : line || "Neues Gespräch";
}

/**
 * Stores the user's message and creates a queued run. The first message of a conversation
 * carries the <kontext> block (date, user, channel) so the system prompt can stay cacheable.
 */
export async function startRun(
  tx: Tx,
  input: {
    tenantId: string;
    userId: string;
    userName: string;
    text: string;
    conversationId?: string | null;
    /** Agent for a new conversation; defaults to the tenant's general assistant. */
    agentId?: string | null;
    now?: Date;
  },
): Promise<{ conversationId: string; runId: string }> {
  const text = input.text.trim();
  if (!text) throw new Error("Leere Nachricht.");
  const now = input.now ?? new Date();

  let conversationId = input.conversationId ?? null;
  let agentId: string;
  if (conversationId) {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, input.tenantId)));
    if (!conversation || conversation.userId !== input.userId)
      throw notFound("Gespräch nicht gefunden.");
    const [active] = await tx
      .select({ status: runs.status })
      .from(runs)
      .where(
        and(
          eq(runs.conversationId, conversationId),
          sql`${runs.status} in ('queued','running','awaiting_approval')`,
        ),
      );
    // The history ends with an open tool call until the approval is decided, so a new
    // message would make the conversation invalid for the model.
    if (active?.status === "awaiting_approval") {
      throw conflict("Der Agent wartet auf eine Freigabe. Bitte entscheiden Sie zuerst darüber.");
    }
    if (active) throw conflict("Der Agent arbeitet noch an der letzten Nachricht.");
    agentId = conversation.agentId;
  } else {
    if (input.agentId) {
      const [chosen] = await tx
        .select({ id: agents.id, status: agents.status })
        .from(agents)
        .where(and(eq(agents.id, input.agentId), eq(agents.tenantId, input.tenantId)));
      if (!chosen || chosen.status !== "active") throw notFound("Agent nicht gefunden.");
      agentId = chosen.id;
    } else {
      agentId = (await ensureDefaultAgent(tx, input.tenantId, input.userId)).id;
    }
    const [created] = await tx
      .insert(conversations)
      .values({ tenantId: input.tenantId, agentId, userId: input.userId, title: titleFrom(text) })
      .returning({ id: conversations.id });
    conversationId = created!.id;
  }

  const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId));
  const [version] = await tx
    .select()
    .from(agentVersions)
    .where(eq(agentVersions.id, agent!.currentVersionId!));
  const config = version!.config;

  const [{ next }] = (await tx
    .select({ next: sql<number>`coalesce(max(${messages.seq}), 0) + 1` })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))) as [{ next: number }];

  const content =
    next === 1
      ? [
          {
            type: "text",
            text: contextBlock({ now, userName: input.userName, channel: "Web-Chat" }),
          },
          { type: "text", text },
        ]
      : [{ type: "text", text }];

  const [run] = await tx
    .insert(runs)
    .values({
      tenantId: input.tenantId,
      conversationId,
      agentId,
      agentVersionId: version!.id,
      triggeredBy: input.userId,
      model: resolveModel(isModelTier(config.tier) ? config.tier : "smart"),
      effort: config.effort,
    })
    .returning({ id: runs.id });

  await tx.insert(messages).values({
    tenantId: input.tenantId,
    conversationId,
    runId: run!.id,
    seq: Number(next),
    role: "user",
    content,
  });
  await tx
    .update(conversations)
    .set({ lastMessageAt: now })
    .where(eq(conversations.id, conversationId));
  return { conversationId, runId: run!.id };
}

/** Everything the worker needs to execute a run. */
export async function loadRunForExecution(tx: Tx, runId: string) {
  const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw notFound("Lauf nicht gefunden.");
  const [version] = await tx
    .select()
    .from(agentVersions)
    .where(eq(agentVersions.id, run.agentVersionId));
  const [agent] = await tx.select().from(agents).where(eq(agents.id, run.agentId));
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, run.tenantId));
  const history = await tx
    .select()
    .from(messages)
    .where(eq(messages.conversationId, run.conversationId))
    .orderBy(asc(messages.seq));
  // A run resumed after an approval continues its trace numbering.
  const [lastStep] = await tx
    .select({ seq: sql<number>`coalesce(max(${runSteps.seq}), 0)` })
    .from(runSteps)
    .where(eq(runSteps.runId, runId));
  return {
    run,
    agent: agent!,
    config: version!.config,
    tenant: tenant!,
    lastStepSeq: Number(lastStep?.seq ?? 0),
    messages: history.map((m) => ({ role: m.role, content: m.content }) as BetaMessageParam),
  };
}

export async function markRunStarted(tx: Tx, runId: string): Promise<boolean> {
  const updated = await tx
    .update(runs)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(runs.id, runId), eq(runs.status, "queued")))
    .returning({ id: runs.id });
  return updated.length === 1;
}

export async function recordRunStep(
  tx: Tx,
  input: {
    tenantId: string;
    runId: string;
    seq: number;
    type: "llm" | "thinking" | "tool" | "approval";
    name?: string | null;
    data: Record<string, unknown>;
    isError?: boolean;
    costUsdMicros?: number;
    durationMs?: number | null;
  },
) {
  await tx.insert(runSteps).values({
    tenantId: input.tenantId,
    runId: input.runId,
    seq: input.seq,
    type: input.type,
    name: input.name ?? null,
    data: input.data,
    isError: input.isError ?? false,
    costUsdMicros: input.costUsdMicros ?? 0,
    durationMs: input.durationMs ?? null,
  });
}

export async function recordUsage(
  tx: Tx,
  input: {
    tenantId: string;
    runId: string;
    agentId: string;
    model: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
    };
    costUsdMicros: number;
  },
) {
  await tx.insert(usageEvents).values({
    tenantId: input.tenantId,
    runId: input.runId,
    agentId: input.agentId,
    model: input.model,
    ...input.usage,
    costUsdMicros: input.costUsdMicros,
  });
}

/** Persists the outcome: new messages (append-only), totals and final status. */
export async function finishRun(
  tx: Tx,
  input: { tenantId: string; runId: string; conversationId: string; result: RunResult },
) {
  const [{ next }] = (await tx
    .select({ next: sql<number>`coalesce(max(${messages.seq}), 0) + 1` })
    .from(messages)
    .where(eq(messages.conversationId, input.conversationId))) as [{ next: number }];
  const rows = input.result.newMessages.map((message, index) => {
    // The runtime only appends assistant turns and tool results (user role).
    if (message.role === "system") throw new Error("Unerwartete System-Nachricht im Verlauf.");
    return {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      runId: input.runId,
      seq: Number(next) + index,
      role: message.role,
      content: (typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content) as unknown[],
    };
  });
  if (rows.length > 0) await tx.insert(messages).values(rows);

  const { usage } = input.result;
  // A run that paused for approval continues later: add up, don't overwrite.
  await tx
    .update(runs)
    .set({
      status: input.result.status satisfies RunStatus,
      steps: sql`${runs.steps} + ${input.result.steps}`,
      inputTokens: sql`${runs.inputTokens} + ${usage.inputTokens}`,
      outputTokens: sql`${runs.outputTokens} + ${usage.outputTokens}`,
      cacheReadTokens: sql`${runs.cacheReadTokens} + ${usage.cacheReadTokens}`,
      cacheWriteTokens: sql`${runs.cacheWriteTokens} + ${usage.cacheWriteTokens}`,
      costUsdMicros: sql`${runs.costUsdMicros} + ${input.result.costUsdMicros}`,
      finalText: input.result.finalText || null,
      error: input.result.refusal
        ? `Abgelehnt (${input.result.refusal.category ?? "unbekannt"})`
        : null,
      finishedAt: new Date(),
    })
    .where(eq(runs.id, input.runId));
  await tx
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, input.conversationId));
}

export async function failRun(tx: Tx, runId: string, error: string) {
  await tx
    .update(runs)
    .set({ status: "failed", error: error.slice(0, 1000), finishedAt: new Date() })
    .where(eq(runs.id, runId));
}

export async function listRunSteps(tx: Tx, runId: string) {
  return tx.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.seq));
}
