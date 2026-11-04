import Anthropic from "@anthropic-ai/sdk";
import {
  ALWAYS_APPROVE,
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
  createApprovals,
  createDefectReportsTool,
  createEmailTool,
  createIntuneTools,
  createKnowledgeTool,
  getIntegration,
  microsoftAppConfig,
  type MicrosoftAppConfig,
  failRun,
  finishRun,
  loadDecisions,
  loadRunForExecution,
  markRunStarted,
  recordRunStep,
  recordUsage,
  touchRun,
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
  /** Abort after this long without any event (tests use a small value). */
  idleTimeoutMs?: number;
  /** Platform Entra app for Microsoft 365; defaults to the environment (null = not set up). */
  microsoft?: MicrosoftAppConfig | null;
  /** Current model prices; defaults to the built-in list (tests). */
  loadPrices?: () => Promise<Record<string, ModelPrice>>;
  log: Logger;
};

/** Message for the user; details stay in the logs. */
function userFacingError(error: unknown): string {
  if (error instanceof IdleTimeoutError) {
    return "Der KI-Anbieter hat zu lange nicht geantwortet. Bitte versuchen Sie es erneut.";
  }
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
/** Without any event from the model for this long, the run is aborted (robustness review). */
export const IDLE_TIMEOUT_MS = 120_000;
const HEARTBEAT_EVERY_MS = 15_000;

export async function processAgentRun(job: AgentRunJob, deps: AgentRunDeps) {
  const { runId, tenantId } = job;
  const { db, log } = deps;
  // Live events are best-effort: a Redis hiccup must neither abort nor fail a run. The final
  // state is always in Postgres, and the SSE route falls back to it.
  const publish = async (id: string, event: Record<string, unknown>) => {
    try {
      await deps.publish(id, event);
    } catch (error) {
      log.warn({ runId: id, err: error }, "could not publish run event");
    }
  };
  let lastBeat = Date.now();
  const idle = new AbortController();
  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idle.abort("idle"), deps.idleTimeoutMs ?? IDLE_TIMEOUT_MS);
  };

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
    // Platform tools: built-in ones plus tools that need tenant context (e-mail, knowledge).
    // Intune tools exist only for tenants with a Microsoft 365 connection.
    const microsoft = deps.microsoft === undefined ? microsoftAppConfig() : deps.microsoft;
    const connected =
      microsoft !== null &&
      (await withTenant(db, tenantId, (tx) => getIntegration(tx, tenantId, "microsoft365"))) !==
        null;
    const platformTools = [
      ...BUILTIN_TOOLS,
      createEmailTool({ tenantName: ctx.tenant.name }),
      createKnowledgeTool({ db, collectionIds: ctx.config.knowledgeCollectionIds ?? [] }),
      createDefectReportsTool({ db }),
      ...(connected && microsoft ? createIntuneTools({ db, config: microsoft }) : []),
    ];
    const tools = platformTools.filter(
      (tool) => modes.has(tool.name) && modes.get(tool.name) !== "deny",
    );
    // Decisions for tool calls the run paused on (empty for a fresh run).
    const decisions = await withTenant(db, tenantId, (tx) => loadDecisions(tx, runId));

    const policy: ToolPolicy = (tool) => {
      const mode = modes.get(tool.name);
      // Defence in depth: risky tools need an approval even if an old config says "auto".
      if (mode === "auto" && ALWAYS_APPROVE.has(tool.risk)) return "approve";
      return mode === "approve" ? "approve" : mode === "auto" ? "allow" : "deny";
    };

    let seq = ctx.lastStepSeq;
    const onEvent = async (event: RunEvent) => {
      resetIdle();
      await publish(runId, event);
      if (Date.now() - lastBeat > HEARTBEAT_EVERY_MS) {
        lastBeat = Date.now();
        await touchRun(db, tenantId, runId).catch(() => undefined);
      }
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

    resetIdle();
    const result = await runAgent({
      signal: idle.signal,
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
      // Limits apply to the whole run, also across pauses for approvals (finding 11).
      limits: {
        maxSteps: Math.max(1, ctx.config.maxSteps - ctx.run.steps),
        ...(ctx.config.maxCostUsdMicros !== undefined
          ? { maxCostUsdMicros: Math.max(1, ctx.config.maxCostUsdMicros - ctx.run.costUsdMicros) }
          : {}),
      },
      toolContext: { tenantId, userId: ctx.run.triggeredBy, runId },
      decisions,
      onEvent,
    });

    clearTimeout(idleTimer);
    if (result.status === "cancelled" && idle.signal.aborted) {
      throw new IdleTimeoutError();
    }
    await withTenant(db, tenantId, async (tx) => {
      await finishRun(tx, { tenantId, runId, conversationId: ctx.run.conversationId, result });
      if (result.status === "awaiting_approval") {
        await createApprovals(tx, { tenantId, runId, approvals: result.pendingApprovals });
      }
    });
    log.info(
      { runId, status: result.status, steps: result.steps, costUsdMicros: result.costUsdMicros },
      "run finished",
    );
    await publish(runId, { type: "done", status: result.status });
    return { status: result.status };
  } catch (error) {
    clearTimeout(idleTimer);
    log.error({ runId, err: error }, "run failed");
    // An aborted, hanging request surfaces as an abort error: report it as the timeout it is.
    const message = userFacingError(idle.signal.aborted ? new IdleTimeoutError() : error);
    await withTenant(db, tenantId, (tx) => failRun(tx, runId, message));
    await publish(runId, { type: "done", status: "failed", error: message });
    return { status: "failed" as const };
  }
}

class IdleTimeoutError extends Error {}
