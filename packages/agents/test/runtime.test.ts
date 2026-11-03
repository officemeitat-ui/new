import { formatDate } from "@nexus/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { calculatorTool, currentTimeTool } from "../src/builtin-tools";
import { DEFAULT_PRICES } from "../src/pricing";
import { CAPABILITIES } from "../src/provider";
import { buildSystem } from "../src/prompt";
import {
  buildRequest,
  runAgent,
  type PolicyDecision,
  type RunAgentInput,
  type RunEvent,
} from "../src/runtime";
import {
  refusalResponse,
  scriptedClient,
  textResponse,
  toolUseResponse,
  withUsage,
} from "../src/testing";
import { defineTool } from "../src/tools";

const system = buildSystem({
  platformName: "ME-IT Nexus",
  company: { name: "Huber Haustechnik GmbH", industry: "Installateur", location: "Linz" },
  agentName: "Assistent",
  instructions: "Helfen Sie dem Team bei Alltagsfragen.",
});

function setup(
  script: Parameters<typeof scriptedClient>[0],
  overrides: Partial<RunAgentInput> = {},
) {
  const client = scriptedClient(script);
  const events: RunEvent[] = [];
  const input: RunAgentInput = {
    client,
    capabilities: CAPABILITIES.anthropic,
    model: "claude-opus-5-5",
    effort: "medium",
    system,
    tools: [calculatorTool, currentTimeTool],
    messages: [{ role: "user", content: "Was ist 19 % von 1.250?" }],
    prices: DEFAULT_PRICES,
    limits: { maxSteps: 5 },
    toolContext: {
      tenantId: "t1",
      userId: "u1",
      runId: "run1",
      now: () => new Date("2026-11-03T08:00:00Z"),
    },
    onEvent: (event) => {
      events.push(event);
    },
    ...overrides,
  };
  return { client, events, input };
}

describe("runAgent", () => {
  it("streams a plain answer and accounts for tokens and cost", async () => {
    const { input, events } = setup([
      withUsage(textResponse("Das sind 237,50 €."), 1000, 200, 5000, 0),
    ]);
    const result = await runAgent(input);
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Das sind 237,50 €.");
    expect(
      events
        .filter((e) => e.type === "text_delta")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe("Das sind 237,50 €.");
    // 1000×4 + 200×20 + 5000×0.2 = 9000 micro-dollars
    expect(result.costUsdMicros).toBe(9000);
    expect(result.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 5000,
      cacheWriteTokens: 0,
    });
    expect(result.newMessages).toHaveLength(1);
  });

  it("runs parallel tool calls and returns all results in one message", async () => {
    const { input, client, events } = setup([
      toolUseResponse([
        { id: "tu1", name: "rechner", input: { ausdruck: "1250 * 0,19" } },
        { id: "tu2", name: "aktuelle_zeit", input: {} },
      ]),
      textResponse("19 % von 1.250 sind 237,50."),
    ]);
    const result = await runAgent(input);
    expect(result.status).toBe("completed");

    const second = client.requests[1]!;
    const toolResultMessage = second.messages.at(-1)!;
    expect(toolResultMessage.role).toBe("user");
    const blocks = toolResultMessage.content as {
      type: string;
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }[];
    expect(blocks.map((b) => b.tool_use_id)).toEqual(["tu1", "tu2"]);
    expect(JSON.parse(blocks[0]!.content)).toEqual({ ausdruck: "1250 * 0,19", ergebnis: 237.5 });
    expect(blocks.every((b) => !b.is_error)).toBe(true);

    // The assistant turn is appended in full, thinking block included.
    const assistant = second.messages.at(-2)!;
    expect((assistant.content as { type: string }[]).map((b) => b.type)).toEqual([
      "thinking",
      "tool_use",
      "tool_use",
    ]);
    expect(events.filter((e) => e.type === "tool_result")).toHaveLength(2);
    expect(events.some((e) => e.type === "thinking")).toBe(true);
  });

  it("reports unknown tools and invalid input to the model instead of crashing", async () => {
    const { input, client } = setup([
      toolUseResponse([
        { id: "a", name: "gibt_es_nicht", input: {} },
        { id: "b", name: "rechner", input: { ausdruck: 42 } },
        { id: "c", name: "rechner", input: { ausdruck: "process.exit(1)" } },
      ]),
      textResponse("Entschuldigung."),
    ]);
    await runAgent(input);
    const results = client.requests[1]!.messages.at(-1)!.content as {
      content: string;
      is_error?: boolean;
    }[];
    expect(results.every((r) => r.is_error)).toBe(true);
    expect(results[0]!.content).toMatch(/Unbekanntes Werkzeug/);
    expect(results[1]!.content).toMatch(/Ungültige Eingabe/);
    expect(results[2]!.content).toMatch(/Fehler im Werkzeug rechner/);
  });

  describe("approvals", () => {
    const sendMail = defineTool({
      name: "mail__send",
      description: "Sendet eine E-Mail.",
      risk: "external_write",
      input: z.object({ to: z.string(), body: z.string() }),
      run: async (mail) => ({ sent: true, to: mail.to }),
    });
    const policy = (tool: { risk: string }): PolicyDecision =>
      tool.risk === "external_write" ? "approve" : "allow";

    it("pauses before an external action and continues after approval", async () => {
      const first = setup(
        [
          toolUseResponse([
            { id: "m1", name: "mail__send", input: { to: "kunde@example.at", body: "Hallo" } },
          ]),
        ],
        { tools: [sendMail], policy },
      );
      const paused = await runAgent(first.input);
      expect(paused.status).toBe("awaiting_approval");
      expect(paused.pendingApprovals).toEqual([
        {
          toolUseId: "m1",
          toolName: "mail__send",
          input: { to: "kunde@example.at", body: "Hallo" },
        },
      ]);
      expect(first.events.some((e) => e.type === "tool_result")).toBe(false);

      const second = setup([textResponse("E-Mail ist raus.")], {
        tools: [sendMail],
        policy,
        messages: paused.messages,
        decisions: {
          m1: {
            approved: true,
            input: { to: "kunde@example.at", body: "Hallo, Ihr Termin passt." },
          },
        },
      });
      const resumed = await runAgent(second.input);
      expect(resumed.status).toBe("completed");
      const results = second.client.requests[0]!.messages.at(-1)!.content as { content: string }[];
      expect(JSON.parse(results[0]!.content)).toEqual({ sent: true, to: "kunde@example.at" });
    });

    it("tells the model when a human rejected the action", async () => {
      const first = setup(
        [
          toolUseResponse([
            { id: "m1", name: "mail__send", input: { to: "x@example.at", body: "Hi" } },
          ]),
        ],
        { tools: [sendMail], policy },
      );
      const paused = await runAgent(first.input);
      const second = setup([textResponse("Verstanden, ich sende nichts.")], {
        tools: [sendMail],
        policy,
        messages: paused.messages,
        decisions: { m1: { approved: false, reason: "Falscher Empfänger" } },
      });
      await runAgent(second.input);
      const results = second.client.requests[0]!.messages.at(-1)!.content as {
        content: string;
        is_error?: boolean;
      }[];
      expect(results[0]).toMatchObject({ is_error: true });
      expect(results[0]!.content).toMatch(/abgelehnt.*Falscher Empfänger/);
    });

    it("blocks denied actions", async () => {
      const { input, client } = setup(
        [
          toolUseResponse([{ id: "m1", name: "mail__send", input: { to: "x", body: "y" } }]),
          textResponse("Ok."),
        ],
        { tools: [sendMail], policy: () => "deny" },
      );
      await runAgent(input);
      const results = client.requests[1]!.messages.at(-1)!.content as { content: string }[];
      expect(results[0]!.content).toMatch(/nicht erlaubt/);
    });
  });

  it("stops on a refusal and reports the category", async () => {
    const { input } = setup([refusalResponse("cyber")]);
    const result = await runAgent(input);
    expect(result.status).toBe("refused");
    expect(result.refusal?.category).toBe("cyber");
  });

  it("never runs a tool call that was cut off at max_tokens", async () => {
    let ran = false;
    const tool = defineTool({
      name: "spy",
      description: "x",
      risk: "read",
      input: z.object({}),
      run: async () => {
        ran = true;
        return "ok";
      },
    });
    const truncated = {
      ...toolUseResponse([{ id: "s", name: "spy", input: {} }]),
      stop_reason: "max_tokens" as const,
    };
    const { input } = setup([truncated], { tools: [tool] });
    const result = await runAgent(input);
    expect(result.status).toBe("incomplete");
    expect(ran).toBe(false);
  });

  it("continues after pause_turn", async () => {
    const paused = { ...textResponse("Ich suche noch …"), stop_reason: "pause_turn" as const };
    const { input, client } = setup([paused, textResponse("Fertig.")]);
    const result = await runAgent(input);
    expect(result.status).toBe("completed");
    expect(client.requests).toHaveLength(2);
  });

  it("enforces the step limit and the cost budget", async () => {
    const loop = () =>
      toolUseResponse([{ id: `t${Math.random()}`, name: "aktuelle_zeit", input: {} }]);
    const steps = setup([loop, loop, loop], { limits: { maxSteps: 2 } });
    expect((await runAgent(steps.input)).status).toBe("max_steps");

    const expensive = withUsage(
      toolUseResponse([{ id: "t", name: "aktuelle_zeit", input: {} }]),
      100_000,
      10_000,
    );
    const budget = setup([expensive, textResponse("nie erreicht")], {
      limits: { maxSteps: 5, maxCostUsdMicros: 100_000 },
    });
    const result = await runAgent(budget.input);
    expect(result.status).toBe("budget_exceeded");
    expect(budget.client.remaining()).toBe(1);
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { input } = setup([textResponse("nie")], { signal: controller.signal });
    expect((await runAgent(input)).status).toBe("cancelled");
  });
});

describe("buildRequest", () => {
  const base = {
    model: "claude-opus-5-5",
    effort: "medium" as const,
    system,
    tools: [currentTimeTool, calculatorTool],
    capabilities: CAPABILITIES.anthropic,
    limits: { maxSteps: 5 },
  };

  it("keeps the cached prefix byte-identical across conversations", () => {
    const a = buildRequest(base, [{ role: "user", content: "Erste Frage" }]);
    const b = buildRequest({ ...base, tools: [calculatorTool, currentTimeTool] }, [
      { role: "user", content: "Ganz andere Frage" },
    ]);
    expect(JSON.stringify([a.tools, a.system])).toBe(JSON.stringify([b.tools, b.system]));
    expect(a.tools!.map((t) => (t as { name: string }).name)).toEqual(["aktuelle_zeit", "rechner"]);
    // Nothing volatile in the system prompt.
    expect(JSON.stringify(a.system)).not.toContain(formatDate(new Date()));
  });

  it("follows the current API rules", () => {
    const request = buildRequest(base, [{ role: "user", content: "Hallo" }]) as unknown as Record<
      string,
      unknown
    >;
    expect(request.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(request.output_config).toEqual({ effort: "medium" });
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("tool_choice");
    expect(request.cache_control).toEqual({ type: "ephemeral" });
    expect(request.fallbacks).toBe("default");
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    for (const tool of request.tools as {
      strict: boolean;
      input_schema: Record<string, unknown>;
    }[]) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
      expect(tool.input_schema).not.toHaveProperty("$schema");
    }
  });

  it("uses server-side fallbacks only where the provider supports them", () => {
    const request = buildRequest(
      { ...base, capabilities: CAPABILITIES.bedrock },
      [],
    ) as unknown as Record<string, unknown>;
    expect(request).not.toHaveProperty("fallbacks");
    expect(request).not.toHaveProperty("betas");
  });
});
