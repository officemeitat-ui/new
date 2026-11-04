import { deflateRawSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assertSafePdf, assertSafeZip, BombError } from "../src/bomb-check";
import { parseDocument, ParseError } from "../src/parse";

/** A minimal ZIP archive (what a DOCX is) with deflated entries. */
function zip(entries: { name: string; content: Buffer }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = deflateRawSync(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    // Lies about the size, as bombs do: the check must measure, not trust this.
    local.writeUInt32LE(1024, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(1024, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const zeros = (megabytes: number) => Buffer.alloc(megabytes * 1024 * 1024);

describe("decompression bombs (security review, finding 12)", () => {
  it("measures the real size of every ZIP entry", () => {
    const small = zip([{ name: "word/document.xml", content: Buffer.from("<w:document/>") }]);
    expect(() => assertSafeZip(small)).not.toThrow();
    const big = zip([{ name: "word/document.xml", content: zeros(5) }]);
    expect(() => assertSafeZip(big, 1024 * 1024)).toThrow(BombError);
    expect(() => assertSafeZip(new Uint8Array([1, 2, 3]))).toThrow(/beschädigt/);
  });

  it("refuses a Word file that expands to 250 MB before parsing it", async () => {
    const bomb = zip([{ name: "word/document.xml", content: zeros(250) }]);
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    await expect(parseDocument("docx", bomb)).rejects.toThrow(/zu groß/);
    await expect(parseDocument("docx", bomb)).rejects.toBeInstanceOf(ParseError);
  });

  it("refuses a PDF whose streams expand to 250 MB", async () => {
    const stream = deflateSync(zeros(250));
    const pdf = Buffer.concat([
      Buffer.from(
        `%PDF-1.4\n1 0 obj\n<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`,
      ),
      stream,
      Buffer.from("\nendstream\nendobj\n%%EOF\n"),
    ]);
    expect(() => assertSafePdf(new Uint8Array(pdf), 1024 * 1024)).toThrow(BombError);
    await expect(parseDocument("pdf", new Uint8Array(pdf))).rejects.toThrow(/zu groß/);
  });
});
