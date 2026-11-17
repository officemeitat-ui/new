// Signierte Cookies (HMAC-SHA256 über Web Crypto) – nutzbar in proxy.ts und in Server-Code.
// Die Sitzung selbst liegt in der Datenbank (widerrufbar); das Cookie trägt nur ihre ID, das Ablaufdatum und die Signatur.

export const SESSION_COOKIE = "admin_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 Tage

function secret(): string | null {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

async function sign(payload: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
  return Buffer.from(signature).toString("base64url");
}

/** Längenunabhängiger Vergleich ohne frühen Abbruch. */
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function createSessionToken(sessionId: string, expiresAt: number): Promise<string> {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET ist nicht gesetzt");
  const payload = `${sessionId}.${expiresAt}`;
  return `${payload}.${await sign(payload, key)}`;
}

/** Prüft Signatur und Ablauf; ob die Sitzung noch gilt (nicht widerrufen), prüft erst der Server-Code gegen die Datenbank. */
export async function readSessionToken(token: string | undefined): Promise<{ sessionId: string; expiresAt: number } | null> {
  const key = secret();
  if (!key || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [sessionId, expires, signature] = parts;
  const expiresAt = Number(expires);
  if (!sessionId || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  return same(await sign(`${sessionId}.${expires}`, key), signature) ? { sessionId, expiresAt } : null;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await readSessionToken(token)) !== null;
}

/** Kurzlebiger, signierter Zustand (z. B. Anmeldeschritt, Microsoft-Anmeldung). Nicht verschlüsselt – nichts Geheimes hineinlegen. */
export async function signState(data: Record<string, unknown>, maxAgeSeconds: number): Promise<string> {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET ist nicht gesetzt");
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + maxAgeSeconds * 1000 })).toString("base64url");
  return `${payload}.${await sign(`state:${payload}`, key)}`;
}

export async function readState<T extends Record<string, unknown>>(token: string | undefined): Promise<T | null> {
  const key = secret();
  if (!key || !token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !same(await sign(`state:${payload}`, key), signature)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T & { exp?: number };
    return typeof data.exp === "number" && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
