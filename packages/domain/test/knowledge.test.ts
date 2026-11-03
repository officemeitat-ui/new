import { withTenant } from "@nexus/db";
import { openTestDatabase } from "@nexus/db/testing";
import { chunkDocument } from "@nexus/knowledge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDocument,
  completeIngest,
  createCollection,
  createKnowledgeTool,
  deleteDocument,
  getDocument,
  listCollections,
  listDocuments,
  searchKnowledge,
} from "../src/knowledge";
import { createPartnerWithTenant } from "./fixtures";

const handle = openTestDatabase();
const db = handle.db;
let a: Awaited<ReturnType<typeof createPartnerWithTenant>>;
let b: Awaited<ReturnType<typeof createPartnerWithTenant>>;
let prices: string;
let hr: string;

const encode = (value: string) => new TextEncoder().encode(value);

/** Upload and ingest like the worker does, with the real chunker. */
async function ingest(tenantId: string, collectionId: string, fileName: string, text: string) {
  return withTenant(db, tenantId, async (tx) => {
    const { documentId } = await addDocument(tx, {
      tenantId,
      collectionId,
      fileName,
      bytes: encode(text),
      actorId: (tenantId === a.tenant.id ? a : b).owner.id,
    });
    await completeIngest(tx, {
      tenantId,
      documentId,
      collectionId,
      pageCount: null,
      chunks: chunkDocument({ pages: [{ page: null, text }] }),
    });
    return documentId;
  });
}

beforeAll(async () => {
  a = await createPartnerWithTenant(db);
  b = await createPartnerWithTenant(db);
  const create = (name: string) =>
    withTenant(db, a.tenant.id, (tx) =>
      createCollection(tx, { tenantId: a.tenant.id, name, actorId: a.owner.id }),
    );
  prices = (await create("Preise und AGB")).id;
  hr = (await create("Personal")).id;
  await ingest(
    a.tenant.id,
    prices,
    "AGB_2026.md",
    "# Zahlungsbedingungen\n\nUnsere Rechnungen sind innerhalb von 14 Tagen ohne Abzug zahlbar. Bei Zahlung binnen 7 Tagen gewähren wir 2 % Skonto.\n\n# Gewährleistung\n\nDie Gewährleistung beträgt zwei Jahre ab Übergabe.",
  );
  await ingest(
    a.tenant.id,
    hr,
    "Urlaub.txt",
    "Urlaub beantragen Sie im Personalportal mindestens 14 Tage im Voraus.",
  );
});
afterAll(() => handle.close());

describe("knowledge base", () => {
  it("finds passages with German stemming and natural questions", async () => {
    const hits = await withTenant(db, a.tenant.id, (tx) =>
      searchKnowledge(tx, {
        tenantId: a.tenant.id,
        query: "Wie lange habe ich für die Rechnung Zeit?",
      }),
    );
    expect(hits[0]).toMatchObject({ documentTitle: "AGB 2026", heading: "Zahlungsbedingungen" });
    expect(hits[0]!.snippet).toContain("**Rechnungen**");
  });

  it("weights headings and limits the search to the given collections", async () => {
    const all = await withTenant(db, a.tenant.id, (tx) =>
      searchKnowledge(tx, { tenantId: a.tenant.id, query: "14 Tage" }),
    );
    expect(new Set(all.map((h) => h.documentTitle))).toEqual(new Set(["AGB 2026", "Urlaub"]));
    const onlyHr = await withTenant(db, a.tenant.id, (tx) =>
      searchKnowledge(tx, { tenantId: a.tenant.id, query: "14 Tage", collectionIds: [hr] }),
    );
    expect(onlyHr.map((h) => h.documentTitle)).toEqual(["Urlaub"]);
    const heading = await withTenant(db, a.tenant.id, (tx) =>
      searchKnowledge(tx, { tenantId: a.tenant.id, query: "Gewährleistung" }),
    );
    expect(heading[0]?.heading).toBe("Gewährleistung");
  });

  it("returns nothing for stop words only and never another tenant's documents", async () => {
    const stop = await withTenant(db, a.tenant.id, (tx) =>
      searchKnowledge(tx, { tenantId: a.tenant.id, query: "und oder die" }),
    );
    expect(stop).toEqual([]);
    const other = await withTenant(db, b.tenant.id, (tx) =>
      searchKnowledge(tx, { tenantId: b.tenant.id, query: "Rechnung Skonto Urlaub" }),
    );
    expect(other).toEqual([]);
    // Even asking for tenant A's id from tenant B's context finds nothing (RLS).
    const forged = await withTenant(db, b.tenant.id, (tx) =>
      searchKnowledge(tx, { tenantId: a.tenant.id, query: "Rechnung" }),
    );
    expect(forged).toEqual([]);
  });

  it("checks file type, size and duplicates on upload", async () => {
    const add = (fileName: string, bytes: Uint8Array) =>
      withTenant(db, a.tenant.id, (tx) =>
        addDocument(tx, {
          tenantId: a.tenant.id,
          collectionId: prices,
          fileName,
          bytes,
          actorId: a.owner.id,
        }),
      );
    await expect(add("rechnung.pdf", encode("kein PDF"))).rejects.toThrow(/nicht unterstützt/);
    await expect(add("leer.txt", new Uint8Array())).rejects.toThrow(/leer/);
    await expect(add("riesig.txt", new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toThrow(/10 MB/);
    await expect(
      add(
        "AGB_kopie.md",
        encode(
          "# Zahlungsbedingungen\n\nUnsere Rechnungen sind innerhalb von 14 Tagen ohne Abzug zahlbar. Bei Zahlung binnen 7 Tagen gewähren wir 2 % Skonto.\n\n# Gewährleistung\n\nDie Gewährleistung beträgt zwei Jahre ab Übergabe.",
        ),
      ),
    ).rejects.toThrow(/bereits vorhanden/);
  });

  it("lists collections with counts, shows a document and deletes it with its chunks", async () => {
    const collections = await withTenant(db, a.tenant.id, (tx) => listCollections(tx, a.tenant.id));
    expect(collections.map((c) => [c.name, c.documents, c.ready])).toEqual([
      ["Personal", 1, 1],
      ["Preise und AGB", 1, 1],
    ]);
    const extra = await ingest(
      a.tenant.id,
      hr,
      "Homeoffice.md",
      "Homeoffice ist an zwei Tagen pro Woche möglich.",
    );
    const shown = await withTenant(db, a.tenant.id, (tx) => getDocument(tx, a.tenant.id, extra));
    expect(shown).toMatchObject({ title: "Homeoffice", collectionName: "Personal", chunkCount: 1 });
    expect(shown.chunks[0]?.text).toContain("zwei Tagen");

    await withTenant(db, a.tenant.id, (tx) =>
      deleteDocument(tx, { tenantId: a.tenant.id, documentId: extra, actorId: a.owner.id }),
    );
    const docs = await withTenant(db, a.tenant.id, (tx) => listDocuments(tx, a.tenant.id, hr));
    expect(docs.map((d) => d.title)).toEqual(["Urlaub"]);
    const gone = await withTenant(db, a.tenant.id, (tx) =>
      searchKnowledge(tx, { tenantId: a.tenant.id, query: "Homeoffice" }),
    );
    expect(gone).toEqual([]);
  });

  it("gives agents passages with their source", async () => {
    const tool = createKnowledgeTool({ db, collectionIds: [prices] });
    const result = (await tool.run(
      { anfrage: "Skonto" },
      {
        tenantId: a.tenant.id,
        userId: a.owner.id,
        runId: "r",
        now: new Date(),
        signal: new AbortController().signal,
        idempotencyKey: "r:1",
      },
    )) as { treffer: { quelle: string; text: string }[] };
    expect(result.treffer[0]).toMatchObject({ quelle: "AGB 2026" });
    expect(result.treffer[0]!.text).toContain("2 % Skonto");
  });
});
