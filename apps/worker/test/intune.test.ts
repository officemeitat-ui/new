import { CAPABILITIES, type LlmProvider } from "@nexus/agents";
import { scriptedClient, textResponse, toolUseResponse } from "@nexus/agents/testing";
import { clearGraphTokenCache } from "@nexus/connectors";
import { startMockMicrosoft, type MockMicrosoft } from "@nexus/connectors/testing";
import { createLogger } from "@nexus/core/logger";
import { withSystem, withTenant } from "@nexus/db";
import { authUser, memberships, partners, tenants } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import {
  connectMicrosoft365,
  createBlankAgent,
  decideApproval,
  getAgentDetail,
  listApprovals,
  saveAgentVersion,
  startRun,
  type MicrosoftAppConfig,
} from "@nexus/domain";
import { SYSTEM_TENANT_ROLE_PERMISSIONS } from "@nexus/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processAgentRun } from "../src/jobs/agent-run";

const OWNER = SYSTEM_TENANT_ROLE_PERMISSIONS.owner;
const handle = openTestDatabase();
const db = handle.db;
const log = createLogger("test");
let mock: MockMicrosoft;
let microsoft: MicrosoftAppConfig;
let tenantId: string;
let userId: string;
/** A member: may chat with agents, but may not see the company's devices. */
let memberId: string;
let agentId: string;
const GRUBER = "a1f0c2d4-0000-4000-8000-000000000002";

beforeAll(async () => {
  mock = await startMockMicrosoft({
    directoryId: "a2000000-0000-4000-8000-000000000001",
    clientSecret: "geheim",
  });
  microsoft = {
    clientId: "app",
    clientSecret: "geheim",
    loginUrl: mock.loginUrl,
    graphUrl: mock.graphUrl,
  };
  clearGraphTokenCache();
  const tag = Math.random().toString(36).slice(2, 8);
  await withSystem(db, "test: intune fixture", async (tx) => {
    const [partner] = await tx
      .insert(partners)
      .values({ name: "P", slug: `p-${tag}` })
      .returning();
    const [tenant] = await tx
      .insert(tenants)
      .values({ partnerId: partner!.id, name: "Contoso", slug: `i-${tag}` })
      .returning();
    const [user] = await tx
      .insert(authUser)
      .values({ name: "Ida", email: `ida-${tag}@example.test` })
      .returning();
    const [member] = await tx
      .insert(authUser)
      .values({ name: "Max", email: `max-${tag}@example.test` })
      .returning();
    tenantId = tenant!.id;
    userId = user!.id;
    memberId = member!.id;
    await tx.insert(memberships).values([
      { tenantId, userId, role: "admin" },
      { tenantId, userId: memberId, role: "member" },
    ]);
  });
  const agent = await withTenant(db, tenantId, (tx) =>
    createBlankAgent(tx, { tenantId, actorId: userId, name: "IT" }),
  );
  const { current } = await withTenant(db, tenantId, (tx) =>
    getAgentDetail(tx, tenantId, agent.id),
  );
  await withTenant(db, tenantId, (tx) =>
    saveAgentVersion(tx, {
      tenantId,
      agentId: agent.id,
      name: "IT",
      description: null,
      config: {
        ...current.config,
        tools: [
          { name: "geraete_suchen", mode: "auto" },
          { name: "geraet_sperren", mode: "approve" },
        ],
      },
      actorId: userId,
    }),
  );
  agentId = agent.id;
});
afterAll(async () => {
  await mock.close();
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
const deps = (p: () => Promise<LlmProvider>, config: MicrosoftAppConfig | null = microsoft) => ({
  db,
  provider: p,
  publish: async () => {},
  platformName: "X",
  log,
  microsoft: config,
});

describe("Intune tools", () => {
  it("are not offered without a Microsoft 365 connection", async () => {
    const { runId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId, userName: "Ida", text: "Geräte?", agentId }),
    );
    const run = provider([textResponse("Keine Geräteverwaltung verbunden.")]);
    await processAgentRun({ runId, tenantId }, deps(run.provider));
    expect(run.client.requests[0]!.tools ?? []).toHaveLength(0);
  });

  it("find a device and lock it only after a person approved it", async () => {
    await connectMicrosoft365(db, {
      tenantId,
      directoryTenantId: mock.directoryId,
      actorId: userId,
      config: microsoft,
    });
    const { runId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, {
        tenantId,
        userId,
        userName: "Ida",
        text: "Karls Laptop wurde gestohlen, sperren!",
        agentId,
      }),
    );
    const first = provider([
      toolUseResponse([
        { id: "s1", name: "geraete_suchen", input: { suche: "gruber", nur_probleme: false } },
      ]),
      toolUseResponse([
        {
          id: "l1",
          name: "geraet_sperren",
          input: { geraet_id: GRUBER, geraet_name: "LAPTOP-GRUBER-07" },
        },
      ]),
    ]);
    expect((await processAgentRun({ runId, tenantId }, deps(first.provider))).status).toBe(
      "awaiting_approval",
    );
    const search = JSON.parse(
      (first.client.requests[1]!.messages.at(-1)!.content as { content: string }[])[0]!.content,
    ) as { treffer: number; geraete: { name: string; probleme: string[] }[] };
    expect(search.treffer).toBe(1);
    expect(search.geraete[0]).toMatchObject({
      name: "LAPTOP-GRUBER-07",
      probleme: ["nicht_konform", "nicht_verschluesselt", "lange_nicht_synchronisiert"],
    });
    expect(mock.calls.some((c) => c.path.endsWith("/remoteLock"))).toBe(false);

    const [pending] = await withTenant(db, tenantId, (tx) =>
      listApprovals(tx, tenantId, "pending", { userId, all: true }),
    );
    expect(pending).toMatchObject({
      toolName: "geraet_sperren",
      input: { geraet_name: "LAPTOP-GRUBER-07" },
    });
    // A member may decide approvals, but not about device actions (finding 4).
    await expect(
      withTenant(db, tenantId, (tx) =>
        decideApproval(tx, {
          tenantId,
          approvalId: pending!.id,
          approve: true,
          actorId: userId,
          scope: { userId, all: true },
          permissions: SYSTEM_TENANT_ROLE_PERMISSIONS.member,
        }),
      ),
    ).rejects.toThrow(/Integrationen verwalten/);
    // Device actions cannot be edited before approval.
    await expect(
      withTenant(db, tenantId, (tx) =>
        decideApproval(tx, {
          tenantId,
          approvalId: pending!.id,
          approve: true,
          editedInput: {
            geraet_id: "a1f0c2d4-0000-4000-8000-000000000001",
            geraet_name: "LAPTOP-HUBER-01",
          },
          actorId: userId,
          scope: { userId, all: true },
          permissions: OWNER,
        }),
      ),
    ).rejects.toThrow(/nicht geändert/);
    await withTenant(db, tenantId, (tx) =>
      decideApproval(tx, {
        tenantId,
        approvalId: pending!.id,
        approve: true,
        actorId: userId,
        scope: { userId, all: true },
        permissions: OWNER,
      }),
    );
    const second = provider([textResponse("Das Gerät ist gesperrt.")]);
    expect((await processAgentRun({ runId, tenantId }, deps(second.provider))).status).toBe(
      "completed",
    );
    expect(
      mock.calls.filter((c) => c.path === `/deviceManagement/managedDevices/${GRUBER}/remoteLock`),
    ).toHaveLength(1);
  });
});

describe("Intune tools and the person a run works for", () => {
  it("are not offered to someone who may not see the devices (security review 2)", async () => {
    // The connection from the previous test is still there.
    const { runId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, { tenantId, userId: memberId, userName: "Max", text: "Geräte?", agentId }),
    );
    const run = provider([textResponse("Dazu habe ich keinen Zugriff.")]);
    await processAgentRun({ runId, tenantId }, deps(run.provider));
    const offered = (run.client.requests[0]!.tools ?? []).map(
      (tool) => (tool as { name: string }).name,
    );
    expect(offered.some((name) => name.startsWith("geraet"))).toBe(false);
  });
});
