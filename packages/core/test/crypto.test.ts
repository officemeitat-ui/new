import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/crypto";

describe("secret encryption", () => {
  it("round-trips, uses a fresh IV every time and detects tampering", () => {
    const a = encryptSecret("token-id:token-secret");
    const b = encryptSecret("token-id:token-secret");
    expect(a).toMatch(/^v1:/);
    expect(a).not.toBe(b);
    expect(a).not.toContain("token-secret");
    expect(decryptSecret(a)).toBe("token-id:token-secret");

    const raw = Buffer.from(a.slice(3), "base64");
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 0xff, raw.length - 1);
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`)).toThrow();
    expect(() => decryptSecret("v0:abc")).toThrow(/Format/);
  });
});
