import { extractRawText } from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { KnowledgeKind } from "./detect";

/** Text of a document; PDFs keep their page numbers for citations. */
export type ParsedDocument = { pages: { page: number | null; text: string }[] };

export class ParseError extends Error {}

function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v\u00a0]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function parseDocument(
  kind: KnowledgeKind,
  bytes: Uint8Array,
): Promise<ParsedDocument> {
  switch (kind) {
    case "pdf": {
      let pages: string[];
      try {
        // unpdf (pdf.js) – https://github.com/unjs/unpdf
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        pages = (await extractText(pdf, { mergePages: false })).text;
      } catch (error) {
        throw new ParseError(
          error instanceof Error && /password/i.test(error.message)
            ? "Das PDF ist passwortgeschützt."
            : "Das PDF konnte nicht gelesen werden.",
        );
      }
      const result = pages.map((text, index) => ({ page: index + 1, text: normalise(text) }));
      if (result.every((p) => p.text.length === 0)) {
        throw new ParseError(
          "Das PDF enthält keinen Text (vermutlich ein Scan). Texterkennung (OCR) folgt später.",
        );
      }
      return { pages: result.filter((p) => p.text.length > 0) };
    }
    case "docx": {
      try {
        // mammoth – https://github.com/mwilliamson/mammoth.js
        const { value } = await extractRawText({ buffer: Buffer.from(bytes) });
        return { pages: [{ page: null, text: normalise(value) }] };
      } catch {
        throw new ParseError("Das Word-Dokument konnte nicht gelesen werden.");
      }
    }
    case "markdown":
    case "text":
      return {
        pages: [{ page: null, text: normalise(new TextDecoder("utf-8").decode(bytes)) }],
      };
  }
}
