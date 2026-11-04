import { inflateRawSync, inflateSync } from "node:zlib";

/**
 * Protection against decompression bombs (security review, finding 12): a 10 MB DOCX or PDF
 * can expand to many gigabytes. Before a parser sees the file, its compressed parts are inflated
 * once with a hard output limit (zlib `maxOutputLength`), so the real size is measured, not the
 * size the file claims.
 */

/** Total decompressed size we accept for one document. */
export const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;

export class BombError extends Error {}

const tooLarge = () =>
  new BombError("Die Datei wird beim Entpacken zu groß und wird deshalb nicht verarbeitet.");

const isOutputLimit = (error: unknown) =>
  error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE";

/**
 * DOCX is a ZIP archive: walks the central directory and inflates every entry with the remaining
 * budget. ZIP64, encryption and unknown compression methods are refused (Word never needs them
 * for files up to 10 MB).
 */
export function assertSafeZip(bytes: Uint8Array, budget = MAX_DECOMPRESSED_BYTES): void {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const broken = () => new BombError("Das Word-Dokument ist beschädigt.");

  // End of central directory: signature 0x06054b50 within the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw broken();
  const entries = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff) throw broken(); // ZIP64
  if (entries > 10_000) throw tooLarge();

  let remaining = budget;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) throw broken();
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    if (flags & 0x1) throw broken(); // encrypted
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) throw broken();

    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) {
      throw broken();
    }
    const start =
      localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
    const end = start + compressedSize;
    if (end > data.length) throw broken();
    const compressed = data.subarray(start, end);

    let size: number;
    if (method === 0) {
      size = compressed.length;
    } else if (method === 8) {
      try {
        size = inflateRawSync(compressed, { maxOutputLength: Math.max(1, remaining) }).length;
      } catch (error) {
        if (isOutputLimit(error)) throw tooLarge();
        throw broken();
      }
    } else {
      throw broken();
    }
    remaining -= size;
    if (remaining < 0) throw tooLarge();
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

/**
 * PDF: inflates every FlateDecode stream with the remaining budget. Streams with other filters
 * (images such as DCT) are not decoded by text extraction and are skipped here.
 */
export function assertSafePdf(bytes: Uint8Array, budget = MAX_DECOMPRESSED_BYTES): void {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let remaining = budget;
  let position = 0;
  while (true) {
    const marker = data.indexOf("stream", position, "latin1");
    if (marker < 0) return;
    position = marker + 6;
    // "endstream" contains "stream" too; skip it.
    if (marker >= 3 && data.toString("latin1", marker - 3, marker) === "end") continue;
    // The stream dictionary ends right before the keyword; look back for its filter.
    const dictionary = data.toString("latin1", Math.max(0, marker - 512), marker);
    const filters = dictionary.slice(dictionary.lastIndexOf("<<"));
    let start = position;
    if (data[start] === 0x0d) start++;
    if (data[start] === 0x0a) start++;
    const end = data.indexOf("endstream", start, "latin1");
    if (end < 0) return;
    position = end + 9;
    if (!/\/FlateDecode/.test(filters)) continue;
    try {
      remaining -= inflateSync(data.subarray(start, end), {
        maxOutputLength: Math.max(1, remaining),
        finishFlush: 2, // Z_SYNC_FLUSH: tolerate streams without a proper end
      }).length;
    } catch (error) {
      if (isOutputLimit(error)) throw tooLarge();
      // A damaged stream is the parser's problem, not a bomb.
    }
    if (remaining < 0) throw tooLarge();
  }
}
