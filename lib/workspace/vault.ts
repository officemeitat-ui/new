import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { db } from "@/lib/db";

// Doku-Tresor: Die Kunden-Dokumentation liegt verschlüsselt in der Datenbank (AES-256-GCM).
// Der Datenschlüssel wird nur mit dem Doku-Passwort (oder dem Wiederherstellungsschlüssel) entschlüsselt – er steht nirgends im Klartext.
// Eine gestohlene Datenbank oder Sicherung ist ohne Passwort wertlos. Nach dem Entsperren liegt der Schlüssel befristet,
// selbst verschlüsselt, in einem Cookie nur dieses Browsers.

export const VAULT_COOKIE = "doku_tresor";
const PREFIX = "enc1:";
const SCRYPT: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class VaultLockedError extends Error {
  constructor() {
    super("Die Dokumentation ist gesperrt – bitte mit dem Doku-Passwort entsperren.");
  }
}

function scrypt(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(secret.normalize("NFKC"), salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

function encrypt(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

function decrypt(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

// ── Werte ver- und entschlüsseln ──

/** Verschlüsselt einen Text; ohne Schlüssel (Tresor nicht eingerichtet) bleibt er unverändert. */
export function seal(key: Buffer | null, value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!key) return value;
  return PREFIX + encrypt(key, Buffer.from(value, "utf8")).toString("base64");
}

/** Entschlüsselt einen Text; unverschlüsselte (alte) Werte kommen unverändert zurück. */
export function unseal(key: Buffer | null, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text.startsWith(PREFIX)) return text;
  if (!key) throw new VaultLockedError();
  return decrypt(key, Buffer.from(text.slice(PREFIX.length), "base64")).toString("utf8");
}

export const isSealed = (value: unknown) => typeof value === "string" && value.startsWith(PREFIX);

// ── Tresor einrichten und entsperren ──

type VaultRow = { salt: string; wrapped: string; recoverySalt: string; recoveryWrapped: string };

async function readVault(): Promise<VaultRow | null> {
  const client = await db();
  const row = (await client.execute("SELECT salt, wrapped, recovery_salt, recovery_wrapped FROM vault WHERE id = 'doku'")).rows[0];
  return row
    ? {
        salt: String(row.salt),
        wrapped: String(row.wrapped),
        recoverySalt: String(row.recovery_salt),
        recoveryWrapped: String(row.recovery_wrapped),
      }
    : null;
}

const globalVault = globalThis as unknown as { vaultConfigured?: boolean };

export async function vaultConfigured(): Promise<boolean> {
  if (globalVault.vaultConfigured) return true;
  const configured = (await readVault()) !== null;
  if (configured) globalVault.vaultConfigured = true;
  return configured;
}

/** Wiederherstellungsschlüssel im Format XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (ohne verwechselbare Zeichen). */
function newRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(24);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

const normalizeRecovery = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Richtet den Tresor ein: neuer Datenschlüssel, geschützt durch Passwort und Wiederherstellungsschlüssel.
 * migrate verschlüsselt anschließend alle vorhandenen Doku-Daten. Liefert Schlüssel und Wiederherstellungscode (nur einmal anzeigen).
 */
export async function setupVault(
  password: string,
  migrate: (key: Buffer) => Promise<unknown>,
  now = new Date(),
): Promise<{ key: Buffer; recoveryCode: string }> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Das Doku-Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen`);
  if (await vaultConfigured()) throw new Error("Der Tresor ist bereits eingerichtet");
  const key = randomBytes(32);
  const recoveryCode = newRecoveryCode();
  const salt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const wrapped = encrypt(await scrypt(password, salt), key);
  const recoveryWrapped = encrypt(await scrypt(normalizeRecovery(recoveryCode), recoverySalt), key);
  // Zuerst die Daten verschlüsseln, dann den Tresor speichern: bricht etwas ab, bleibt alles lesbar.
  await migrate(key);
  const client = await db();
  await client.execute({
    sql: "INSERT INTO vault (id, salt, wrapped, recovery_salt, recovery_wrapped, created_at) VALUES ('doku', ?, ?, ?, ?, ?)",
    args: [
      salt.toString("base64"),
      wrapped.toString("base64"),
      recoverySalt.toString("base64"),
      recoveryWrapped.toString("base64"),
      now.toISOString(),
    ],
  });
  globalVault.vaultConfigured = true;
  return { key, recoveryCode };
}

/** Prüft Passwort oder Wiederherstellungsschlüssel und liefert den Datenschlüssel – oder null. */
export async function unlockVault(secret: string): Promise<Buffer | null> {
  const vault = await readVault();
  if (!vault || !secret) return null;
  const attempts: [string, string, string][] = [[secret, vault.salt, vault.wrapped]];
  if (/^[A-Za-z0-9]{4}(-?[A-Za-z0-9]{4}){5}$/.test(secret.trim()))
    attempts.push([normalizeRecovery(secret), vault.recoverySalt, vault.recoveryWrapped]);
  for (const [value, salt, wrapped] of attempts) {
    try {
      return decrypt(await scrypt(value, Buffer.from(salt, "base64")), Buffer.from(wrapped, "base64"));
    } catch {
      // falsches Passwort → Prüfsumme passt nicht
    }
  }
  return null;
}

/** Neues Doku-Passwort setzen (Tresor muss entsperrt sein). Der Wiederherstellungsschlüssel bleibt gültig. */
export async function changeVaultPassword(key: Buffer, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Das Doku-Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen`);
  const salt = randomBytes(16);
  const client = await db();
  await client.execute({
    sql: "UPDATE vault SET salt = ?, wrapped = ? WHERE id = 'doku'",
    args: [salt.toString("base64"), encrypt(await scrypt(password, salt), key).toString("base64")],
  });
}

// ── Entsperrt-Status im Browser ──

function cookieKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error("SESSION_SECRET bzw. ADMIN_PASSWORD ist nicht gesetzt");
  return Buffer.from(hkdfSync("sha256", secret, "doku-tresor", "cookie", 32));
}

/** Cookie-Inhalt: Datenschlüssel mit Ablaufzeit, verschlüsselt mit einem aus dem Session-Geheimnis abgeleiteten Schlüssel. */
export function unlockToken(key: Buffer, minutes: number, now = Date.now()): string {
  const payload = Buffer.concat([Buffer.alloc(8), key]);
  payload.writeBigUInt64BE(BigInt(now + minutes * 60_000));
  return encrypt(cookieKey(), payload).toString("base64url");
}

export function keyFromToken(token: string | undefined, now = Date.now()): Buffer | null {
  if (!token) return null;
  try {
    const payload = decrypt(cookieKey(), Buffer.from(token, "base64url"));
    if (payload.length !== 40 || Number(payload.readBigUInt64BE(0)) < now) return null;
    return payload.subarray(8);
  } catch {
    return null;
  }
}

const explicitKey = new AsyncLocalStorage<Buffer | null>();

/** Führt fn mit einem bestimmten Schlüssel aus (z. B. direkt nach dem Einrichten oder in Tests). */
export function runWithDocKey<T>(key: Buffer | null, fn: () => Promise<T>): Promise<T> {
  return explicitKey.run(key, fn);
}

/**
 * Schlüssel für den aktuellen Zugriff: null, solange der Tresor nicht eingerichtet ist (Daten im Klartext);
 * sonst der entsperrte Schlüssel – oder VaultLockedError.
 */
export async function docKey(): Promise<Buffer | null> {
  const explicit = explicitKey.getStore();
  if (explicit !== undefined) return explicit;
  if (!(await vaultConfigured())) return null;
  let token: string | undefined;
  try {
    const { cookies } = await import("next/headers");
    token = (await cookies()).get(VAULT_COOKIE)?.value;
  } catch {
    token = undefined; // außerhalb einer Anfrage (z. B. Cron) gibt es keinen entsperrten Zustand
  }
  const key = keyFromToken(token);
  if (!key) throw new VaultLockedError();
  return key;
}

/** Ist die Doku gerade lesbar? */
export async function docAccess(): Promise<"offen" | "entsperrt" | "gesperrt"> {
  if (!(await vaultConfigured())) return "offen";
  try {
    await docKey();
    return "entsperrt";
  } catch (error) {
    if (error instanceof VaultLockedError) return "gesperrt";
    throw error;
  }
}
