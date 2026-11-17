import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReceiptExtraction } from "@/lib/receipts/extract";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "receipts-")), "test.db")}`;

// Claude wird hier durch feste Ergebnisse ersetzt (der echte Ablauf steckt in outlook.test.ts).
const extraction = vi.hoisted(() => ({ next: [] as (ReceiptExtraction | Error)[], calls: 0 }));
vi.mock("@/lib/receipts/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/receipts/extract")>()),
  extractReceipt: async () => {
    extraction.calls++;
    const next = extraction.next.shift()!;
    if (next instanceof Error) throw next;
    return next;
  },
}));

const rechnung = (overrides: Partial<ReceiptExtraction> = {}): ReceiptExtraction => ({
  dokumentart: "rechnung",
  lieferant: "Büro Müller & Söhne GmbH",
  rechnungsnummer: "RE/2026/0815",
  rechnungsdatum: "2026-10-28",
  faelligAm: "",
  brutto: 59.9,
  netto: 49.92,
  ust: 9.98,
  waehrung: "eur",
  bezahlt: "ja",
  beschreibung: "Druckerpapier",
  unsicher: false,
  ...overrides,
});

let files: typeof import("@/lib/receipts/files");
let capture: typeof import("@/lib/receipts/capture");
let store: typeof import("@/lib/receipts/store");
let exporter: typeof import("@/lib/receipts/export");
let ai: typeof import("@/lib/ai");

beforeAll(async () => {
  files = await import("@/lib/receipts/files");
  capture = await import("@/lib/receipts/capture");
  store = await import("@/lib/receipts/store");
  exporter = await import("@/lib/receipts/export");
  ai = await import("@/lib/ai");
});

const pdf = (text: string) => ({ name: `${text}.pdf`, contentType: "application/octet-stream", content: Buffer.from(`%PDF-1.4 ${text}`) });

describe("Dateien und Beträge", () => {
  it("erkennt Belegdateien auch mit ungenauem Dateityp", () => {
    expect(files.receiptFileKind("application/octet-stream", "Rechnung.PDF")).toBe("pdf");
    expect(files.receiptFileKind("image/jpg", "foto.jpg")).toBe("image");
    expect(files.receiptFileKind("text/xml", "ebinterface.xml")).toBe("xml");
    expect(files.receiptFileKind("application/vnd.ms-excel", "liste.xls")).toBeNull();
    expect(files.receiptFileKind("image/svg+xml", "logo.svg")).toBeNull();
  });

  it("liest Beträge in österreichischer und englischer Schreibweise", () => {
    expect(files.parseAmount("1.234,56")).toBe(123456);
    expect(files.parseAmount("1234.5")).toBe(123450);
    expect(files.parseAmount("€ 12,-".replace(",-", ""))).toBe(1200);
    expect(files.parseAmount("-0,99")).toBe(-99);
    expect(files.parseAmount("")).toBeNull();
    expect(files.parseAmount("zwölf")).toBeNaN();
  });

  it("benennt Dateien sprechend und eindeutig", () => {
    const used = new Set<string>();
    const receipt = {
      invoiceDate: "2026-11-05",
      month: "2026-11",
      supplier: "Büro Müller & Söhne GmbH",
      invoiceNumber: "RE/2026/0815",
      grossCents: 123456,
      currency: "EUR",
      contentType: "application/pdf",
    };
    expect(files.receiptFileName(receipt, used)).toBe("2026-11-05_Buero-Mueller-Soehne-GmbH_RE-2026-0815_1234,56EUR.pdf");
    expect(files.receiptFileName(receipt, used)).toBe("2026-11-05_Buero-Mueller-Soehne-GmbH_RE-2026-0815_1234,56EUR_2.pdf");
    expect(files.receiptFileName({ ...receipt, invoiceDate: null, supplier: null, invoiceNumber: null, grossCents: null }, used)).toBe(
      "2026-11-00_Unbekannt.pdf",
    );
  });
});

describe("Belege erfassen", () => {
  it("liest aus, ordnet den Monat nach Belegdatum zu und überspringt doppelte Dateien", async () => {
    extraction.next = [rechnung()];
    const first = await capture.captureReceipts({ files: [pdf("papier")], source: "upload", receivedAt: new Date("2026-11-03T10:00:00Z") });
    expect(first.stored[0]).toMatchObject({
      status: "neu",
      month: "2026-10",
      supplier: "Büro Müller & Söhne GmbH",
      grossCents: 5990,
      currency: "EUR",
      paid: true,
      contentType: "application/pdf",
    });
    const again = await capture.captureReceipts({ files: [pdf("papier")], source: "upload", receivedAt: new Date() });
    expect(again).toEqual({ stored: [], duplicates: 1, skipped: 0 });
    expect(extraction.calls).toBe(1);
  });

  it("markiert Mahnungen, unsichere und doppelte Rechnungsnummern zur Prüfung", async () => {
    extraction.next = [
      rechnung({ dokumentart: "mahnung", rechnungsnummer: "M-1", rechnungsdatum: "2026-11-02" }),
      rechnung({ unsicher: true, rechnungsnummer: "X-9", rechnungsdatum: "2026-11-02" }),
      rechnung({ rechnungsdatum: "2026-11-02" }), // gleiche Nummer wie im Test davor, andere Datei
    ];
    const { stored } = await capture.captureReceipts({
      files: [pdf("mahnung"), pdf("unleserlich"), pdf("kopie")],
      source: "upload",
      receivedAt: new Date("2026-11-03T10:00:00Z"),
    });
    expect(stored.map((r) => [r.status, r.note?.slice(0, 20)])).toEqual([
      ["pruefen", "Mahnung – bitte Zahl"],
      ["pruefen", "Angaben unsicher – b"],
      ["pruefen", "Rechnungsnummer RE/2"],
    ]);
  });

  it("legt Dateien auch ohne KI ab und lässt Nicht-Belege weg", async () => {
    extraction.next = [new ai.AiError("KI nicht verfügbar."), rechnung({ dokumentart: "kein_beleg" })];
    const result = await capture.captureReceipts({
      files: [pdf("ohne-ki"), pdf("agb"), { name: "tabelle.xlsx", contentType: "application/vnd.ms-excel", content: Buffer.from("x") }],
      source: "email",
      email: { id: null as unknown as string, fromName: "Shop GmbH", fromAddress: "rechnung@shop.example", subject: "Rechnung" },
      receivedAt: new Date("2026-11-10T10:00:00Z"),
    });
    expect(result.skipped).toBe(2);
    expect(result.stored[0]).toMatchObject({ status: "pruefen", supplier: "Shop GmbH", month: "2026-11", hasFile: true });
    expect(result.stored[0].note).toContain("KI nicht verfügbar.");
  });
});

describe("Monatspaket", () => {
  it("enthält alle Dateien des Monats und eine Liste mit fehlenden Belegen", async () => {
    await capture.recordMissingReceipt({
      id: null as unknown as string,
      fromName: "Telko AG",
      fromAddress: "rechnung@telko.example",
      subject: "Ihre Rechnung ist online",
      receivedAt: "2026-10-30T10:00:00Z",
    });
    const { zip, files: count, missing } = await exporter.buildMonthExport("2026-10");
    expect({ count, missing }).toEqual({ count: 1, missing: 1 });
    const entries = unzipSync(zip);
    expect(Object.keys(entries).sort()).toEqual(["2026-10-28_Buero-Mueller-Soehne-GmbH_RE-2026-0815_59,90EUR.pdf", "belege-2026-10.csv"]);
    expect(strFromU8(entries["2026-10-28_Buero-Mueller-Soehne-GmbH_RE-2026-0815_59,90EUR.pdf"])).toBe("%PDF-1.4 papier");
    const csv = strFromU8(entries["belege-2026-10.csv"]);
    // UTF-8 mit BOM, damit Excel Umlaute richtig anzeigt
    expect([...entries["belege-2026-10.csv"].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.replace(/^\uFEFF/, "").startsWith("Datei;Belegdatum;Lieferant")).toBe(true);
    expect(csv).toContain(
      "2026-10-28_Buero-Mueller-Soehne-GmbH_RE-2026-0815_59,90EUR.pdf;2026-10-28;Büro Müller & Söhne GmbH;RE/2026/0815;Rechnung;59,90;49,92;9,98;EUR;;ja;Druckerpapier;Bereit;",
    );
    expect(csv).toMatch(/;;Telko AG;;Rechnung;;;;;;;Ihre Rechnung ist online;Datei fehlt;Rechnung ohne Anhang/);
  });

  it("markiert den Monat als übergeben und löscht Dateien erst nach der Frist", async () => {
    expect(await store.markMonthExported("2026-10", new Date("2026-11-02T10:00:00Z"))).toBe(1);
    expect(await store.purgeExportedFiles(90, new Date("2026-12-01T10:00:00Z"))).toBe(0);
    expect(await store.purgeExportedFiles(90, new Date("2027-02-05T10:00:00Z"))).toBe(1);
    const [receipt] = (await store.listReceipts("2026-10")).filter((r) => r.status === "exportiert");
    expect(receipt).toMatchObject({ hasFile: false, grossCents: 5990, note: "Datei nach der Übergabe an die Buchhaltung gelöscht" });
    expect(await store.purgeExportedFiles(0, new Date("2030-01-01T00:00:00Z"))).toBe(0);
  });
});
