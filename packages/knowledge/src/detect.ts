/**
 * File types the knowledge base accepts. Detection uses the file name and the first bytes,
 * never the browser's MIME type alone (it can be missing or wrong).
 */
export const KNOWLEDGE_KINDS = ["pdf", "docx", "markdown", "text"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const MIME_TYPES: Record<KnowledgeKind, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  markdown: "text/markdown",
  text: "text/plain",
};

/** For the file picker. */
export const ACCEPT = ".pdf,.docx,.md,.markdown,.txt";

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((value, index) => bytes[index] === value);

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, lastCompleteUtf8(sample)));
    return true;
  } catch {
    return false;
  }
}

/** Index after the last complete UTF-8 sequence, so a cut-off character is not an error. */
function lastCompleteUtf8(bytes: Uint8Array): number {
  const end = bytes.length;
  for (let i = Math.max(0, end - 3); i < end; i++) {
    const byte = bytes[i]!;
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    if (length > 1 && i + length > end) return i;
  }
  return end;
}

/** Returns the kind, or null if the file is not supported. */
export function detectKind(fileName: string, bytes: Uint8Array): KnowledgeKind | null {
  const extension = fileName.toLowerCase().split(".").at(-1) ?? "";
  if (extension === "pdf") return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) ? "pdf" : null; // %PDF
  if (extension === "docx") return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ? "docx" : null; // ZIP
  if (extension === "md" || extension === "markdown")
    return looksLikeText(bytes) ? "markdown" : null;
  if (extension === "txt") return looksLikeText(bytes) ? "text" : null;
  return null;
}
