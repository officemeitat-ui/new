import { clearGraphTokenCache } from "@nexus/connectors";
import {
  MOCK_DRIVE_ID,
  MOCK_SITE_ID,
  startMockMicrosoft,
  type MockMicrosoft,
} from "@nexus/connectors/testing";
import { createLogger } from "@nexus/core/logger";
import { eq, withSystem, withTenant } from "@nexus/db";
import {
  authUser,
  knowledgeDocuments,
  knowledgeSources,
  partners,
  tenants,
} from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import {
  claimSync,
  connectMicrosoft365,
  connectSharePointLibrary,
  createCollection,
  findSharePointLibraries,
  findSharePointSites,
  searchKnowledge,
  type MicrosoftAppConfig,
} from "@nexus/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processKnowledgeIngest } from "../src/jobs/knowledge-ingest";
import { processKnowledgeSync } from "../src/jobs/knowledge-sync";

const handle = openTestDatabase();
const db = handle.db;
const log = createLogger("test");
let mock: MockMicrosoft;
let microsoft: MicrosoftAppConfig;
let tenantId: string;
let userId: string;
let sourceId: string;
let collectionId: string;

const docs = () =>
  withTenant(db, tenantId, (tx) =>
    tx.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.collectionId, collectionId)),
  );

/** Runs a sync and the ingest jobs it queued, like the worker does. */
async function sync() {
  const queued: string[] = [];
  const result = await processKnowledgeSync(
    { sourceId, tenantId },
    { db, log, microsoft, enqueueIngest: async (job) => void queued.push(job.documentId) },
  );
  for (const documentId of queued)
    await processKnowledgeIngest({ documentId, tenantId }, { db, log });
  return result;
}

const hook = (path: string, body: unknown) =>
  fetch(`${mock.url}${path}`, { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  mock = await startMockMicrosoft({
    directoryId: "a2000000-0000-4000-8000-000000000002",
    clientSecret: "geheim",
    pageSize: 2,
  });
  microsoft = {
    clientId: "app",
    clientSecret: "geheim",
    loginUrl: mock.loginUrl,
    graphUrl: mock.graphUrl,
  };
  clearGraphTokenCache();
  const tag = Math.random().toString(36).slice(2, 8);
  await withSystem(db, "test: sharepoint fixture", async (tx) => {
    const [partner] = await tx
      .insert(partners)
      .values({ name: "P", slug: `p-${tag}` })
      .returning();
    const [tenant] = await tx
      .insert(tenants)
      .values({ partnerId: partner!.id, name: "Contoso", slug: `s-${tag}` })
      .returning();
    const [user] = await tx
      .insert(authUser)
      .values({ name: "Sara", email: `sara-${tag}@example.test` })
      .returning();
    tenantId = tenant!.id;
    userId = user!.id;
  });
  await connectMicrosoft365(db, {
    tenantId,
    directoryTenantId: mock.directoryId,
    actorId: userId,
    config: microsoft,
  });
  collectionId = (
    await withTenant(db, tenantId, (tx) =>
      createCollection(tx, { tenantId, name: "Objektwissen", actorId: userId }),
    )
  ).id;
});
afterAll(async () => {
  await mock.close();
  await handle.close();
});

describe("SharePoint sync", () => {
  it("finds the site and its document library", async () => {
    const sites = await findSharePointSites(db, tenantId, "team", microsoft);
    expect(sites).toEqual([
      {
        id: MOCK_SITE_ID,
        name: "Contoso Team",
        webUrl: "https://contoso.sharepoint.com/sites/team",
      },
    ]);
    const libraries = await findSharePointLibraries(db, tenantId, MOCK_SITE_ID, microsoft);
    expect(libraries[0]).toMatchObject({ id: MOCK_DRIVE_ID, name: "Dokumente" });
    const source = await withTenant(db, tenantId, (tx) =>
      connectSharePointLibrary(tx, {
        tenantId,
        collectionId,
        site: sites[0]!,
        library: libraries[0]!,
        actorId: userId,
      }),
    );
    sourceId = source.id;
  });

  it("imports supported files on the first run, across pages, and skips the rest", async () => {
    const result = await sync();
    expect(result).toMatchObject({ status: "done", imported: 2, skipped: 2, failed: 0 });
    const list = await docs();
    expect(list.map((d) => d.title).sort()).toEqual(["Hausordnung", "Reinigungsplan Büro"]);
    expect(
      list.every((d) => d.status === "ready" && d.sourceUrl?.startsWith("https://contoso")),
    ).toBe(true);
    const [source] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)),
    );
    expect(source).toMatchObject({ status: "idle", itemsImported: 2, itemsSkipped: 2 });
    expect(source?.deltaLink).toContain("token=");
    const hits = await withTenant(db, tenantId, (tx) =>
      searchKnowledge(tx, { tenantId, query: "Sanitärräume desinfiziert" }),
    );
    expect(hits[0]?.documentTitle).toBe("Reinigungsplan Büro");
  });

  it("fetches only changes afterwards: nothing, then one changed, one new and one deleted file", async () => {
    mock.calls.length = 0;
    expect(await sync()).toMatchObject({ imported: 0, removed: 0 });
    expect(mock.calls.some((c) => c.path.startsWith("download/"))).toBe(false);

    await hook("/__sharepoint/upsert", {
      name: "Hausordnung.txt",
      content: "Neue Notfallnummer: 0800 999 000.",
    });
    await hook("/__sharepoint/upsert", {
      name: "Glasreinigung.md",
      content: "Glasflächen werden quartalsweise gereinigt.",
    });
    await hook("/__sharepoint/delete", { name: "Reinigungsplan Büro.md" });
    expect(await sync()).toMatchObject({ imported: 2, removed: 1 });
    const list = await docs();
    expect(list.map((d) => d.title).sort()).toEqual(["Glasreinigung", "Hausordnung"]);
    const hits = await withTenant(db, tenantId, (tx) =>
      searchKnowledge(tx, { tenantId, query: "Notfallnummer" }),
    );
    expect(hits[0]?.text).toContain("0800 999 000");
  });

  it("starts over when Microsoft expired the stored state (410) and reconciles", async () => {
    await hook("/__sharepoint/expire", {});
    const result = await sync();
    expect(result).toMatchObject({ status: "done", restarted: true, imported: 0 });
    expect((await docs()).map((d) => d.title).sort()).toEqual(["Glasreinigung", "Hausordnung"]);
  });

  it("never runs twice at the same time, but takes over a crashed sync", async () => {
    expect(await claimSync(db, tenantId, sourceId)).toBe(true);
    expect(await sync()).toMatchObject({ status: "skipped" });
    const later = new Date(Date.now() + 31 * 60_000);
    expect(await claimSync(db, tenantId, sourceId, later)).toBe(true);
    await withTenant(db, tenantId, (tx) =>
      tx.update(knowledgeSources).set({ status: "idle" }).where(eq(knowledgeSources.id, sourceId)),
    );
  });
});
