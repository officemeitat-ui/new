import Anthropic from "@anthropic-ai/sdk";
import {
  BUILTIN_TOOLS,
  buildSystem,
  DEFAULT_PRICES,
  isEffort,
  runAgent,
  type LlmProvider,
  type ModelPrice,
  type RunEvent,
  type ToolPolicy,
} from "@nexus/agents";
import { RUN_EVENTS_TTL_SECONDS, runEventsKey, type AgentRunJob } from "@nexus/core";
import type { Logger } from "@nexus/core/logger";
import { withTenant, type Database } from "@nexus/db";
import {
  failRun,
  finishRun,
  loadRunForExecution,
  markRunStarted,
  recordRunStep,
  recordUsage,
} from "@nexus/domain";
import type { Redis } from "ioredis";

export type RunEventPublisher = (runId: string, event: Record<string, unknown>) => Promise<void>;

/** Events go to a capped Redis stream, so an SSE client that connects late can replay them. */
export function redisPublisher(redis: Redis): RunEventPublisher {
  return async (runId, event) => {
    const key = runEventsKey(runId);
    await redis
      .multi()
      .xadd(key, "MAXLEN", "~", "5000", "*", "event", JSON.stringify(event))
      .expire(key, RUN_EVENTS_TTL_SECONDS)
      .exec();
  };
}

export type AgentRunDeps = {
  db: Database;
  provider: () => Promise<LlmProvider>;
  publish: RunEventPublisher;
  platformName: string;
  /** Current model prices; defaults to the built-in list (tests). */
  loadPrices?: () => Promise<Record<string, ModelPrice>>;
  log: Logger;
};

/** Message for the user; details stay in the logs. */
function userFacingError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Der KI-Anbieter hat die Zugangsdaten abgelehnt. Bitte informieren Sie Ihren Administrator.";
  }
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
    return "Der KI-Anbieter ist gerade überlastet. Bitte versuchen Sie es in einer Minute erneut.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Der KI-Anbieter ist nicht erreichbar. Bitte versuchen Sie es später erneut.";
  }
  return "Der Agent konnte die Aufgabe nicht abschließen. Der Fehler wurde protokolliert.";
}

/**
 * Executes one agent run. Idempotent: a run that is no longer "queued" is skipped. Runs are
 * deliberately not retried automatically – a retry could repeat tool actions (ADR 0005).
 */
export async function processAgentRun(job: AgentRunJob, deps: AgentRunDeps) {
  const { runId, tenantId } = job;
  const { db, publish, log } = deps;

  const started = await withTenant(db, tenantId, (tx) => markRunStarted(tx, runId));
  if (!started) {
    log.warn({ runId }, "run is not queued anymore – skipping");
    return { status: "skipped" as const };
  }

  try {
    const ctx = await withTenant(db, tenantId, (tx) => loadRunForExecution(tx, runId));
    const provider = await deps.provider();
    const modes = new Map(ctx.config.tools.map((tool) => [tool.name, tool.mode]));
    // Tools in "deny" mode are not offered to the model at all.
    const tools = BUILTIN_TOOLS.filter(
      (tool) => modes.has(tool.name) && modes.get(tool.name) !== "deny",
    );
    const policy: ToolPolicy = (tool) => {
      const mode = modes.get(tool.name);
      return mode === "approve" ? "approve" : mode === "auto" ? "allow" : "deny";
    };

    let seq = 0;
    const onEvent = async (event: RunEvent) => {
      await publish(runId, event);
      if (event.type === "text_delta" || event.type === "llm_request") return;
      seq += 1;
      const stepSeq = seq;
      await withTenant(db, tenantId, async (tx) => {
        switch (event.type) {
          case "llm_response":
            await recordRunStep(tx, {
              tenantId,
              runId,
              seq: stepSeq,
              type: "llm",
              name: event.model,
              data: { step: event.step, stopReason: event.stopReason, usage: event.usage },
              costUsdMicros: event.costUsdMicros,
              durationMs: event.durationMs,
            });
            await recordUsage(tx, {
              tenantId,
              runId,
              agentId: ctx.agent.id,
              model: event.model,
              usage: event.usage,
              costUsdMicros: event.costUsdMicros,
            });
            break;
          case "thinking":
            await recordRunStep(tx, {
              tenantId,
              runId,
              seq: stepSeq,
              type: "thinking",
              data: { text: event.text },
            });
            break;
          case "tool_call":
            await recordRunStep(tx, {
              tenantId,
              runId,
              seq: stepSeq,
              type: "tool",
              name: event.toolName,
              data: {
                phase: "call",
                toolUseId: event.toolUseId,
                input: event.input,
                decision: event.decision,
              },
            });
            break;
          case "tool_result":
            await recordRunStep(tx, {
              tenantId,
              runId,
              seq: stepSeq,
              type: "tool",
              name: event.toolName,
              data: {
                phase: "result",
                toolUseId: event.toolUseId,
                output: event.output.slice(0, 4000),
              },
              isError: event.isError,
              durationMs: event.durationMs,
            });
            break;
          case "approval_required":
            await recordRunStep(tx, {
              tenantId,
              runId,
              seq: stepSeq,
              type: "approval",
              data: { approvals: event.approvals },
            });
            break;
        }
      });
    };

    const result = await runAgent({
      client: provider.client,
      capabilities: provider.capabilities,
      model: provider.modelId(ctx.run.model),
      effort: isEffort(ctx.run.effort) ? ctx.run.effort : "medium",
      system: buildSystem({
        platformName: deps.platformName,
        company: { name: ctx.tenant.name },
        agentName: ctx.agent.name,
        instructions: ctx.config.instructions,
      }),
      tools,
      policy,
      messages: ctx.messages,
      prices: deps.loadPrices ? await deps.loadPrices() : DEFAULT_PRICES,
      limits: {
        maxSteps: ctx.config.maxSteps,
        ...(ctx.config.maxCostUsdMicros !== undefined
          ? { maxCostUsdMicros: ctx.config.maxCostUsdMicros }
          : {}),
      },
      toolContext: { tenantId, userId: ctx.run.triggeredBy, runId },
      onEvent,
    });

    await withTenant(db, tenantId, (tx) =>
      finishRun(tx, { tenantId, runId, conversationId: ctx.run.conversationId, result }),
    );
    await publish(runId, { type: "done", status: result.status });
    log.info(
      { runId, status: result.status, steps: result.steps, costUsdMicros: result.costUsdMicros },
      "run finished",
    );
    return { status: result.status };
  } catch (error) {
    log.error({ runId, err: error }, "run failed");
    const message = userFacingError(error);
    await withTenant(db, tenantId, (tx) => failRun(tx, runId, message));
    await publish(runId, { type: "done", status: "failed", error: message });
    return { status: "failed" as const };
  }
}
