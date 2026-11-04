import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { unavailable } from "./errors";

/**
 * Encryption of secrets at rest (API keys of connectors): AES-256-GCM with a random IV per value.
 * Format: `v1:` + base64(iv[12] | tag[16] | ciphertext). The version prefix allows key rotation.
 */
const VERSION = "v1";

/** Reads only what it needs, so it also works where the full environment is not set. */
function key(): Buffer {
  const configured = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (configured) {
    const bytes = Buffer.from(configured, "base64");
    if (bytes.length !== 32)
      throw new Error("DATA_ENCRYPTION_KEY muss 32 Byte (base64) lang sein.");
    return bytes;
  }
  if (process.env.NODE_ENV === "production") {
    // Shown to the admin: the operator (ME-IT) has to set the key.
    throw unavailable(
      "Zugangsdaten können nicht sicher gespeichert werden: Der Betreiber muss DATA_ENCRYPTION_KEY setzen.",
    );
  }
  // Development and tests: derived from the auth secret, never used in production.
  const base = process.env.BETTER_AUTH_SECRET || "development-secret-change-me-0000000000";
  return createHash("sha256").update(`nexus:data-encryption:${base}`).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

export function decryptSecret(value: string): string {
  const [version, payload] = value.split(":", 2);
  if (version !== VERSION || !payload)
    throw new Error("Unbekanntes Format für gespeicherte Zugangsdaten.");
  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
