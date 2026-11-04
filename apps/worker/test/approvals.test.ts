import { CAPABILITIES, type LlmProvider } from "@nexus/agents";
import { scriptedClient, textResponse, toolUseResponse } from "@nexus/agents/testing";
import { createLogger } from "@nexus/core/logger";
import { eq, withSystem, withTenant } from "@nexus/db";
import { authUser, partners, runs, tenants } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import {
  countPendingApprovals,
  createBlankAgent,
  decideApproval,
  getAgentDetail,
  listApprovals,
  saveAgentVersion,
  startRun,
} from "@nexus/domain";
import { SMTPServer } from "smtp-server";
import { SYSTEM_TENANT_ROLE_PERMISSIONS } from "@nexus/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processAgentRun } from "../src/jobs/agent-run";

const OWNER = SYSTEM_TENANT_ROLE_PERMISSIONS.owner;
const handle = openTestDatabase();
const db = handle.db;
const log = createLogger("test");
const received: string[] = [];
let tenantId: string;
let userId: string;
let agentId: string;

// A real SMTP endpoint, so the e-mail tool runs exactly as in production.
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, _session, callback) {
    let data = "";
    stream.on("data", (chunk: Buffer) => (data += chunk.toString()));
    stream.on("end", () => {
      received.push(data);
      callback();
    });
  },
});

beforeAll(async () => {
  await new Promise<void>((resolve) => smtp.listen(2626, "127.0.0.1", resolve));
  const tag = Math.random().toString(36).slice(2, 8);
  await withSystem(db, "test: approvals fixture", async (tx) => {
    const [partner] = await tx
      .insert(partners)
      .values({ name: "P", slug: `p-${tag}` })
      .returning();
    const [tenant] = await tx
      .insert(tenants)
      .values({ partnerId: partner!.id, name: "Huber Haustechnik GmbH", slug: `h-${tag}` })
      .returning();
    const [user] = await tx
      .insert(authUser)
      .values({ name: "Anna", email: `anna-${tag}@example.test` })
      .returning();
    tenantId = tenant!.id;
    userId = user!.id;
  });
  const agent = await withTenant(db, tenantId, (tx) =>
    createBlankAgent(tx, { tenantId, actorId: userId, name: "Post" }),
  );
  const { current } = await withTenant(db, tenantId, (tx) =>
    getAgentDetail(tx, tenantId, agent.id),
  );
  await withTenant(db, tenantId, (tx) =>
    saveAgentVersion(tx, {
      tenantId,
      agentId: agent.id,
      name: "Post",
      description: null,
      config: { ...current.config, tools: [{ name: "email_senden", mode: "approve" }] },
      actorId: userId,
    }),
  );
  agentId = agent.id;
});
afterAll(async () => {
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
  await handle.close();
});

function provider(script: Parameters<typeof scriptedClient>[0]) {
  const client = scriptedClient(script);
  const p: LlmProvider = {
    name: "anthropic",
    client,
    capabilities: CAPABILITIES.anthropic,
    modelId: (m) => m,
  };
  return { client, provider: async () => p };
}

const mail = {
  an: ["kunde@example.at"],
  betreff: "Terminbestätigung",
  text: "Sehr geehrte Frau Berger, …",
};
const deps = (p: () => Promise<LlmProvider>) => ({
  db,
  provider: p,
  publish: async () => {},
  platformName: "X",
  log,
});

describe("approval flow", () => {
  it("pauses before sending, sends the approved (edited) e-mail and continues", async () => {
    const { runId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId, userName: "Anna", text: "Bestätige den Termin", agentId }),
    );
    const first = provider([toolUseResponse([{ id: "m1", name: "email_senden", input: mail }])]);
    expect((await processAgentRun({ runId, tenantId }, deps(first.provider))).status).toBe(
      "awaiting_approval",
    );
    expect(received).toHaveLength(0);

    const [pending] = await withTenant(db, tenantId, (tx) =>
      listApprovals(tx, tenantId, "pending", { userId, all: true }),
    );
    expect(pending).toMatchObject({ toolName: "email_senden", agentName: "Post", input: mail });

    const decision = await withTenant(db, tenantId, (tx) =>
      decideApproval(tx, {
        tenantId,
        approvalId: pending!.id,
        approve: true,
        editedInput: { ...mail, betreff: "Ihr Termin am Dienstag" },
        actorId: userId,
        scope: { userId, all: true },
        permissions: OWNER,
      }),
    );
    expect(decision).toEqual({ runId, resume: true });

    const second = provider([textResponse("Die E-Mail ist versendet.")]);
    expect((await processAgentRun({ runId, tenantId }, deps(second.provider))).status).toBe(
      "completed",
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toContain("Subject: Ihr Termin am Dienstag");
    expect(received[0]).toContain("KI-Unterst");

    // The model got the tool result, and the run totals add up across both segments.
    const toolResult = second.client.requests[0]!.messages.at(-1)!.content as {
      content: string;
      is_error?: boolean;
    }[];
    expect(JSON.parse(toolResult[0]!.content)).toMatchObject({ gesendet: true });
    const [run] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(runs).where(eq(runs.id, runId)),
    );
    expect(run?.steps).toBe(2);
  });

  it("tells the agent when a person rejected the e-mail – and sends nothing", async () => {
    const before = received.length;
    const { runId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId, userName: "Anna", text: "Schreib dem Kunden", agentId }),
    );
    await processAgentRun(
      { runId, tenantId },
      deps(provider([toolUseResponse([{ id: "m2", name: "email_senden", input: mail }])]).provider),
    );
    const [pending] = await withTenant(db, tenantId, (tx) =>
      listApprovals(tx, tenantId, "pending", { userId, all: true }),
    );
    await withTenant(db, tenantId, (tx) =>
      decideApproval(tx, {
        tenantId,
        approvalId: pending!.id,
        approve: false,
        reason: "Falscher Empfänger",
        actorId: userId,
        scope: { userId, all: true },
        permissions: OWNER,
      }),
    );
    await expect(
      withTenant(db, tenantId, (tx) =>
        decideApproval(tx, {
          tenantId,
          approvalId: pending!.id,
          approve: true,
          actorId: userId,
          scope: { userId, all: true },
          permissions: OWNER,
        }),
      ),
    ).rejects.toThrow(/bereits entschieden/);

    const next = provider([textResponse("Verstanden, ich sende nichts.")]);
    await processAgentRun({ runId, tenantId }, deps(next.provider));
    const result = next.client.requests[0]!.messages.at(-1)!.content as {
      content: string;
      is_error?: boolean;
    }[];
    expect(result[0]).toMatchObject({ is_error: true });
    expect(result[0]!.content).toMatch(/Falscher Empfänger/);
    expect(received).toHaveLength(before);
  });

  it("shows members only their own approvals and blocks follow-ups until decided", async () => {
    const { runId, conversationId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId, userName: "Anna", text: "Sag dem Kunden ab", agentId }),
    );
    await processAgentRun(
      { runId, tenantId },
      deps(provider([toolUseResponse([{ id: "m3", name: "email_senden", input: mail }])]).provider),
    );

    await expect(
      withTenant(db, tenantId, (tx) =>
        startRun(tx, { tenantId, userId, userName: "Anna", text: "Und noch was", conversationId }),
      ),
    ).rejects.toThrow(/wartet auf eine Freigabe/);

    const colleague = { userId: crypto.randomUUID(), all: false };
    const own = { userId, all: false };
    const [mine, theirs] = await withTenant(db, tenantId, async (tx) => [
      await listApprovals(tx, tenantId, "pending", own),
      await listApprovals(tx, tenantId, "pending", colleague),
    ]);
    expect(mine.map((a) => a.runId)).toContain(runId);
    expect(theirs).toHaveLength(0);
    expect(
      await withTenant(db, tenantId, (tx) => countPendingApprovals(tx, tenantId, colleague)),
    ).toBe(0);

    const approvalId = mine.find((a) => a.runId === runId)!.id;
    await expect(
      withTenant(db, tenantId, (tx) =>
        decideApproval(tx, {
          tenantId,
          approvalId,
          approve: true,
          actorId: colleague.userId,
          scope: colleague,
          permissions: OWNER,
        }),
      ),
    ).rejects.toThrow(/nicht gefunden/);
  });
});
