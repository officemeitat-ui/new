import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages";
import type { Effort } from "./models";
import {
  addUsage,
  costUsdMicros,
  priceFor,
  usageFromApi,
  ZERO_USAGE,
  type ModelPrice,
  type TokenUsage,
} from "./pricing";
import type { LlmClient, ProviderCapabilities } from "./provider";
import { sortTools, toToolParam, type AgentTool, type ToolContext } from "./tools";

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type BetaTextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;

/** Decided in code before a tool runs – never by the model (master prompt, section 8.7). */
export type PolicyDecision = "allow" | "approve" | "deny";
export type ToolPolicy = (tool: AgentTool, input: unknown) => PolicyDecision;

export type ApprovalDecision =
  | { approved: true; input?: unknown; decidedBy?: string }
  | { approved: false; reason?: string; decidedBy?: string };

export type PendingApproval = { toolUseId: string; toolName: string; input: unknown };

export type RunEvent =
  | { type: "llm_request"; step: number; model: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "llm_response";
      step: number;
      model: string;
      stopReason: string | null;
      usage: TokenUsage;
      costUsdMicros: number;
      durationMs: number;
    }
  | {
      type: "tool_call";
      toolUseId: string;
      toolName: string;
      input: unknown;
      decision: PolicyDecision;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      toolName: string;
      isError: boolean;
      output: string;
      durationMs: number;
    }
  | { type: "approval_required"; approvals: PendingApproval[] };

export type RunStatus =
  | "completed"
  | "awaiting_approval"
  | "refused"
  | "incomplete"
  | "max_steps"
  | "budget_exceeded"
  | "cancelled";

export type RunResult = {
  status: RunStatus;
  /** Full history including everything this run appended. Append-only, never rewritten. */
  messages: BetaMessageParam[];
  /** Only the messages this run appended (for persistence). */
  newMessages: BetaMessageParam[];
  finalText: string;
  usage: TokenUsage;
  costUsdMicros: number;
  steps: number;
  pendingApprovals: PendingApproval[];
  refusal?: { category: string | null; explanation: string | null };
};

export type RunLimits = {
  /** Model requests per run (master prompt default: 25). */
  maxSteps: number;
  /** Stops before the next request once the run has cost this much. */
  maxCostUsdMicros?: number;
  maxTokensPerResponse?: number;
};

export type RunAgentInput = {
  client: LlmClient;
  capabilities: ProviderCapabilities;
  /** Platform-specific model ID (see LlmProvider.modelId). */
  model: string;
  effort: Effort;
  system: BetaTextBlockParam[];
  tools: readonly AgentTool[];
  messages: BetaMessageParam[];
  prices: Record<string, ModelPrice>;
  limits: RunLimits;
  toolContext: Omit<ToolContext, "signal" | "idempotencyKey" | "now"> & { now?: () => Date };
  policy?: ToolPolicy;
  /** Decisions for tool calls that were waiting for approval when the run paused. */
  decisions?: Record<string, ApprovalDecision>;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void | Promise<void>;
};

export const DEFAULT_LIMITS: RunLimits = { maxSteps: 25, maxTokensPerResponse: 32_000 };
const MAX_TOOL_OUTPUT_CHARS = 20_000;
const allowAll: ToolPolicy = () => "allow";

function toolUses(
  content: BetaMessage["content"] | BetaMessageParam["content"] | undefined,
): BetaToolUseBlock[] {
  if (!content || typeof content === "string") return [];
  return content.filter((block): block is BetaToolUseBlock => block.type === "tool_use");
}

function textOf(message: BetaMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { text: string }).text)
    .join("");
}

function serialiseOutput(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > MAX_TOOL_OUTPUT_CHARS
    ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n[… gekürzt, ${text.length - MAX_TOOL_OUTPUT_CHARS} Zeichen ausgelassen]`
    : text;
}

/** Tool calls of the last assistant message that have no result yet (run paused for approval). */
export function unansweredToolUses(messages: BetaMessageParam[]): BetaToolUseBlock[] {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return [];
  return toolUses(last.content);
}

/** The exact request the runtime sends. Exposed so tests can check prefix stability. */
export function buildRequest(
  input: Pick<RunAgentInput, "model" | "effort" | "system" | "tools" | "capabilities" | "limits">,
  messages: BetaMessageParam[],
): BetaMessageStreamParams {
  const tools = sortTools(input.tools).map(toToolParam);
  return {
    model: input.model,
    max_tokens: input.limits.maxTokensPerResponse ?? 32_000,
    system: input.system,
    ...(tools.length > 0 ? { tools } : {}),
    messages,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: input.effort },
    // Automatic caching: the stable prefix (tools → system → earlier turns) is reused.
    cache_control: { type: "ephemeral" },
    ...(input.capabilities.serverSideFallbacks
      ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
      : {}),
  };
}

/**
 * The agent loop (docs/adr/0003-eigene-agentenschleife.md): stream a response, check the
 * stop reason, run permitted tools in parallel, return all results in one message, repeat.
 * Pauses (status "awaiting_approval") when a tool call needs a human decision; call again with
 * `decisions` and the returned messages to continue.
 */
export async function runAgent(input: RunAgentInput): Promise<RunResult> {
  const messages = [...input.messages];
  const startLength = messages.length;
  const policy = input.policy ?? allowAll;
  const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const now = input.toolContext.now ?? (() => new Date());
  const controller = new AbortController();
  if (input.signal?.aborted) controller.abort(input.signal.reason);
  input.signal?.addEventListener("abort", () => controller.abort(input.signal?.reason), {
    once: true,
  });

  let usage = ZERO_USAGE;
  let cost = 0;
  let finalText = "";
  let steps = 0;

  const emit = async (event: RunEvent) => {
    await input.onEvent?.(event);
  };
  const result = (status: RunStatus, extra: Partial<RunResult> = {}): RunResult => ({
    status,
    messages,
    newMessages: messages.slice(startLength),
    finalText,
    usage,
    costUsdMicros: cost,
    steps,
    pendingApprovals: [],
    ...extra,
  });

  async function runOne(
    block: BetaToolUseBlock,
    decision: ApprovalDecision | undefined,
  ): Promise<BetaToolResultBlockParam> {
    const started = performance.now();
    const tool = toolsByName.get(block.name);
    const finish = async (output: string, isError: boolean): Promise<BetaToolResultBlockParam> => {
      await emit({
        type: "tool_result",
        toolUseId: block.id,
        toolName: block.name,
        isError,
        output,
        durationMs: Math.round(performance.now() - started),
      });
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: output,
        ...(isError ? { is_error: true } : {}),
      };
    };

    if (!tool) return finish(`Unbekanntes Werkzeug "${block.name}".`, true);
    if (decision && !decision.approved) {
      return finish(
        `Die Aktion wurde von einem Menschen abgelehnt.${decision.reason ? ` Begründung: ${decision.reason}` : ""}`,
        true,
      );
    }
    const rawInput =
      decision?.approved && decision.input !== undefined ? decision.input : block.input;
    const parsed = tool.input.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(Eingabe)"}: ${i.message}`,
      );
      return finish(`Ungültige Eingabe für ${tool.name}: ${issues.join("; ")}`, true);
    }
    try {
      const output = await tool.run(parsed.data, {
        ...input.toolContext,
        now: now(),
        signal: controller.signal,
        idempotencyKey: `${input.toolContext.runId}:${block.id}`,
      });
      return finish(serialiseOutput(output), false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return finish(`Fehler im Werkzeug ${tool.name}: ${message.slice(0, 500)}`, true);
    }
  }

  /**
   * Runs one batch of tool calls. If any call needs approval, nothing in the batch runs:
   * all results of one assistant turn must go back together in a single user message.
   */
  async function handleToolUses(
    blocks: BetaToolUseBlock[],
    decisions: Record<string, ApprovalDecision>,
  ): Promise<PendingApproval[] | BetaToolResultBlockParam[]> {
    const planned = blocks.map((block) => {
      const tool = toolsByName.get(block.name);
      const verdict: PolicyDecision = tool ? policy(tool, block.input) : "allow";
      return { block, verdict, decision: decisions[block.id] };
    });

    const waiting = planned.filter((p) => p.verdict === "approve" && !p.decision);
    if (waiting.length > 0) {
      return waiting.map((p) => ({
        toolUseId: p.block.id,
        toolName: p.block.name,
        input: p.block.input,
      }));
    }

    for (const p of planned) {
      await emit({
        type: "tool_call",
        toolUseId: p.block.id,
        toolName: p.block.name,
        input: p.block.input,
        decision: p.verdict,
      });
    }
    return Promise.all(
      planned.map((p) =>
        p.verdict === "deny"
          ? (async (): Promise<BetaToolResultBlockParam> => {
              const output = "Diese Aktion ist für diesen Agenten nicht erlaubt.";
              await emit({
                type: "tool_result",
                toolUseId: p.block.id,
                toolName: p.block.name,
                isError: true,
                output,
                durationMs: 0,
              });
              return {
                type: "tool_result",
                tool_use_id: p.block.id,
                content: output,
                is_error: true,
              };
            })()
          : runOne(p.block, p.decision),
      ),
    );
  }

  const isPending = (
    value: PendingApproval[] | BetaToolResultBlockParam[],
  ): value is PendingApproval[] => value.length > 0 && "toolUseId" in value[0]!;

  // Resuming a paused run: answer the open tool calls first.
  const open = unansweredToolUses(messages);
  if (open.length > 0) {
    const outcome = await handleToolUses(open, input.decisions ?? {});
    if (isPending(outcome)) {
      await emit({ type: "approval_required", approvals: outcome });
      return result("awaiting_approval", { pendingApprovals: outcome });
    }
    messages.push({ role: "user", content: outcome });
  }

  while (steps < input.limits.maxSteps) {
    if (controller.signal.aborted) return result("cancelled");
    if (input.limits.maxCostUsdMicros !== undefined && cost >= input.limits.maxCostUsdMicros) {
      return result("budget_exceeded");
    }

    steps++;
    await emit({ type: "llm_request", step: steps, model: input.model });
    const started = performance.now();
    const stream = input.client.beta.messages.stream(buildRequest(input, messages), {
      signal: controller.signal,
    });
    stream.on("text", (delta) => {
      void emit({ type: "text_delta", text: delta });
    });
    let message: BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (error) {
      if (controller.signal.aborted) return result("cancelled");
      throw error;
    }

    const stepUsage = usageFromApi(message.usage);
    const price = priceFor(message.model, input.prices) ?? priceFor(input.model, input.prices);
    const stepCost = price ? costUsdMicros(stepUsage, price) : 0;
    usage = addUsage(usage, stepUsage);
    cost += stepCost;

    for (const block of message.content) {
      if (block.type === "thinking" && block.thinking.trim()) {
        await emit({ type: "thinking", text: block.thinking });
      }
    }
    await emit({
      type: "llm_response",
      step: steps,
      model: message.model,
      stopReason: message.stop_reason,
      usage: stepUsage,
      costUsdMicros: stepCost,
      durationMs: Math.round(performance.now() - started),
    });

    // Append the complete content (thinking blocks included) – never only the text.
    messages.push({ role: "assistant", content: message.content });
    const text = textOf(message);
    if (text) finalText = text;

    switch (message.stop_reason) {
      case "end_turn":
      case "stop_sequence":
        return result("completed");
      case "pause_turn":
        continue;
      case "refusal":
        return result("refused", {
          refusal: {
            category: message.stop_details?.category ?? null,
            explanation: message.stop_details?.explanation ?? null,
          },
        });
      case "max_tokens":
        // A tool call cut off at max_tokens may parse as a truncated object: never run it.
        return result("incomplete");
      case "tool_use": {
        const blocks = toolUses(message.content);
        if (blocks.length === 0) return result("completed");
        const outcome = await handleToolUses(blocks, {});
        if (isPending(outcome)) {
          await emit({ type: "approval_required", approvals: outcome });
          return result("awaiting_approval", { pendingApprovals: outcome });
        }
        messages.push({ role: "user", content: outcome });
        continue;
      }
      default:
        return result("incomplete");
    }
  }
  return result("max_steps");
}
