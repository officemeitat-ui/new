import { CAPABILITIES, type LlmProvider } from "@nexus/agents";
import { scriptedClient, textResponse, toolUseResponse, withUsage } from "@nexus/agents/testing";
import { createLogger } from "@nexus/core/logger";
import { withSystem, withTenant } from "@nexus/db";
import { authUser, partners, tenants } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { getConversation, listRunSteps, startRun } from "@nexus/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processAgentRun } from "../src/jobs/agent-run";

const handle = openTestDatabase();
const db = handle.db;
const log = createLogger("test");
let tenantId: string;
let userId: string;

beforeAll(async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  await withSystem(db, "test: worker fixture", async (tx) => {
    const [partner] = await tx
      .insert(partners)
      .values({ name: "P", slug: `p-${tag}` })
      .returning();
    const [tenant] = await tx
      .insert(tenants)
      .values({ partnerId: partner!.id, name: "Huber Haustechnik GmbH", slug: `huber-${tag}` })
      .returning();
    const [user] = await tx
      .insert(authUser)
      .values({ name: "Anna", email: `anna-${tag}@example.test` })
      .returning();
    tenantId = tenant!.id;
    userId = user!.id;
  });
});
afterAll(() => handle.close());

function fakeProvider(script: Parameters<typeof scriptedClient>[0]) {
  const client = scriptedClient(script);
  const provider: LlmProvider = {
    name: "anthropic",
    client,
    capabilities: CAPABILITIES.anthropic,
    modelId: (m) => m,
  };
  return { client, provider: async () => provider };
}

describe("processAgentRun", () => {
  it("runs the agent, streams events and persists messages, trace and usage", async () => {
    const { conversationId, runId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId, userName: "Anna", text: "Was sind 20 % USt auf 1.250 €?" }),
    );
    const events: Record<string, unknown>[] = [];
    const { client, provider } = fakeProvider([
      withUsage(
        toolUseResponse([{ id: "t1", name: "rechner", input: { ausdruck: "1250*0,2" } }]),
        900,
        60,
        0,
        4000,
      ),
      withUsage(textResponse("Die USt beträgt 250,00 €."), 950, 30, 4000, 0),
    ]);

    const outcome = await processAgentRun(
      { runId, tenantId },
      {
        db,
        provider,
        publish: async (_id, e) => void events.push(e),
        platformName: "ME-IT Nexus",
        log,
      },
    );
    expect(outcome.status).toBe("completed");

    // System prompt carries the tenant; the first user message carries the <kontext> block.
    const request = client.requests[0]!;
    expect(JSON.stringify(request.system)).toContain("Huber Haustechnik GmbH");
    const firstUser = request.messages[0]!.content as { text: string }[];
    expect(firstUser[0]!.text).toMatch(/^<kontext>\nDatum: /);

    expect(events.at(-1)).toEqual({ type: "done", status: "completed" });
    expect(events.some((e) => e.type === "text_delta")).toBe(true);

    const stored = await withTenant(db, tenantId, (tx) =>
      getConversation(tx, { tenantId, conversationId, userId, canReadAll: false }),
    );
    expect(stored.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const run = stored.runs[0]!;
    expect(run.status).toBe("completed");
    expect(run.finalText).toBe("Die USt beträgt 250,00 €.");
    // (900×4 + 60×20 + 4000×5) + (950×4 + 30×20 + 4000×0.2) = 24,800 + 5,200
    expect(run.costUsdMicros).toBe(30_000);
    expect(run.cacheReadTokens).toBe(4000);

    const steps = await withTenant(db, tenantId, (tx) => listRunSteps(tx, runId));
    expect(steps.map((s) => s.type)).toEqual(["thinking", "llm", "tool", "tool", "llm"]);
  });

  it("continues a conversation with the full history and skips runs that already ran", async () => {
    const first = await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId, userName: "Anna", text: "Hallo" }),
    );
    const one = fakeProvider([textResponse("Grüß Gott!")]);
    await processAgentRun(
      { ...first, tenantId },
      {
        db,
        provider: one.provider,
        publish: async () => {},
        platformName: "X",
        log,
      },
    );
    // Running the same job again does nothing (idempotent).
    expect(
      (
        await processAgentRun(
          { ...first, tenantId },
          {
            db,
            provider: one.provider,
            publish: async () => {},
            platformName: "X",
            log,
          },
        )
      ).status,
    ).toBe("skipped");

    const second = await withTenant(db, tenantId, (tx) =>
      startRun(tx, {
        tenantId,
        userId,
        userName: "Anna",
        text: "Wie spät ist es?",
        conversationId: first.conversationId,
      }),
    );
    const two = fakeProvider([textResponse("Kurz nach acht.")]);
    await processAgentRun(
      { ...second, tenantId },
      {
        db,
        provider: two.provider,
        publish: async () => {},
        platformName: "X",
        log,
      },
    );
    const history = two.client.requests[0]!.messages;
    expect(history.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // Only the first message of a conversation carries the context block.
    expect(JSON.stringify(history[2])).not.toContain("<kontext>");
  });

  it("marks the run as failed with a user-facing message when the provider fails", async () => {
    const { runId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId, userName: "Anna", text: "Test" }),
    );
    const events: Record<string, unknown>[] = [];
    const broken = async (): Promise<LlmProvider> => {
      throw new Error("network down");
    };
    const outcome = await processAgentRun(
      { runId, tenantId },
      {
        db,
        provider: broken,
        publish: async (_id, e) => void events.push(e),
        platformName: "X",
        log,
      },
    );
    expect(outcome.status).toBe("failed");
    expect(events.at(-1)).toMatchObject({ type: "done", status: "failed" });
    expect(String(events.at(-1)!.error)).not.toContain("network down");
  });

  it("refuses a second message while the agent is still working", async () => {
    const { conversationId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId, userName: "Anna", text: "Erste" }),
    );
    await expect(
      withTenant(db, tenantId, (tx) =>
        startRun(tx, { tenantId, userId, userName: "Anna", text: "Zweite", conversationId }),
      ),
    ).rejects.toThrow(/arbeitet noch/);
  });
});
