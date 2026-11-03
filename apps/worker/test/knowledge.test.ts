import { readFileSync } from "node:fs";
import { CAPABILITIES, type LlmProvider } from "@nexus/agents";
import { scriptedClient, textResponse, toolUseResponse } from "@nexus/agents/testing";
import { createLogger } from "@nexus/core/logger";
import { eq, withSystem, withTenant } from "@nexus/db";
import { authUser, knowledgeDocuments, partners, tenants } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import {
  addDocument,
  createBlankAgent,
  createCollection,
  getAgentDetail,
  getDocument,
  saveAgentVersion,
  startRun,
} from "@nexus/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processAgentRun } from "../src/jobs/agent-run";
import { processKnowledgeIngest } from "../src/jobs/knowledge-ingest";

const handle = openTestDatabase();
const db = handle.db;
const log = createLogger("test");
let tenantId: string;
let userId: string;
let collectionId: string;

const pdf = new Uint8Array(
  readFileSync(
    new URL("../../../packages/knowledge/test/fixtures/preisliste.pdf", import.meta.url),
  ),
);

beforeAll(async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  await withSystem(db, "test: knowledge fixture", async (tx) => {
    const [partner] = await tx
      .insert(partners)
      .values({ name: "P", slug: `p-${tag}` })
      .returning();
    const [tenant] = await tx
      .insert(tenants)
      .values({ partnerId: partner!.id, name: "Huber Haustechnik GmbH", slug: `k-${tag}` })
      .returning();
    const [user] = await tx
      .insert(authUser)
      .values({ name: "Karl", email: `karl-${tag}@example.test` })
      .returning();
    tenantId = tenant!.id;
    userId = user!.id;
  });
  collectionId = (
    await withTenant(db, tenantId, (tx) =>
      createCollection(tx, { tenantId, name: "Preise", actorId: userId }),
    )
  ).id;
});
afterAll(() => handle.close());

const upload = (fileName: string, bytes: Uint8Array) =>
  withTenant(db, tenantId, (tx) =>
    addDocument(tx, { tenantId, collectionId, fileName, bytes, actorId: userId }),
  );

describe("knowledge ingest", () => {
  it("indexes a PDF with page numbers", async () => {
    const { documentId } = await upload("Preisliste_2026.pdf", pdf);
    const result = await processKnowledgeIngest({ documentId, tenantId }, { db, log });
    expect(result).toMatchObject({ status: "ready" });

    const document = await withTenant(db, tenantId, (tx) => getDocument(tx, tenantId, documentId));
    expect(document).toMatchObject({ status: "ready", pageCount: 2, title: "Preisliste 2026" });
    expect(document.chunks.map((c) => c.page)).toEqual([1, 2]);
    expect(document.chunks[1]!.text).toContain("Skonto");
  });

  it("marks unreadable files as failed with a message for the user", async () => {
    const broken = new TextEncoder().encode("%PDF-1.4 das ist kein echtes PDF");
    const { documentId } = await upload("kaputt.pdf", broken);
    const result = await processKnowledgeIngest({ documentId, tenantId }, { db, log });
    expect(result).toEqual({ status: "failed", error: "Das PDF konnte nicht gelesen werden." });
    const [row] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId)),
    );
    expect(row).toMatchObject({ status: "failed", error: "Das PDF konnte nicht gelesen werden." });
  });

  it("lets an agent answer from the documents of its collection", async () => {
    const agent = await withTenant(db, tenantId, (tx) =>
      createBlankAgent(tx, { tenantId, actorId: userId, name: "Wissen" }),
    );
    const { current } = await withTenant(db, tenantId, (tx) =>
      getAgentDetail(tx, tenantId, agent.id),
    );
    await withTenant(db, tenantId, (tx) =>
      saveAgentVersion(tx, {
        tenantId,
        agentId: agent.id,
        name: "Wissen",
        description: null,
        config: {
          ...current.config,
          tools: [{ name: "wissen_suchen", mode: "auto" }],
          knowledgeCollectionIds: [collectionId],
        },
        actorId: userId,
      }),
    );
    const { runId } = await withTenant(db, tenantId, (tx) =>
      startRun(tx, {
        tenantId,
        userId,
        userName: "Karl",
        text: "Gibt es Skonto?",
        agentId: agent.id,
      }),
    );
    const client = scriptedClient([
      toolUseResponse([{ id: "k1", name: "wissen_suchen", input: { anfrage: "Skonto" } }]),
      textResponse("Ja, 2 % Skonto bei Zahlung binnen 7 Tagen [Preisliste 2026, S. 2]."),
    ]);
    const provider: LlmProvider = {
      name: "anthropic",
      client,
      capabilities: CAPABILITIES.anthropic,
      modelId: (m) => m,
    };
    const result = await processAgentRun(
      { runId, tenantId },
      { db, provider: async () => provider, publish: async () => {}, platformName: "X", log },
    );
    expect(result.status).toBe("completed");
    // The tool is offered, and its result carries the source with the page.
    expect(client.requests[0]!.tools?.map((t) => ("name" in t ? t.name : ""))).toContain(
      "wissen_suchen",
    );
    const toolResult = client.requests[1]!.messages.at(-1)!.content as { content: string }[];
    const output = JSON.parse(toolResult[0]!.content) as {
      treffer: { quelle: string; seite: number }[];
    };
    expect(output.treffer[0]).toMatchObject({ quelle: "Preisliste 2026, S. 2", seite: 2 });
  });
});
