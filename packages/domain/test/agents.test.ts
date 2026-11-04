import { ALWAYS_APPROVE, catalogTool } from "@nexus/agents";
import { withTenant } from "@nexus/db";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_TEMPLATES } from "../src/agent-templates";
import {
  createAgentFromTemplate,
  createBlankAgent,
  getAgentDetail,
  instantiateInstructions,
  listAgents,
  openPlaceholders,
  restoreAgentVersion,
  saveAgentVersion,
  setAgentStatus,
} from "../src/agents";
import { listAuditEntries } from "../src/audit";
import { ensureDefaultAgent, startRun } from "../src/chat";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("agent templates", () => {
  it("contains the fifteen library agents with prompts and test cases", () => {
    expect(AGENT_TEMPLATES).toHaveLength(15);
    for (const template of AGENT_TEMPLATES) {
      expect(template.instructions.length).toBeGreaterThan(300);
      expect(template.testCases.length).toBeGreaterThanOrEqual(3);
      expect(template.roiMinutesPerTask).toBeGreaterThan(0);
      expect(template.industries.length).toBeGreaterThan(0);
    }
  });

  it("only uses tools from the catalog, and never runs risky ones without approval", () => {
    for (const template of AGENT_TEMPLATES) {
      for (const tool of template.tools) {
        const entry = catalogTool(tool.name);
        expect(entry, `${template.id}: ${tool.name}`).toBeDefined();
        if (ALWAYS_APPROVE.has(entry!.risk)) expect(tool.mode).not.toBe("auto");
      }
    }
  });

  it("fills in the company name and defaults, and keeps the rest for the customer", () => {
    const offers = AGENT_TEMPLATES.find((t) => t.id === "angebote")!;
    const text = instantiateInstructions(offers, "Huber Haustechnik GmbH");
    expect(text).toContain("Huber Haustechnik GmbH");
    expect(text).toContain("USt (20 %)");
    expect(openPlaceholders(text).sort()).toEqual(["angebotsvorlage", "rabattregeln"]);
  });
});

describe("agent studio", () => {
  it("creates an agent from a template, versions every change and can roll back", async () => {
    const agent = await withTenant(db, fx.tenant.id, (tx) =>
      createAgentFromTemplate(tx, {
        tenantId: fx.tenant.id,
        templateId: "angebote",
        tenantName: "Huber",
        actorId: fx.owner.id,
      }),
    );
    const first = await withTenant(db, fx.tenant.id, (tx) =>
      getAgentDetail(tx, fx.tenant.id, agent.id),
    );
    expect(first.current.version).toBe(1);
    expect(first.current.config.tier).toBe("smart");
    expect(first.current.config.tools).toContainEqual({ name: "email_senden", mode: "approve" });

    await withTenant(db, fx.tenant.id, (tx) =>
      saveAgentVersion(tx, {
        tenantId: fx.tenant.id,
        agentId: agent.id,
        name: "Angebote Wärmepumpen",
        description: "Nur Wärmepumpen",
        config: { ...first.current.config, tier: "balanced", effort: "low" },
        actorId: fx.owner.id,
      }),
    );
    const second = await withTenant(db, fx.tenant.id, (tx) =>
      getAgentDetail(tx, fx.tenant.id, agent.id),
    );
    expect(second.current.version).toBe(2);
    expect(second.agent.name).toBe("Angebote Wärmepumpen");
    expect(second.versions.map((v) => v.version)).toEqual([2, 1]);

    await withTenant(db, fx.tenant.id, (tx) =>
      restoreAgentVersion(tx, {
        tenantId: fx.tenant.id,
        agentId: agent.id,
        versionId: first.current.id,
        actorId: fx.owner.id,
      }),
    );
    const third = await withTenant(db, fx.tenant.id, (tx) =>
      getAgentDetail(tx, fx.tenant.id, agent.id),
    );
    expect(third.current.version).toBe(3);
    expect(third.current.config.tier).toBe("smart");

    const actions = (
      await withTenant(db, fx.tenant.id, (tx) => listAuditEntries(tx, fx.tenant.id))
    ).map((e) => e.action);
    expect(actions.filter((a) => a === "agent.published")).toHaveLength(2);
    expect(actions).toContain("agent.created");
  });

  it("validates the configuration", async () => {
    const agent = await withTenant(db, fx.tenant.id, (tx) =>
      createBlankAgent(tx, { tenantId: fx.tenant.id, actorId: fx.owner.id, name: "Test" }),
    );
    const { current } = await withTenant(db, fx.tenant.id, (tx) =>
      getAgentDetail(tx, fx.tenant.id, agent.id),
    );
    const save = (config: unknown) =>
      withTenant(db, fx.tenant.id, (tx) =>
        saveAgentVersion(tx, {
          tenantId: fx.tenant.id,
          agentId: agent.id,
          name: "Test",
          description: null,
          config,
          actorId: fx.owner.id,
        }),
      );
    await expect(save({ ...current.config, instructions: "kurz" })).rejects.toThrow(/zu kurz/);
    await expect(
      save({ ...current.config, tools: [{ name: "rm_rf", mode: "auto" }] }),
    ).rejects.toThrow(/Unbekanntes Werkzeug/);
    await expect(save({ ...current.config, maxSteps: 500 })).rejects.toThrow(/Höchstens 50/);
  });

  it("archives agents, but never the default assistant", async () => {
    const assistant = await withTenant(db, fx.tenant.id, (tx) =>
      ensureDefaultAgent(tx, fx.tenant.id, fx.owner.id),
    );
    await expect(
      withTenant(db, fx.tenant.id, (tx) =>
        setAgentStatus(tx, {
          tenantId: fx.tenant.id,
          agentId: assistant.id,
          status: "archived",
          actorId: fx.owner.id,
        }),
      ),
    ).rejects.toThrow(/Standard-Assistent/);

    const agent = await withTenant(db, fx.tenant.id, (tx) =>
      createAgentFromTemplate(tx, {
        tenantId: fx.tenant.id,
        templateId: "firmenwissen",
        tenantName: "Huber",
        actorId: fx.owner.id,
      }),
    );
    await withTenant(db, fx.tenant.id, (tx) =>
      setAgentStatus(tx, {
        tenantId: fx.tenant.id,
        agentId: agent.id,
        status: "archived",
        actorId: fx.owner.id,
      }),
    );
    const active = await withTenant(db, fx.tenant.id, (tx) => listAgents(tx, fx.tenant.id));
    expect(active.some((a) => a.id === agent.id)).toBe(false);
    expect(active[0]?.isDefault).toBe(true);

    // Archived agents cannot start new conversations.
    await expect(
      withTenant(db, fx.tenant.id, (tx) =>
        startRun(tx, {
          tenantId: fx.tenant.id,
          userId: fx.owner.id,
          userName: "O",
          text: "Hallo",
          agentId: agent.id,
        }),
      ),
    ).rejects.toThrow(/Agent nicht gefunden/);
  });

  it("starts a conversation with the chosen agent", async () => {
    const agent = await withTenant(db, fx.tenant.id, (tx) =>
      createAgentFromTemplate(tx, {
        tenantId: fx.tenant.id,
        templateId: "vertraege",
        tenantName: "Huber",
        actorId: fx.owner.id,
      }),
    );
    const { runId } = await withTenant(db, fx.tenant.id, (tx) =>
      startRun(tx, {
        tenantId: fx.tenant.id,
        userId: fx.owner.id,
        userName: "O",
        text: "Prüfe den Vertrag",
        agentId: agent.id,
      }),
    );
    const listed = await withTenant(db, fx.tenant.id, (tx) => listAgents(tx, fx.tenant.id));
    expect(listed.find((a) => a.id === agent.id)?.runs30d).toBe(1);
    expect(runId).toBeTruthy();
  });
});
