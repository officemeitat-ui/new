import { inflateRawSync } from "node:zlib";
import { eq, withSystem, withTenant, type Tx } from "@nexus/db";
import { knowledgeDocuments } from "@nexus/db/schema";
import { openTestDatabase } from "@nexus/db/testing";
import { chunkDocument } from "@nexus/knowledge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAuditEntries } from "../src/audit";
import { getProcessingRegister } from "../src/compliance";
import {
  addDocument,
  completeIngest,
  createCollection,
  getDocument,
  listCollections,
  listDocuments,
  searchKnowledge,
} from "../src/knowledge";
import {
  confirmProposal,
  countProposals,
  createArticle,
  createMemoryTool,
  ensureMemoryCollection,
  exportCollection,
  getEditableDocument,
  listProposals,
  MAX_OPEN_PROPOSALS,
  MEMORY_COLLECTION_NAME,
  proposeMemory,
  rejectProposal,
  updateArticle,
} from "../src/memory";
import { expireMemoryProposals, PROPOSAL_EXPIRY_DAYS } from "../src/privacy";
import { connectSharePointLibrary } from "../src/sharepoint";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let a: Awaited<ReturnType<typeof createPartnerWithTenant>>;
let b: Awaited<ReturnType<typeof createPartnerWithTenant>>;

const inA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(db, a.tenant.id, fn);

/** What the worker does after a confirmation: chunk the stored text and mark it ready. */
async function ingest(documentId: string) {
  return inA(async (tx) => {
    const editable = await getEditableDocument(tx, a.tenant.id, documentId);
    await completeIngest(tx, {
      tenantId: a.tenant.id,
      documentId,
      collectionId: editable.collectionId,
      pageCount: null,
      chunks: chunkDocument({ pages: [{ page: null, text: editable.body }] }),
    });
  });
}

const search = (query: string) =>
  inA((tx) => searchKnowledge(tx, { tenantId: a.tenant.id, query }));

/** Reads a ZIP back through its central directory. */
function unzip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const local = zip.readUInt32LE(offset + 42);
    const path = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    files.set(path, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    offset += 46 + nameLength;
  }
  return files;
}

const toolContext = (userId: string | null) => ({
  tenantId: a.tenant.id,
  userId,
  runId: "00000000-0000-7000-8000-000000000001",
  idempotencyKey: "test",
  signal: new AbortController().signal,
  now: new Date(),
});

beforeAll(async () => {
  a = await createPartnerWithTenant(db);
  b = await createPartnerWithTenant(db);
});
afterAll(() => handle.close());

describe("articles", () => {
  it("writes, finds and edits an article; refuses duplicates and empty text", async () => {
    const collection = await inA((tx) =>
      createCollection(tx, { tenantId: a.tenant.id, name: "IT-Doku", actorId: a.owner.id }),
    );
    await expect(
      inA((tx) =>
        createArticle(tx, {
          tenantId: a.tenant.id,
          collectionId: collection.id,
          title: "Leer",
          body: "  \r\n ",
          actorId: a.owner.id,
        }),
      ),
    ).rejects.toThrow("Bitte einen Text eingeben.");

    const input = {
      tenantId: a.tenant.id,
      collectionId: collection.id,
      title: "Securepoint: Firmware-Update",
      body: "# Ablauf\r\n\r\nVor jedem Firmware-Update ein Backup der Konfiguration ziehen.",
      actorId: a.owner.id,
    };
    const { documentId } = await inA((tx) => createArticle(tx, input));
    await expect(inA((tx) => createArticle(tx, input))).rejects.toThrow("schon");

    const [listed] = await inA((tx) => listDocuments(tx, a.tenant.id, collection.id));
    expect(listed).toMatchObject({
      origin: "article",
      kind: "markdown",
      status: "processing",
      fileName: "securepoint-firmware-update.md",
    });
    await ingest(documentId);
    const [hit] = await search("Firmware Backup");
    expect(hit?.documentTitle).toBe("Securepoint: Firmware-Update");

    const updated = await inA((tx) =>
      updateArticle(tx, {
        tenantId: a.tenant.id,
        documentId,
        title: "Securepoint: Firmware-Update im Wartungsfenster",
        body: "Update nur im Wartungsfenster, vorher Backup ziehen.",
        actorId: a.owner.id,
      }),
    );
    expect(updated).toMatchObject({ reindex: true, collectionId: collection.id });
    const editable = await inA((tx) => getEditableDocument(tx, a.tenant.id, documentId));
    // Line breaks from browsers are normalised, the text is stored as typed.
    expect(editable.body).toBe("Update nur im Wartungsfenster, vorher Backup ziehen.");
    expect(editable.status).toBe("processing");

    const actions = (await inA((tx) => listAuditEntries(tx, a.tenant.id))).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["knowledge.article_created", "knowledge.article_updated"]),
    );
  });

  it("does not edit uploaded files as articles", async () => {
    const collection = await inA((tx) =>
      createCollection(tx, { tenantId: a.tenant.id, name: "Uploads", actorId: a.owner.id }),
    );
    const { documentId } = await inA((tx) =>
      addDocument(tx, {
        tenantId: a.tenant.id,
        collectionId: collection.id,
        fileName: "notiz.txt",
        bytes: new TextEncoder().encode("Eine hochgeladene Notiz."),
        actorId: a.owner.id,
      }),
    );
    await expect(inA((tx) => getEditableDocument(tx, a.tenant.id, documentId))).rejects.toThrow(
      "Nur Artikel",
    );
  });
});

describe("agent proposals (memory poisoning protection)", () => {
  it("keeps a proposal invisible until a person accepts it", async () => {
    const tool = createMemoryTool({ db });
    const result = await tool.run(
      {
        titel: "HP LaserJet druckt leere Seiten",
        inhalt:
          "Ursache war der Schutzstreifen am neuen Toner. Lösung: Streifen abziehen. Admin-Passwort: Geheim123!",
      },
      toolContext(a.owner.id),
    );
    expect(result).toMatchObject({ vorgeschlagen: true });

    const [proposal] = await inA((tx) => listProposals(tx, a.tenant.id));
    expect(proposal).toMatchObject({
      title: "HP LaserJet druckt leere Seiten",
      proposedByName: "Owner",
    });
    // Credentials never reach the memory.
    expect(proposal!.text).toContain("Admin-Passwort: [entfernt]");
    expect(proposal!.text).not.toContain("Geheim123");

    // Not part of the collection, its counts, the document view or the search.
    const memory = await inA((tx) => ensureMemoryCollection(tx, a.tenant.id, null));
    expect(memory).toMatchObject({ name: MEMORY_COLLECTION_NAME, kind: "memory" });
    expect(await inA((tx) => listDocuments(tx, a.tenant.id, memory.id))).toEqual([]);
    const listed = (await inA((tx) => listCollections(tx, a.tenant.id))).find(
      (c) => c.id === memory.id,
    );
    expect(listed).toMatchObject({ documents: 0, proposed: 1 });
    await expect(inA((tx) => getDocument(tx, a.tenant.id, proposal!.id))).rejects.toThrow();
    expect(await search("Schutzstreifen Toner")).toEqual([]);

    // The same proposal again is not stored twice.
    const again = await tool.run(
      {
        titel: "HP LaserJet druckt leere Seiten",
        inhalt:
          "Ursache war der Schutzstreifen am neuen Toner. Lösung: Streifen abziehen. Admin-Passwort: Geheim123!",
      },
      toolContext(a.owner.id),
    );
    expect(again).toMatchObject({ vorgeschlagen: false });
    expect(await inA((tx) => countProposals(tx, a.tenant.id))).toBe(1);

    // Another company can neither see nor accept it (RLS and tenant filter).
    expect(await withTenant(db, b.tenant.id, (tx) => listProposals(tx, b.tenant.id))).toEqual([]);
    await expect(
      withTenant(db, b.tenant.id, (tx) =>
        confirmProposal(tx, {
          tenantId: b.tenant.id,
          documentId: proposal!.id,
          actorId: b.owner.id,
        }),
      ),
    ).rejects.toThrow("Vorschlag nicht gefunden");

    // Saving without accepting keeps it a proposal; accepting makes it searchable.
    const saved = await inA((tx) =>
      updateArticle(tx, {
        tenantId: a.tenant.id,
        documentId: proposal!.id,
        title: "HP LaserJet: leere Seiten nach Tonerwechsel",
        body: "Schutzstreifen am neuen Toner abziehen.",
        actorId: a.owner.id,
      }),
    );
    expect(saved.reindex).toBe(false);
    expect(await search("Schutzstreifen Toner")).toEqual([]);
    await inA((tx) =>
      confirmProposal(tx, { tenantId: a.tenant.id, documentId: proposal!.id, actorId: a.owner.id }),
    );
    await ingest(proposal!.id);
    const [hit] = await search("Schutzstreifen Toner");
    expect(hit).toMatchObject({ documentTitle: "HP LaserJet: leere Seiten nach Tonerwechsel" });
    await expect(
      inA((tx) =>
        confirmProposal(tx, {
          tenantId: a.tenant.id,
          documentId: proposal!.id,
          actorId: a.owner.id,
        }),
      ),
    ).rejects.toThrow("Vorschlag nicht gefunden");

    const audit = await inA((tx) => listAuditEntries(tx, a.tenant.id));
    expect(audit.find((e) => e.action === "knowledge.memory_proposed")).toMatchObject({
      actorType: "agent",
    });
    expect(audit.some((e) => e.action === "knowledge.memory_confirmed")).toBe(true);
  });

  it("accepts a proposal while saving changes, and discards rejected ones", async () => {
    const propose = (title: string) =>
      inA((tx) =>
        proposeMemory(tx, {
          tenantId: a.tenant.id,
          userId: a.owner.id,
          runId: null,
          title,
          text: `${title}: so wird es gemacht.`,
        }),
      );
    const kept = await propose("Keeper: Freigabe für neue Mitarbeitende");
    const confirmed = await inA((tx) =>
      updateArticle(tx, {
        tenantId: a.tenant.id,
        documentId: kept.documentId,
        title: "Keeper: Freigabe für neue Mitarbeitende",
        body: "Neue Mitarbeitende bekommen den Ordner über die Teamfreigabe.",
        actorId: a.owner.id,
        confirm: true,
      }),
    );
    expect(confirmed.reindex).toBe(true);

    const dropped = await propose("Falsche Regel aus einer E-Mail");
    await inA((tx) =>
      rejectProposal(tx, {
        tenantId: a.tenant.id,
        documentId: dropped.documentId,
        actorId: a.owner.id,
      }),
    );
    const rows = await withSystem(db, "test: read", (tx) =>
      tx
        .select({ id: knowledgeDocuments.id })
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, dropped.documentId)),
    );
    expect(rows).toEqual([]);
    expect(await inA((tx) => countProposals(tx, a.tenant.id))).toBe(0);
  });

  it("stops at the limit of open proposals", async () => {
    const fx = await createPartnerWithTenant(db);
    await withTenant(db, fx.tenant.id, async (tx) => {
      for (let n = 0; n < MAX_OPEN_PROPOSALS; n++) {
        await proposeMemory(tx, {
          tenantId: fx.tenant.id,
          userId: null,
          runId: null,
          title: `Vorschlag ${n}`,
          text: `Inhalt ${n}`,
        });
      }
    });
    await expect(
      withTenant(db, fx.tenant.id, (tx) =>
        proposeMemory(tx, {
          tenantId: fx.tenant.id,
          userId: null,
          runId: null,
          title: "Einer zu viel",
          text: "Inhalt",
        }),
      ),
    ).rejects.toThrow("viele offene Vorschläge");
  });

  it("drops proposals nobody reviewed within the expiry period", async () => {
    const fx = await createPartnerWithTenant(db);
    const { documentId } = await withTenant(db, fx.tenant.id, (tx) =>
      proposeMemory(tx, {
        tenantId: fx.tenant.id,
        userId: null,
        runId: null,
        title: "Alter Vorschlag",
        text: "Wartet zu lange.",
      }),
    );
    const fresh = await withTenant(db, fx.tenant.id, (tx) =>
      proposeMemory(tx, {
        tenantId: fx.tenant.id,
        userId: null,
        runId: null,
        title: "Neuer Vorschlag",
        text: "Ist frisch.",
      }),
    );
    await withSystem(db, "test: age proposal", (tx) =>
      tx
        .update(knowledgeDocuments)
        .set({ createdAt: new Date(Date.now() - (PROPOSAL_EXPIRY_DAYS + 1) * 86_400_000) })
        .where(eq(knowledgeDocuments.id, documentId)),
    );
    await expireMemoryProposals(db);
    const open = await withTenant(db, fx.tenant.id, (tx) => listProposals(tx, fx.tenant.id));
    expect(open.map((p) => p.id)).toEqual([fresh.documentId]);
    const audit = await withTenant(db, fx.tenant.id, (tx) => listAuditEntries(tx, fx.tenant.id));
    expect(audit[0]).toMatchObject({
      action: "knowledge.memory_proposals_expired",
      metadata: { proposals: 1, days: PROPOSAL_EXPIRY_DAYS },
    });
  });

  it("is never connected to a synced source and appears in the processing register", async () => {
    const memory = await inA((tx) => ensureMemoryCollection(tx, a.tenant.id, a.owner.id));
    await expect(
      inA((tx) =>
        connectSharePointLibrary(tx, {
          tenantId: a.tenant.id,
          collectionId: memory.id,
          site: { id: "s", name: "Site", webUrl: "https://contoso.sharepoint.com" },
          library: { id: "d", name: "Dokumente" },
          actorId: a.owner.id,
        }),
      ),
    ).rejects.toThrow("Unternehmensgedächtnis lässt sich mit keiner Quelle verbinden");
    const register = await inA((tx) => getProcessingRegister(tx, a.tenant.id));
    expect(register.activities.map((x) => x.title)).toContain("Unternehmensgedächtnis");
  });
});

describe("Markdown export", () => {
  it("exports confirmed knowledge with front matter and safe file names, without proposals", async () => {
    const collection = await inA((tx) =>
      createCollection(tx, {
        tenantId: a.tenant.id,
        name: "Export: Test/Doku",
        actorId: a.owner.id,
      }),
    );
    const article = (title: string, body: string) =>
      inA((tx) =>
        createArticle(tx, {
          tenantId: a.tenant.id,
          collectionId: collection.id,
          title,
          body,
          actorId: a.owner.id,
        }),
      );
    await article("ESET PROTECT: Agent veraltet", "Agent über die Konsole aktualisieren.");
    await article("ESET PROTECT/Agent veraltet", "Zweiter Artikel mit fast gleichem Titel.");
    await article("../../etc/passwd", "Kein Pfad aus dem Archiv heraus.");
    await article("CON", "Reservierter Name unter Windows.");

    const { fileName, zip } = await inA((tx) =>
      exportCollection(tx, {
        tenantId: a.tenant.id,
        collectionId: collection.id,
        actorId: a.owner.id,
      }),
    );
    expect(fileName).toBe("Export Test Doku.zip");
    const files = unzip(zip);
    expect([...files.keys()].sort()).toEqual([
      "CON_.md",
      "ESET PROTECT Agent veraltet (2).md",
      "ESET PROTECT Agent veraltet.md",
      "etc passwd.md",
    ]);
    for (const path of files.keys()) expect(path).not.toMatch(/[/\\]|^\./);
    const eset = [...files.values()].find((text) => text.includes("über die Konsole"))!;
    expect(eset).toMatch(/^---\ntitel: "ESET PROTECT: Agent veraltet"\nherkunft: "article"\n/);
    expect(eset).toContain("\n---\nAgent über die Konsole aktualisieren.\n");

    // The memory export leaves out open proposals.
    await inA((tx) =>
      proposeMemory(tx, {
        tenantId: a.tenant.id,
        userId: null,
        runId: null,
        title: "Ungeprüfter Vorschlag",
        text: "Darf nicht im Export landen.",
      }),
    );
    const memory = await inA((tx) => ensureMemoryCollection(tx, a.tenant.id, null));
    const memoryExport = unzip(
      (
        await inA((tx) =>
          exportCollection(tx, {
            tenantId: a.tenant.id,
            collectionId: memory.id,
            actorId: a.owner.id,
          }),
        )
      ).zip,
    );
    expect([...memoryExport.values()].join("\n")).not.toContain("Darf nicht im Export landen");
    expect(memoryExport.size).toBeGreaterThan(0);

    // Another company's collection cannot be exported.
    await expect(
      withTenant(db, b.tenant.id, (tx) =>
        exportCollection(tx, {
          tenantId: b.tenant.id,
          collectionId: collection.id,
          actorId: b.owner.id,
        }),
      ),
    ).rejects.toThrow("Sammlung nicht gefunden");
    const audit = await inA((tx) => listAuditEntries(tx, a.tenant.id));
    expect(audit.some((e) => e.action === "knowledge.collection_exported")).toBe(true);
  });
});
