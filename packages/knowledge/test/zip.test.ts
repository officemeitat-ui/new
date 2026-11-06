import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assertSafeZip } from "../src/bomb-check";
import { createZip } from "../src/zip";

/** Reads entries back through the central directory, as unzip programs do. */
function readZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries: { path: string; text: string; flags: number }[] = [];
  for (let n = 0; n < count; n++) {
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const crc = zip.readUInt32LE(offset + 16);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const local = zip.readUInt32LE(offset + 42);
    const path = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    const content = method === 8 ? inflateRawSync(data) : data;
    expect(crc32(content)).toBe(crc);
    entries.push({ path, text: content.toString("utf8"), flags });
    offset += 46 + nameLength;
  }
  return entries;
}

describe("ZIP export", () => {
  it("writes Markdown files with UTF-8 names that unzip again", () => {
    const zip = createZip([
      {
        path: "Firewalls/Securepoint Update.md",
        content: Buffer.from("# Update\n\n" + "Backup ziehen. ".repeat(50)),
      },
      { path: "Drucker – HP Störung.md", content: Buffer.from("Toner prüfen, Schutzstreifen ab.") },
    ]);
    expect(() => assertSafeZip(new Uint8Array(zip))).not.toThrow();
    const entries = readZip(zip);
    expect(entries.map((e) => e.path)).toEqual([
      "Firewalls/Securepoint Update.md",
      "Drucker – HP Störung.md",
    ]);
    expect(entries[0]!.text).toContain("Backup ziehen.");
    expect(entries[1]!.text).toBe("Toner prüfen, Schutzstreifen ab.");
    expect(entries.every((e) => (e.flags & 0x0800) !== 0)).toBe(true);
  });
});
