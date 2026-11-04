// Text extraction for PDF and DOCX, run by parse.ts in a worker thread with memory and time
// limits, so a malicious file can only take down this thread – never the shared worker process.
// Plain JavaScript: worker threads start without the TypeScript loader.
import { parentPort, workerData } from "node:worker_threads";
import { extractRawText } from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

const { kind, bytes } = workerData;
try {
  if (kind === "pdf") {
    // unpdf (pdf.js) – https://github.com/unjs/unpdf
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    parentPort.postMessage({ ok: true, pages: text });
  } else {
    // mammoth – https://github.com/mwilliamson/mammoth.js
    const { value } = await extractRawText({ buffer: Buffer.from(bytes) });
    parentPort.postMessage({ ok: true, pages: [value] });
  }
} catch (error) {
  parentPort.postMessage({
    ok: false,
    password: error instanceof Error && /password/i.test(error.message),
  });
}
