import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkDocument, detectKind, parseDocument, ParseError } from "../src";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));
const text = (value: string) => new TextEncoder().encode(value);

describe("detectKind", () => {
  it("checks extension and content", () => {
    expect(detectKind("Preisliste.PDF", fixture("preisliste.pdf"))).toBe("pdf");
    expect(detectKind("urlaub.docx", fixture("urlaub.docx"))).toBe("docx");
    expect(detectKind("notiz.md", text("# Titel\n\nÄnderung"))).toBe("markdown");
    expect(detectKind("notiz.txt", text("Grüß Gott"))).toBe("text");
  });

  it("rejects disguised and unsupported files", () => {
    expect(detectKind("rechnung.pdf", text("kein pdf"))).toBeNull();
    expect(detectKind("bild.txt", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]))).toBeNull();
    expect(detectKind("tabelle.xlsx", fixture("urlaub.docx"))).toBeNull();
    expect(detectKind("programm.exe", text("MZ"))).toBeNull();
  });

  it("accepts text whose sample ends inside a multi-byte character", () => {
    const bytes = text(`${"a".repeat(4095)}ä`); // "ä" is two bytes, cut at byte 4096
    expect(detectKind("lang.txt", bytes)).toBe("text");
  });
});

describe("parseDocument", () => {
  it("reads PDF text page by page", async () => {
    const parsed = await parseDocument("pdf", fixture("preisliste.pdf"));
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[0]).toMatchObject({ page: 1 });
    expect(parsed.pages[0]!.text).toContain("Wartung Gastherme: 189 Euro");
    expect(parsed.pages[1]!.text).toContain("innerhalb von 14 Tagen");
  });

  it("reads Word documents", async () => {
    const parsed = await parseDocument("docx", fixture("urlaub.docx"));
    expect(parsed.pages[0]!.text).toContain("Urlaub beantragen Sie im Personalportal");
    expect(parsed.pages[0]!.text).toContain("Über Ausnahmen");
  });

  it("explains unreadable PDFs", async () => {
    await expect(parseDocument("pdf", text("%PDF-1.4 kaputt"))).rejects.toBeInstanceOf(ParseError);
  });
});

describe("chunkDocument", () => {
  it("keeps page numbers and never spans pages", () => {
    const chunks = chunkDocument({
      pages: [
        { page: 1, text: "Seite eins." },
        { page: 2, text: "Seite zwei." },
      ],
    });
    expect(chunks.map((c) => [c.seq, c.page, c.text])).toEqual([
      [1, 1, "Seite eins."],
      [2, 2, "Seite zwei."],
    ]);
  });

  it("tracks Markdown headings and starts a chunk per section", () => {
    const chunks = chunkDocument({
      pages: [
        {
          page: null,
          text: "Einleitung ohne Überschrift.\n\n## Öffnungszeiten\n\nMo–Fr 8–17 Uhr.\n\n## Anfahrt\n\nParkplätze im Hof.",
        },
      ],
    });
    expect(chunks.map((c) => [c.heading, c.text])).toEqual([
      [null, "Einleitung ohne Überschrift."],
      ["Öffnungszeiten", "Mo–Fr 8–17 Uhr."],
      ["Anfahrt", "Parkplätze im Hof."],
    ]);
  });

  it("splits long text with overlap and respects the size limit", () => {
    const sentence = "Die Wartung umfasst Brenner, Abgasmessung und Sichtprüfung. ";
    const chunks = chunkDocument(
      {
        pages: [
          { page: null, text: Array.from({ length: 12 }, () => sentence.repeat(3)).join("\n\n") },
        ],
      },
      { maxChars: 400, overlap: 60 },
    );
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(400 + 60 + 2);
    // The start of each chunk repeats the end of the previous one.
    const end = chunks[0]!.text.slice(-30);
    expect(chunks[1]!.text).toContain(end.slice(end.indexOf(" ") + 1));
  });

  it("returns nothing for empty documents", () => {
    expect(chunkDocument({ pages: [{ page: null, text: "  " }] })).toEqual([]);
  });
});
