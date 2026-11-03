import type { ParsedDocument } from "./parse";

export type Chunk = {
  seq: number;
  page: number | null;
  /** Nearest Markdown heading above the chunk – helps search and citations. */
  heading: string | null;
  text: string;
};

export type ChunkOptions = {
  /** Target size in characters (roughly 300 tokens of German text). */
  maxChars?: number;
  /** Characters repeated from the end of the previous chunk, so facts are not cut apart. */
  overlap?: number;
};

const HEADING = /^#{1,6}\s+(.+?)\s*#*$/;

/** Splits a paragraph that is longer than maxChars at sentence ends, then at spaces. */
function splitLong(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+[.!?]+["“”)]*\s*|[^.!?]+$/g) ?? [paragraph];
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars && current) {
      parts.push(current.trim());
      current = "";
    }
    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars)
        parts.push(sentence.slice(i, i + maxChars).trim());
    } else {
      current += sentence;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function tail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return "";
  const cut = text.slice(-overlap);
  const space = cut.indexOf(" ");
  return space >= 0 ? cut.slice(space + 1) : cut;
}

/**
 * Paragraph-aware chunking. Chunks never span pages, so every chunk has one page for its
 * citation; headings are tracked and carried into the following chunks.
 */
export function chunkDocument(document: ParsedDocument, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? 1200;
  const overlap = options.overlap ?? 150;
  const chunks: Chunk[] = [];
  let heading: string | null = null;

  for (const { page, text } of document.pages) {
    let current = "";
    let currentHeading = heading;
    const flush = () => {
      const trimmed = current.trim();
      if (trimmed)
        chunks.push({ seq: chunks.length + 1, page, heading: currentHeading, text: trimmed });
      current = "";
    };

    for (const block of text.split(/\n{2,}/)) {
      const paragraph = block.trim();
      if (!paragraph) continue;
      const match = HEADING.exec(paragraph.split("\n")[0]!);
      if (match) {
        // A new section starts a new chunk.
        flush();
        heading = match[1]!;
        currentHeading = heading;
        const rest = paragraph.split("\n").slice(1).join("\n").trim();
        if (!rest) continue;
        current = rest;
        continue;
      }
      for (const part of splitLong(paragraph, maxChars)) {
        if (current && current.length + part.length + 2 > maxChars) {
          const carried = tail(current, overlap);
          flush();
          current = carried;
        }
        current = current ? `${current}\n\n${part}` : part;
      }
    }
    flush();
  }
  return chunks;
}
