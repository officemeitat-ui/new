import { eq, withSystem, withTenant } from "@nexus/db";
import {
  authSession,
  authUser,
  conversations,
  knowledgeDocuments,
  memberships,
  runs,
  usageEvents,
} from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendAudit, exportAuditCsv, listAuditEntries, verifyAuditChain } from "../src/audit";
import { startRun } from "../src/chat";
import { addDocument, createCollection } from "../src/knowledge";
import {
  applyRetention,
  deleteAccountIfOrphaned,
  erasePerson,
  exportPersonData,
  getPrivacySettings,
  updateRetention,
} from "../src/privacy";
import { createPartnerWithTenant, createUser } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let fx: Awaited<ReturnType<typeof createPartnerWithTenant>>;
let other: Awaited<ReturnType<typeof createPartnerWithTenant>>;

const DAY = 86_400_000;

async function addMember(tenantId: string, name: string, role: "admin" | "member" = "member") {
  const user = await createUser(db, name);
  await withSystem(db, "test: add member", (tx) =>
    tx.insert(memberships).values({ tenantId, userId: user.id, role }),
  );
  return user;
}

async function chat(tenantId: string, userId: string, text: string) {
  return withTenant(db, tenantId, (tx) => startRun(tx, { tenantId, userId, userName: "X", text }));
}

beforeAll(async () => {
  fx = await createPartnerWithTenant(db);
  other = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("retention", () => {
  it("accepts only the offered periods and logs the change", async () => {
    const tenantId = fx.tenant.id;
    await expect(
      withTenant(db, tenantId, (tx) =>
        updateRetention(tx, {
          tenantId,
          chatRetentionDays: 7,
          documentRetentionDays: null,
          actorId: fx.owner.id,
        }),
      ),
    ).rejects.toThrow(/angebotenen Fristen/);
    await withTenant(db, tenantId, (tx) =>
      updateRetention(tx, {
        tenantId,
        chatRetentionDays: 30,
        documentRetentionDays: 365,
        actorId: fx.owner.id,
      }),
    );
    expect(await withTenant(db, tenantId, (tx) => getPrivacySettings(tx, tenantId))).toEqual({
      chatRetentionDays: 30,
      documentRetentionDays: 365,
    });
  });

  it("deletes expired conversations and documents, keeps recent and active ones and costs", async () => {
    const tenantId = fx.tenant.id;
    const now = new Date();
    const old = await chat(tenantId, fx.owner.id, "Alter Chat");
    const recent = await chat(tenantId, fx.owner.id, "Neuer Chat");
    const busy = await chat(tenantId, fx.owner.id, "Läuft noch");
    const collection = await withTenant(db, tenantId, (tx) =>
      createCollection(tx, { tenantId, name: "Archiv", actorId: fx.owner.id }),
    );
    const { documentId } = await withTenant(db, tenantId, (tx) =>
      addDocument(tx, {
        tenantId,
        collectionId: collection.id,
        fileName: "alt.txt",
        bytes: new TextEncoder().encode("Alte Preisliste"),
        actorId: fx.owner.id,
      }),
    );
    await withTenant(db, tenantId, async (tx) => {
      const past = new Date(now.getTime() - 40 * DAY);
      await tx
        .update(conversations)
        .set({ lastMessageAt: past })
        .where(eq(conversations.id, old.conversationId));
      await tx
        .update(conversations)
        .set({ lastMessageAt: past })
        .where(eq(conversations.id, busy.conversationId));
      await tx.update(runs).set({ status: "completed" }).where(eq(runs.id, old.runId));
      await tx.update(runs).set({ status: "running" }).where(eq(runs.id, busy.runId));
      await tx
        .update(knowledgeDocuments)
        .set({ createdAt: new Date(now.getTime() - 400 * DAY) })
        .where(eq(knowledgeDocuments.id, documentId));
      await tx.insert(usageEvents).values({
        tenantId,
        runId: old.runId,
        model: "claude-sonnet-5-5",
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsdMicros: 1234,
      });
    });

    const results = await applyRetention(db, now);
    expect(results.find((r) => r.tenantId === tenantId)).toMatchObject({
      conversations: 1,
      documents: 1,
    });

    const left = await withTenant(db, tenantId, (tx) =>
      tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.tenantId, tenantId)),
    );
    const ids = left.map((c) => c.id);
    expect(ids).not.toContain(old.conversationId);
    expect(ids).toEqual(expect.arrayContaining([recent.conversationId, busy.conversationId]));
    const [usage] = await withTenant(db, tenantId, (tx) =>
      tx.select().from(usageEvents).where(eq(usageEvents.costUsdMicros, 1234)),
    );
    expect(usage).toMatchObject({ runId: null });
    const audit = await withTenant(db, tenantId, (tx) => listAuditEntries(tx, tenantId, 5));
    expect(audit[0]).toMatchObject({ action: "privacy.retention_applied", actorType: "system" });
  });
});

describe("export and erasure", () => {
  it("exports exactly the person's data in this company", async () => {
    const tenantId = fx.tenant.id;
    const maria = await addMember(tenantId, "Maria");
    await chat(tenantId, maria.id, "Bitte Urlaub für Juli eintragen");
    await chat(tenantId, fx.owner.id, "Chat einer anderen Person");

    const data = await withTenant(db, tenantId, (tx) =>
      exportPersonData(tx, { tenantId, userId: maria.id }),
    );
    expect(data.person).toMatchObject({ name: "Maria", email: maria.email });
    expect(data.mitgliedschaft.rolle).toBe("member");
    expect(data.gespraeche).toHaveLength(1);
    expect(data.gespraeche[0]!.nachrichten[0]).toMatchObject({
      von: "Person",
      text: "Bitte Urlaub für Juli eintragen",
    });
    expect(JSON.stringify(data)).not.toContain("<kontext>");
    expect(JSON.stringify(data)).not.toContain("Chat einer anderen Person");

    // Another company cannot ask about this person.
    await expect(
      withTenant(db, other.tenant.id, (tx) =>
        exportPersonData(tx, { tenantId: other.tenant.id, userId: maria.id }),
      ),
    ).rejects.toThrow(/gehört nicht/);
  });

  it("erases a person: conversations, membership and – if nothing else is left – the account", async () => {
    const tenantId = fx.tenant.id;
    const karl = await addMember(tenantId, "Karl");
    await chat(tenantId, karl.id, "Mein Gehaltszettel fehlt");
    await withSystem(db, "test: session", (tx) =>
      tx
        .insert(authSession)
        .values({ userId: karl.id, token: `t-${karl.id}`, expiresAt: new Date(Date.now() + DAY) }),
    );

    await expect(
      withTenant(db, tenantId, (tx) =>
        erasePerson(tx, {
          tenantId,
          userId: fx.owner.id,
          actorId: fx.owner.id,
          actorRole: "owner",
        }),
      ),
    ).rejects.toThrow(/Sich selbst/);
    const admin = await addMember(tenantId, "Ada", "admin");
    await expect(
      withTenant(db, tenantId, (tx) =>
        erasePerson(tx, { tenantId, userId: fx.owner.id, actorId: admin.id, actorRole: "admin" }),
      ),
    ).rejects.toThrow(/Nur Owner/);

    const result = await withTenant(db, tenantId, (tx) =>
      erasePerson(tx, { tenantId, userId: karl.id, actorId: fx.owner.id, actorRole: "owner" }),
    );
    expect(result).toEqual({ conversations: 1 });
    expect(await deleteAccountIfOrphaned(db, { userId: karl.id, tenantId })).toBe(true);

    const [account] = await withSystem(db, "test: check user", (tx) =>
      tx.select().from(authUser).where(eq(authUser.id, karl.id)),
    );
    expect(account).toBeUndefined();
    const sessions = await withSystem(db, "test: check sessions", (tx) =>
      tx.select().from(authSession).where(eq(authSession.userId, karl.id)),
    );
    expect(sessions).toHaveLength(0);
    const audit = await withTenant(db, tenantId, (tx) => listAuditEntries(tx, tenantId, 5));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["privacy.person_erased", "privacy.account_deleted"]),
    );
    expect(JSON.stringify(audit)).not.toContain("Gehaltszettel");
  });

  it("keeps the account of a person who also works for another company", async () => {
    const both = await addMember(fx.tenant.id, "Berta");
    await withSystem(db, "test: second membership", (tx) =>
      tx.insert(memberships).values({ tenantId: other.tenant.id, userId: both.id, role: "member" }),
    );
    await withTenant(db, fx.tenant.id, (tx) =>
      erasePerson(tx, {
        tenantId: fx.tenant.id,
        userId: both.id,
        actorId: fx.owner.id,
        actorRole: "owner",
      }),
    );
    expect(await deleteAccountIfOrphaned(db, { userId: both.id, tenantId: fx.tenant.id })).toBe(
      false,
    );
  });
});

describe("audit export", () => {
  it("exports the whole chain as CSV and neutralises spreadsheet formulas", async () => {
    const tenantId = other.tenant.id;
    const evil = await addMember(tenantId, "=HYPERLINK(1)");
    await withTenant(db, tenantId, (tx) =>
      appendAudit(tx, tenantId, {
        actorType: "user",
        actorId: evil.id,
        action: "member.added",
        metadata: {},
      }),
    );
    const csv = await withTenant(db, tenantId, (tx) => exportAuditCsv(tx, tenantId));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("seq,zeit,akteur_typ");
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    expect(csv).not.toContain(`,"=HYPERLINK`);
    const chain = await withTenant(db, tenantId, (tx) => verifyAuditChain(tx, tenantId));
    expect(chain).toEqual({ valid: true, count: lines.length - 1 });
  });
});
