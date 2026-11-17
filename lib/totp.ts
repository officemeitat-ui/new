import { createHmac, randomBytes } from "node:crypto";

// Einmalcodes nach RFC 6238 (TOTP, 30 Sekunden, 6 Stellen) – kompatibel mit Microsoft Authenticator, Google Authenticator,
// Keeper, 1Password usw.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD = 30;

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Ungültiges Base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Neues Geheimnis (160 Bit), Base32 wie von Authenticator-Apps erwartet. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(binary).padStart(6, "0");
}

export const totpStep = (now: Date) => Math.floor(now.getTime() / 1000 / TOTP_PERIOD);

/**
 * Prüft einen Code mit ±1 Zeitfenster Toleranz. Liefert das verwendete Zeitfenster – nur wenn es neuer ist als `lastStep`,
 * damit ein abgefangener Code nicht ein zweites Mal funktioniert.
 */
export function verifyTotp(secret: string, code: string, now: Date, lastStep: number | null = null): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const current = totpStep(now);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (totpCode(secret, step) === clean) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: String(TOTP_PERIOD) });
  return `otpauth://totp/${label}?${params}`;
}
