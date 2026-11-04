import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { unavailable } from "./errors";

/**
 * Encryption of secrets at rest (API keys of connectors): AES-256-GCM with a random IV per value
 * and the owning record as additional authenticated data (AAD), so a ciphertext copied into
 * another company's record does not decrypt (security review 2, finding 11).
 * Format: `v2:` + base64(iv[12] | tag[16] | ciphertext). The version prefix allows key rotation.
 */
const VERSION = "v2";
const IV_BYTES = 12;
const TAG_BYTES = 16;

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

/** `context` names the owner, e.g. `knowledge_source:<tenantId>:<collectionId>`. */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
}

export function decryptSecret(value: string, context: string): string {
  const [version, payload, ...rest] = value.split(":");
  if (version !== VERSION || !payload || rest.length > 0) {
    throw new Error("Unbekanntes Format für gespeicherte Zugangsdaten.");
  }
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_BYTES + TAG_BYTES)
    throw new Error("Gespeicherte Zugangsdaten sind beschädigt.");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, IV_BYTES), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
