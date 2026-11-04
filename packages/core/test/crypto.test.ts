import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/crypto";

const owner = "knowledge_source:tenant-a:collection-1";

describe("secret encryption", () => {
  it("round-trips, uses a fresh IV every time and detects tampering", () => {
    const a = encryptSecret("token-id:token-secret", owner);
    const b = encryptSecret("token-id:token-secret", owner);
    expect(a).toMatch(/^v2:/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("token-secret");
    expect(decryptSecret(a, owner)).toBe("token-id:token-secret");

    const raw = Buffer.from(a.slice(3), "base64");
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1);
    expect(() => decryptSecret(`v2:${raw.toString("base64")}`, owner)).toThrow();
    expect(() => decryptSecret("v1:abc", owner)).toThrow(/Format/);
    expect(() => decryptSecret("v2:AAAA", owner)).toThrow(/beschädigt/);
  });

  it("does not decrypt a secret copied to another owner", () => {
    const value = encryptSecret("api-key", owner);
    expect(() => decryptSecret(value, "knowledge_source:tenant-b:collection-9")).toThrow();
  });
});
