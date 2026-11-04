import { eq, withTenant } from "@nexus/db";
import { knowledgeDocuments, knowledgeSources, runs } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startRun } from "../src/chat";
import { addDocument, createCollection } from "../src/knowledge";
import { recoverStuckWork } from "../src/recovery";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;
const MIN = 60_000;

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("recovery of stuck work", () => {
  it("fails dead runs, re-queues lost ones and resolves stuck documents and syncs", async () => {
    const tenantId = fx.tenant.id;
    const now = new Date();
    const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN);
    const chat = (text: string) =>
      withTenant(db, tenantId, (tx) =>
        startRun(tx, { tenantId, userId: fx.owner.id, userName: "O", text }),
      );
    const dead = await chat("Lief, als der Worker abstürzte");
    const alive = await chat("Läuft gerade");
    const lost = await chat("Job ging verloren");
    const fresh = await chat("Gerade erst gesendet");

    const collection = await withTenant(db, tenantId, (tx) =>
      createCollection(tx, { tenantId, name: "Stuck", actorId: fx.owner.id }),
    );
    const add = (fileName: string) =>
      withTenant(db, tenantId, (tx) =>
        addDocument(tx, {
          tenantId,
          collectionId: collection.id,
          fileName,
          bytes: new TextEncoder().encode(`Inhalt ${fileName}`),
          actorId: fx.owner.id,
        }),
      );
    const retry = await add("haengt.txt");
    const hopeless = await add("aussichtslos.txt");

    await withTenant(db, tenantId, async (tx) => {
      await tx
        .update(runs)
        .set({ status: "running", heartbeatAt: ago(15) })
        .where(eq(runs.id, dead.runId));
      await tx
        .update(runs)
        .set({ status: "running", heartbeatAt: ago(1) })
        .where(eq(runs.id, alive.runId));
      await tx
        .update(runs)
        .set({ createdAt: ago(5) })
        .where(eq(runs.id, lost.runId));
      await tx
        .update(knowledgeDocuments)
        .set({ updatedAt: ago(20) })
        .where(eq(knowledgeDocuments.id, retry.documentId));
      await tx
        .update(knowledgeDocuments)
        .set({ createdAt: ago(90), updatedAt: ago(20) })
        .where(eq(knowledgeDocuments.id, hopeless.documentId));
      await tx.insert(knowledgeSources).values({
        tenantId,
        collectionId: collection.id,
        siteId: "s",
        siteName: "S",
        driveId: "d",
        driveName: "D",
        status: "syncing",
        syncStartedAt: ago(45),
      });
    });

    // The fixture's updatedAt hooks touch rows on update; compare against "now" plus a margin.
    const result = await recoverStuckWork(db, new Date(now.getTime() + 1_000));
    expect(result.failedRuns).toBeGreaterThanOrEqual(1);
    expect(result.requeueRuns.map((r) => r.runId)).toContain(lost.runId);
    expect(result.requeueRuns.map((r) => r.runId)).not.toContain(fresh.runId);
    expect(result.resetSources).toBeGreaterThanOrEqual(1);

    const status = async (runId: string) =>
      (await withTenant(db, tenantId, (tx) => tx.select().from(runs).where(eq(runs.id, runId))))[0];
    expect(await status(dead.runId)).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/unterbrochen/),
    });
    expect((await status(alive.runId))?.status).toBe("running");

    const docs = await withTenant(db, tenantId, (tx) =>
      tx
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.collectionId, collection.id)),
    );
    expect(docs.find((d) => d.id === hopeless.documentId)?.status).toBe("failed");
    expect(docs.find((d) => d.id === retry.documentId)?.status).toBe("processing");
    expect(result.requeueDocuments.map((d) => d.documentId)).toContain(retry.documentId);

    // Queued runs that were just handed over are not queued again on the next pass.
    const again = await recoverStuckWork(db, new Date(now.getTime() + 2_000));
    expect(again.requeueRuns.map((r) => r.runId)).not.toContain(lost.runId);
  });
});
