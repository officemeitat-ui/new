import { Worker } from "node:worker_threads";
import { assertSafePdf, assertSafeZip, BombError } from "./bomb-check";
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

const EXTRACT_WORKER = new URL("./extract-worker.mjs", import.meta.url);
/** Limits for one PDF/DOCX extraction (security review, finding 12). */
export const EXTRACT_LIMITS = { timeoutMs: 60_000, maxHeapMb: 512 };

/**
 * Extracts raw text in a worker thread with a heap limit and a timeout. Out of memory, a crash
 * or a hang end the thread, not the process that also runs other tenants' agents.
 */
function extractIsolated(kind: "pdf" | "docx", bytes: Uint8Array): Promise<string[]> {
  const unreadable =
    kind === "pdf"
      ? "Das PDF konnte nicht gelesen werden."
      : "Das Word-Dokument konnte nicht gelesen werden.";
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(EXTRACT_WORKER, {
      workerData: { kind, bytes },
      resourceLimits: {
        maxOldGenerationSizeMb: EXTRACT_LIMITS.maxHeapMb,
        maxYoungGenerationSizeMb: 64,
      },
    });
    const finish = (error: Error | null, pages?: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(pages ?? []);
    };
    const timer = setTimeout(
      () =>
        finish(
          new ParseError("Das Einlesen hat zu lange gedauert. Die Datei wird nicht verarbeitet."),
        ),
      EXTRACT_LIMITS.timeoutMs,
    );
    worker.once("message", (message: { ok: boolean; pages?: string[]; password?: boolean }) => {
      if (message.ok) finish(null, message.pages);
      else if (message.password && kind === "pdf")
        finish(new ParseError("Das PDF ist passwortgeschützt."));
      else finish(new ParseError(unreadable));
    });
    worker.once("error", (error: Error & { code?: string }) =>
      finish(
        new ParseError(
          error.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? "Die Datei braucht beim Einlesen zu viel Speicher und wird nicht verarbeitet."
            : unreadable,
        ),
      ),
    );
    worker.once("exit", (code) => {
      if (code !== 0) finish(new ParseError(unreadable));
    });
  });
}

/** Measures the real decompressed size first (zip/flate bombs), see bomb-check.ts. */
function assertNoBomb(kind: "pdf" | "docx", bytes: Uint8Array) {
  try {
    if (kind === "docx") assertSafeZip(bytes);
    else assertSafePdf(bytes);
  } catch (error) {
    if (error instanceof BombError) throw new ParseError(error.message);
    throw error;
  }
}

export async function parseDocument(
  kind: KnowledgeKind,
  bytes: Uint8Array,
): Promise<ParsedDocument> {
  switch (kind) {
    case "pdf": {
      assertNoBomb("pdf", bytes);
      const pages = await extractIsolated("pdf", bytes);
      const result = pages.map((text, index) => ({ page: index + 1, text: normalise(text) }));
      if (result.every((p) => p.text.length === 0)) {
        throw new ParseError(
          "Das PDF enthält keinen Text (vermutlich ein Scan). Texterkennung (OCR) folgt später.",
        );
      }
      return { pages: result.filter((p) => p.text.length > 0) };
    }
    case "docx": {
      assertNoBomb("docx", bytes);
      const [value = ""] = await extractIsolated("docx", bytes);
      return { pages: [{ page: null, text: normalise(value) }] };
    }
    case "markdown":
    case "text":
      return {
        pages: [{ page: null, text: normalise(new TextDecoder("utf-8").decode(bytes)) }],
      };
  }
}
