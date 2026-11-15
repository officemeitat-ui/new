// Signierte Admin-Session (HMAC-SHA256 über Web Crypto) – nutzbar in proxy.ts und in Server-Code.

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

export async function createSessionToken(): Promise<string> {
  const key = secret();
  if (!key) throw new Error("ADMIN_PASSWORD ist nicht gesetzt");
  const expires = String(Date.now() + SESSION_MAX_AGE * 1000);
  return `${expires}.${await sign(expires, key)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  const key = secret();
  if (!key || !token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = await sign(expires, key);
  // Längenunabhängiger Vergleich ohne frühen Abbruch.
  let diff = expected.length ^ signature.length;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ (signature.charCodeAt(i) || 0);
  }
  return diff === 0;
}
