import { withTenant } from "@nexus/db";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentFromTemplate } from "../src/agents";
import { agentProfile, getProcessingRegister, listSubprocessors } from "../src/compliance";
import { createCollection } from "../src/knowledge";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

const base = {
  instructions: "Sie helfen dem Team bei IT-Fragen und Geräten.",
  tier: "balanced",
  effort: "medium",
  maxSteps: 8,
};

describe("agent profile", () => {
  it("derives oversight, risks and data from the configuration", () => {
    const profile = agentProfile({
      config: {
        ...base,
        tools: [
          { name: "wissen_suchen", mode: "auto" },
          { name: "email_senden", mode: "approve" },
          { name: "geraet_synchronisieren", mode: "auto" },
          { name: "geraet_sperren", mode: "approve" },
          { name: "rechner", mode: "deny" },
        ],
        knowledgeCollectionIds: ["c2"],
      },
      collections: [
        { id: "c1", name: "Preise" },
        { id: "c2", name: "IT-Handbuch" },
      ],
      chatRetentionDays: 90,
      microsoftConnected: false,
      label: (name) => `«${name}»`,
    });
    expect(profile.model).toBe("Claude Sonnet 5.5");
    expect(profile.tools.map((t) => t.name)).not.toContain("rechner");
    expect(profile.knowledge).toEqual(["IT-Handbuch"]);
    expect(profile.oversight).toEqual(["email_senden", "geraet_sperren"]);
    expect(profile.tools.find((t) => t.name === "geraet_sperren")).toMatchObject({
      unavailable: true,
    });
    expect(profile.risks.map((r) => r.text)).toContainEqual(
      expect.stringContaining(
        "«email_senden»: sendet Daten an Dritte außerhalb der Firma – nur nach Freigabe",
      ),
    );
    // Device tools without a connection cannot act, so they are no risk yet.
    expect(profile.risks.some((r) => r.text.includes("geraet"))).toBe(false);
    expect(profile.logging.chatRetentionDays).toBe(90);
  });

  it("flags tools that act without approval", () => {
    const profile = agentProfile({
      config: { ...base, tools: [{ name: "email_senden", mode: "auto" }] },
      collections: [],
      chatRetentionDays: null,
      microsoftConnected: true,
    });
    expect(profile.risks[0]).toMatchObject({
      level: "danger",
      text: expect.stringContaining("ohne Freigabe"),
    });
  });
});

describe("processing register", () => {
  it("lists platform activities, one per agent, and the subprocessors", async () => {
    const tenantId = fx.tenant.id;
    await withTenant(db, tenantId, async (tx) => {
      await createAgentFromTemplate(tx, {
        tenantId,
        templateId: "posteingang",
        tenantName: "Huber",
        actorId: fx.owner.id,
      });
      await createCollection(tx, { tenantId, name: "AGB", actorId: fx.owner.id });
    });
    const register = await withTenant(db, tenantId, (tx) => getProcessingRegister(tx, tenantId));
    const titles = register.activities.map((a) => a.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Benutzerkonten und Zugriffsverwaltung",
        "Audit-Log",
        "Wissensdatenbank",
      ]),
    );
    const agent = register.activities.find((a) => a.title.includes("Posteingangs-Manager"))!;
    expect(agent.data).toContain("E-Mail-Adressen von Empfängern");
    expect(agent.recipients).toContain("Empfänger freigegebener E-Mails");
    expect(titles.some((t) => t.includes("Intune"))).toBe(false);
    expect(register.subprocessors).toEqual(listSubprocessors());
    expect(register.subprocessors[1]?.name).toMatch(/Anthropic|Bedrock|Vertex/);
  });
});
