import { CAPABILITIES, type LlmClient, type LlmProvider } from "@nexus/agents";
import { scriptedClient, textResponse } from "@nexus/agents/testing";
import { createLogger } from "@nexus/core/logger";
import { eq, withSystem, withTenant } from "@nexus/db";
import { authUser, partners, runs, tenants } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { startRun } from "@nexus/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processAgentRun } from "../src/jobs/agent-run";

const handle = openTestDatabase();
const db = handle.db;
const log = createLogger("test");
let tenantId: string;
let userId: string;

beforeAll(async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  await withSystem(db, "test: robustness fixture", async (tx) => {
    const [partner] = await tx
      .insert(partners)
      .values({ name: "P", slug: `p-${tag}` })
      .returning();
    const [tenant] = await tx
      .insert(tenants)
      .values({ partnerId: partner!.id, name: "Robust", slug: `r-${tag}` })
      .returning();
    const [user] = await tx
      .insert(authUser)
      .values({ name: "Rita", email: `rita-${tag}@example.test` })
      .returning();
    tenantId = tenant!.id;
    userId = user!.id;
  });
});
afterAll(() => handle.close());

const provider =
  (client: unknown): (() => Promise<LlmProvider>) =>
  async () => ({
    name: "anthropic",
    client: client as LlmClient,
    capabilities: CAPABILITIES.anthropic,
    modelId: (m) => m,
  });

const run = async (text: string) =>
  (
    await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId, userName: "Rita", text }),
    )
  ).runId;
const stored = async (runId: string) =>
  (await withTenant(db, tenantId, (tx) => tx.select().from(runs).where(eq(runs.id, runId))))[0]!;

describe("robust runs", () => {
  it("finishes normally even if live events cannot be published (Redis down)", async () => {
    const runId = await run("Hallo");
    const result = await processAgentRun(
      { runId, tenantId },
      {
        db,
        provider: provider(scriptedClient([textResponse("Grüß Gott!")])),
        publish: async () => {
          throw new Error("Redis is down");
        },
        platformName: "X",
        log,
        microsoft: null,
      },
    );
    expect(result.status).toBe("completed");
    expect(await stored(runId)).toMatchObject({ status: "completed", finalText: "Grüß Gott!" });
  });

  it("gives up with a clear message when the model stops responding", async () => {
    const hanging = {
      beta: {
        messages: {
          stream(_params: unknown, options?: { signal?: AbortSignal }) {
            return {
              on() {
                return this;
              },
              finalMessage: () =>
                new Promise((_, reject) =>
                  options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
                ),
            };
          },
        },
      },
    };
    const runId = await run("Bitte antworten");
    const result = await processAgentRun(
      { runId, tenantId },
      {
        db,
        provider: provider(hanging),
        publish: async () => {},
        platformName: "X",
        log,
        microsoft: null,
        idleTimeoutMs: 200,
      },
    );
    expect(result.status).toBe("failed");
    expect(await stored(runId)).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/zu lange nicht geantwortet/),
    });
  });
});
