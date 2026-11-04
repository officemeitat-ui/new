import {
  MOCK_ATERA_KEY,
  MOCK_BOOKSTACK_TOKEN,
  startMockTools,
  type MockTools,
} from "@nexus/connectors/testing/tools";
import { createLogger } from "@nexus/core/logger";
import { eq, withSystem, withTenant } from "@nexus/db";
import {
  authUser,
  knowledgeDocuments,
  knowledgeFiles,
  knowledgeSources,
  partners,
  tenants,
} from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import {
  connectAtera,
  connectBookStack,
  createCollection,
  maskPersonalData,
  searchKnowledge,
  type ConnectorEnv,
} from "@nexus/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processKnowledgeIngest } from "../src/jobs/knowledge-ingest";
import { processKnowledgeSync } from "../src/jobs/knowledge-sync";

const handle = openTestDatabase();
const db = handle.db;
const log = createLogger("test");
let mock: MockTools;
let env: ConnectorEnv;
let tenantId: string;
let userId: string;

const newCollection = async (name: string) =>
  (
    await withTenant(db, tenantId, (tx) =>
      createCollection(tx, { tenantId, name, actorId: userId }),
    )
  ).id;

const docs = (collectionId: string) =>
  withTenant(db, tenantId, (tx) =>
    tx.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.collectionId, collectionId)),
  );

/** Runs a sync and the ingest jobs it queued, like the worker does. */
async function sync(sourceId: string) {
  const queued: string[] = [];
  const result = await processKnowledgeSync(
    { sourceId, tenantId },
    {
      db,
      log,
      connectors: env,
      enqueueIngest: async (job) => void queued.push(job.documentId),
    },
  );
  for (const documentId of queued)
    await processKnowledgeIngest({ documentId, tenantId }, { db, log });
  return result;
}

const search = (query: string, collectionId: string) =>
  withTenant(db, tenantId, (tx) =>
    searchKnowledge(tx, { tenantId, query, collectionIds: [collectionId] }),
  );

beforeAll(async () => {
  mock = await startMockTools({ pageSize: 2 });
  env = { allowPrivate: true, ateraUrl: mock.ateraUrl };
  const tag = Math.random().toString(36).slice(2, 8);
  await withSystem(db, "test: connector fixture", async (tx) => {
    const [partner] = await tx
      .insert(partners)
      .values({ name: "P", slug: `p-${tag}` })
      .returning();
    const [tenant] = await tx
      .insert(tenants)
      .values({ partnerId: partner!.id, name: "ME-IT intern", slug: `m-${tag}` })
      .returning();
    const [user] = await tx
      .insert(authUser)
      .values({ name: "Michi", email: `michi-${tag}@example.test` })
      .returning();
    tenantId = tenant!.id;
    userId = user!.id;
  });
});
afterAll(async () => {
  await mock.close();
  await handle.close();
});

describe("BookStack sync", () => {
  it("refuses wrong tokens and internal addresses before saving anything", async () => {
    const collectionId = await newCollection("Doku Test");
    await expect(
      connectBookStack(db, {
        tenantId,
        collectionId,
        baseUrl: mock.bookstackUrl,
        tokenId: MOCK_BOOKSTACK_TOKEN.id,
        tokenSecret: "falsch",
        actorId: userId,
        env,
      }),
    ).rejects.toThrow("BookStack hat die Zugangsdaten abgelehnt.");
    await expect(
      connectBookStack(db, {
        tenantId,
        collectionId,
        baseUrl: mock.bookstackUrl,
        tokenId: MOCK_BOOKSTACK_TOKEN.id,
        tokenSecret: MOCK_BOOKSTACK_TOKEN.secret,
        actorId: userId,
        env: { ...env, allowPrivate: false },
      }),
    ).rejects.toThrow(/https/);
    const sources = await withTenant(db, tenantId, (tx) =>
      tx.select().from(knowledgeSources).where(eq(knowledgeSources.collectionId, collectionId)),
    );
    expect(sources).toEqual([]);
  });

  it("mirrors published pages, keeps the token encrypted and follows changes and deletions", async () => {
    const collectionId = await newCollection("Doku");
    const source = await connectBookStack(db, {
      tenantId,
      collectionId,
      baseUrl: `${mock.bookstackUrl}/api/`,
      tokenId: MOCK_BOOKSTACK_TOKEN.id,
      tokenSecret: MOCK_BOOKSTACK_TOKEN.secret,
      actorId: userId,
      env,
    });
    expect(source.secret).toMatch(/^v1:/);
    expect(source.secret).not.toContain(MOCK_BOOKSTACK_TOKEN.secret);
    expect(source.settings).toEqual({ baseUrl: mock.bookstackUrl });

    const first = await sync(source.id);
    expect(first).toMatchObject({ status: "done", provider: "bookstack", imported: 2, seen: 2 });
    const imported = await docs(collectionId);
    expect(imported.map((d) => d.title).sort()).toEqual([
      "Clients – Lenovo Docking Station",
      "Firewalls – Securepoint Firmware-Update",
    ]);
    expect(imported.every((d) => d.status === "ready")).toBe(true);
    expect(imported.find((d) => d.title.includes("Lenovo"))!.sourceUrl).toBe(
      `${mock.bookstackUrl}/books/clients/page/lenovo-docking-station`,
    );
    const [hit] = await search("Docking Monitore flackern", collectionId);
    expect(hit?.text).toContain("Lenovo Vantage");

    // Nothing changed: nothing is downloaded again.
    const exportsBefore = mock.calls.filter((c) => c.path.includes("/export/")).length;
    expect(await sync(source.id)).toMatchObject({ imported: 0 });
    expect(mock.calls.filter((c) => c.path.includes("/export/")).length).toBe(exportsBefore);

    // A changed page is updated, a deleted one removed.
    await fetch(`${mock.url}/__bookstack/page`, {
      method: "POST",
      body: JSON.stringify({
        id: 11,
        markdown: "# Securepoint\n\nNeu: Update immer mit Wartungsfenster ankündigen.",
      }),
    });
    await fetch(`${mock.url}/__bookstack/page?id=12`, { method: "DELETE" });
    expect(await sync(source.id)).toMatchObject({ imported: 1, removed: 1 });
    const after = await docs(collectionId);
    expect(after).toHaveLength(1);
    const [file] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(knowledgeFiles).where(eq(knowledgeFiles.documentId, after[0]!.id)),
    );
    expect(Buffer.from(file!.content).toString("utf8")).toContain("Wartungsfenster");
    await fetch(`${mock.url}/__reset`, { method: "POST" });
  });
});

describe("Atera sync", () => {
  it("takes over solved and closed tickets without contact data", async () => {
    const collectionId = await newCollection("Tickets");
    await expect(
      connectAtera(db, {
        tenantId,
        collectionId,
        apiKey: "falscher-schluessel",
        monthsBack: 12,
        actorId: userId,
        env,
      }),
    ).rejects.toThrow("Atera hat die Zugangsdaten abgelehnt.");
    const source = await connectAtera(db, {
      tenantId,
      collectionId,
      apiKey: MOCK_ATERA_KEY,
      monthsBack: 12,
      actorId: userId,
      env,
    });
    expect(source.secret).not.toContain(MOCK_ATERA_KEY);

    const result = await sync(source.id);
    // Two solved/closed tickets; the open one stays out.
    expect(result).toMatchObject({ status: "done", provider: "atera", imported: 2 });
    const tickets = await docs(collectionId);
    expect(tickets.map((d) => d.title).sort()).toEqual([
      "Ticket 1042: HP-Drucker druckt nur leere Seiten",
      "Ticket 1043: ESET PROTECT meldet veralteten Agent",
    ]);
    const printer = tickets.find((d) => d.title.includes("HP"))!;
    const [file] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(knowledgeFiles).where(eq(knowledgeFiles.documentId, printer.id)),
    );
    const text = Buffer.from(file!.content).toString("utf8");
    expect(text).toContain("Kunde: Bäckerei Müller KG · Art: Problem · Status: Resolved");
    expect(text).toContain("Interne Notiz (Technik)");
    expect(text).toContain("Schutzstreifen am neuen Toner");
    expect(text).not.toContain("anna.muster@baeckerei.example");
    expect(text).not.toContain("0664 123 45 67");
    expect(text).toContain("[E-Mail]");

    const [hit] = await search("Drucker leere Seiten Toner", collectionId);
    expect(hit?.text).toContain("Schutzstreifen");

    // Unchanged tickets are not fetched again.
    const before = mock.calls.filter((c) => c.path.endsWith("/comments")).length;
    expect(await sync(source.id)).toMatchObject({ imported: 0 });
    expect(mock.calls.filter((c) => c.path.endsWith("/comments")).length).toBe(before);
  });

  it("masks contact data but keeps dates and ticket numbers", () => {
    const masked = maskPersonalData(
      "Rückruf an max@firma.at oder +43 664 1234567, IBAN AT61 1904 3002 3457 3201.<br>Termin 2026-11-04, Ticket 1042.",
    );
    expect(masked).toBe(
      "Rückruf an [E-Mail] oder [Telefon], IBAN [IBAN].\nTermin 2026-11-04, Ticket 1042.",
    );
  });
});
