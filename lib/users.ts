import "server-only";
import { createHash, hkdfSync, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { newTotpSecret, verifyTotp } from "@/lib/totp";
import { seal, unseal } from "@/lib/workspace/vault";

// Benutzerkonten des Arbeitsplatzes: Inhaber/in und Technik. Anmeldung mit Microsoft (Entra ID, MFA über Conditional Access)
// oder lokal mit Passwort + Einmalcode (TOTP) – ohne zweiten Faktor gibt es keine Sitzung.

export type Role = "inhaber" | "technik";
export const ROLE_LABELS: Record<Role, string> = { inhaber: "Inhaber/in (alles)", technik: "Technik (Arbeitsplatz, ohne Büro)" };
export const MIN_USER_PASSWORD = 12;

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  hasPassword: boolean;
  totpEnabled: boolean;
  entraLinked: boolean;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type SessionMethod = "passwort+code" | "microsoft" | "wiederherstellung";
export type Session = {
  id: string;
  method: SessionMethod;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
};

const SESSION_DAYS = 7;
const IDLE_HOURS = 24;
const LOCK_AFTER_FAILURES = 5;
const LOCK_MINUTES = 15;

const row = (r: Record<string, unknown>): User => ({
  id: String(r.id),
  email: String(r.email),
  name: String(r.name),
  role: r.role === "inhaber" ? "inhaber" : "technik",
  hasPassword: Boolean(r.password_hash),
  totpEnabled: Boolean(r.totp_enabled_at),
  entraLinked: Boolean(r.entra_oid),
  disabled: Boolean(r.disabled_at),
  lastLoginAt: (r.last_login_at as string | null) ?? null,
  createdAt: String(r.created_at),
});

/** Schlüssel für Geheimnisse, die der Server selbst lesen muss (TOTP, Microsoft-Token). Abgeleitet aus SESSION_SECRET. */
function serverKey(purpose: string): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error("SESSION_SECRET ist nicht gesetzt");
  return Buffer.from(hkdfSync("sha256", secret, "arbeitsplatz", purpose, 32));
}

export const sealServer = (purpose: string, value: string) => seal(serverKey(purpose), value)!;
export const unsealServer = (purpose: string, value: unknown) => unseal(serverKey(purpose), value);

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizeEmail = (email: string) => email.trim().toLowerCase();

// ── Passwörter (scrypt) ──

function scrypt(password: string, salt: Buffer, N: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(password.normalize("NFKC"), salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const N = 2 ** 15;
  return `scrypt$${N}$${salt.toString("base64")}$${(await scrypt(password, salt, N)).toString("base64")}`;
}

export async function passwordValid(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Gleiche Laufzeit wie bei einem echten Konto – verrät nicht, ob es die Adresse gibt.
    await scrypt(password, Buffer.alloc(16), 2 ** 15);
    return false;
  }
  const [scheme, n, salt, hash] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), Number(n));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ── Konten ──

export async function countUsers(): Promise<number> {
  const result = await (await db()).execute("SELECT COUNT(*) AS n FROM users");
  return Number(result.rows[0].n);
}

export async function listUsers(): Promise<User[]> {
  const result = await (await db()).execute("SELECT * FROM users ORDER BY role, name");
  return result.rows.map((r) => row(r as Record<string, unknown>));
}

export async function getUser(id: string): Promise<User | null> {
  const result = await (await db()).execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return result.rows[0] ? row(result.rows[0] as Record<string, unknown>) : null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const result = await (await db()).execute({ sql: "SELECT * FROM users WHERE email = ?", args: [normalizeEmail(email)] });
  return result.rows[0] ? row(result.rows[0] as Record<string, unknown>) : null;
}

export async function createUser(
  input: { email: string; name: string; role: Role; password?: string | null },
  now = new Date(),
): Promise<User> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben");
  if (!input.name.trim()) throw new Error("Bitte einen Namen angeben");
  if (input.password && input.password.length < MIN_USER_PASSWORD) throw new Error(`Passwort: mindestens ${MIN_USER_PASSWORD} Zeichen`);
  if (await findUserByEmail(email)) throw new Error("Für diese Adresse gibt es schon ein Konto");
  const id = randomUUID();
  await (
    await db()
  ).execute({
    sql: "INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [id, email, input.name.trim(), input.role, input.password ? await hashPassword(input.password) : null, now.toISOString()],
  });
  return (await getUser(id))!;
}

export async function updateUser(id: string, fields: { name?: string; role?: Role; disabled?: boolean }, now = new Date()) {
  const client = await db();
  if (fields.role === "technik" || fields.disabled) {
    // Es muss immer mindestens ein aktives Inhaber-Konto geben.
    const owners = await client.execute({
      sql: "SELECT COUNT(*) AS n FROM users WHERE role = 'inhaber' AND disabled_at IS NULL AND id != ?",
      args: [id],
    });
    const target = await getUser(id);
    if (target?.role === "inhaber" && Number(owners.rows[0].n) === 0)
      throw new Error("Das letzte Inhaber-Konto kann nicht entzogen werden");
  }
  if (fields.name !== undefined) await client.execute({ sql: "UPDATE users SET name = ? WHERE id = ?", args: [fields.name.trim(), id] });
  if (fields.role) await client.execute({ sql: "UPDATE users SET role = ? WHERE id = ?", args: [fields.role, id] });
  if (fields.disabled !== undefined) {
    await client.execute({ sql: "UPDATE users SET disabled_at = ? WHERE id = ?", args: [fields.disabled ? now.toISOString() : null, id] });
    if (fields.disabled) await revokeAllSessions(id, undefined, now);
  }
}

export async function setPassword(id: string, password: string) {
  if (password.length < MIN_USER_PASSWORD) throw new Error(`Bitte mindestens ${MIN_USER_PASSWORD} Zeichen – am besten ein Satz`);
  await (await db()).execute({ sql: "UPDATE users SET password_hash = ? WHERE id = ?", args: [await hashPassword(password), id] });
}

export async function checkPassword(email: string, password: string): Promise<User | null> {
  const result = await (await db()).execute({ sql: "SELECT * FROM users WHERE email = ?", args: [normalizeEmail(email)] });
  const r = result.rows[0] as Record<string, unknown> | undefined;
  const ok = await passwordValid(password, (r?.password_hash as string | null) ?? null);
  if (!ok || !r || r.disabled_at) return null;
  return row(r);
}

// ── Zweiter Faktor (TOTP) ──

/** Legt ein neues (noch nicht aktives) TOTP-Geheimnis an und gibt es für den QR-Code zurück. */
export async function startTotpSetup(userId: string): Promise<string> {
  const secret = newTotpSecret();
  await (
    await db()
  ).execute({
    sql: "UPDATE users SET totp_secret = ?, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?",
    args: [sealServer("totp", secret), userId],
  });
  return secret;
}

export async function pendingTotpSecret(userId: string): Promise<string | null> {
  const result = await (await db()).execute({ sql: "SELECT totp_secret, totp_enabled_at FROM users WHERE id = ?", args: [userId] });
  const r = result.rows[0];
  if (!r || r.totp_enabled_at || !r.totp_secret) return null;
  return unsealServer("totp", r.totp_secret);
}

function newRecoveryCodes(): string[] {
  return Array.from({ length: 8 }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Bestätigt die Einrichtung mit dem ersten Code. Liefert Wiederherstellungscodes (nur jetzt im Klartext). */
export async function confirmTotpSetup(userId: string, code: string, now = new Date()): Promise<string[] | null> {
  const secret = await pendingTotpSecret(userId);
  if (!secret) return null;
  const step = verifyTotp(secret, code, now);
  if (step === null) return null;
  const codes = newRecoveryCodes();
  await (
    await db()
  ).execute({
    sql: "UPDATE users SET totp_enabled_at = ?, totp_last_step = ?, recovery_codes = ? WHERE id = ?",
    args: [now.toISOString(), step, JSON.stringify(codes.map((c) => sha256(c))), userId],
  });
  return codes;
}

/** Prüft einen Einmalcode oder einen Wiederherstellungscode (der danach verbraucht ist). */
export async function verifySecondFactor(userId: string, input: string, now = new Date()): Promise<"code" | "wiederherstellung" | null> {
  const client = await db();
  const result = await client.execute({
    sql: "SELECT totp_secret, totp_enabled_at, totp_last_step, recovery_codes FROM users WHERE id = ?",
    args: [userId],
  });
  const r = result.rows[0];
  if (!r || !r.totp_enabled_at) return null;
  const secret = unsealServer("totp", r.totp_secret);
  const step = secret ? verifyTotp(secret, input, now, r.totp_last_step === null ? null : Number(r.totp_last_step)) : null;
  if (step !== null) {
    await client.execute({ sql: "UPDATE users SET totp_last_step = ? WHERE id = ?", args: [step, userId] });
    return "code";
  }
  const normalized = input
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");
  if (normalized.length !== 10) return null;
  const hashes = JSON.parse(String(r.recovery_codes ?? "[]")) as string[];
  const hash = sha256(`${normalized.slice(0, 5)}-${normalized.slice(5)}`);
  if (!hashes.includes(hash)) return null;
  await client.execute({
    sql: "UPDATE users SET recovery_codes = ? WHERE id = ?",
    args: [JSON.stringify(hashes.filter((h) => h !== hash)), userId],
  });
  return "wiederherstellung";
}

/** Neue Wiederherstellungscodes (die alten werden ungültig). Nur nach Prüfung eines aktuellen Codes aufrufen. */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await (
    await db()
  ).execute({ sql: "UPDATE users SET recovery_codes = ? WHERE id = ?", args: [JSON.stringify(codes.map((c) => sha256(c))), userId] });
  return codes;
}

export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const result = await (await db()).execute({ sql: "SELECT recovery_codes FROM users WHERE id = ?", args: [userId] });
  return (JSON.parse(String(result.rows[0]?.recovery_codes ?? "[]")) as string[]).length;
}

/** Zweiten Faktor zurücksetzen (z. B. Handy verloren) – bei der nächsten Anmeldung wird er neu eingerichtet. */
export async function resetSecondFactor(userId: string, now = new Date()) {
  await (
    await db()
  ).execute({
    sql: "UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = NULL WHERE id = ?",
    args: [userId],
  });
  await revokeAllSessions(userId, undefined, now);
}

// ── Microsoft (Entra ID) ──

/** Findet das Konto zur Microsoft-Anmeldung: zuerst über die feste Objekt-ID, beim ersten Mal über die E-Mail-Adresse. */
export async function userForMicrosoft(oid: string, email: string | null): Promise<User | null> {
  const client = await db();
  const byOid = await client.execute({ sql: "SELECT * FROM users WHERE entra_oid = ?", args: [oid] });
  if (byOid.rows[0]) return row(byOid.rows[0] as Record<string, unknown>);
  if (!email) return null;
  const byEmail = await client.execute({ sql: "SELECT * FROM users WHERE email = ? AND entra_oid IS NULL", args: [normalizeEmail(email)] });
  if (!byEmail.rows[0]) return null;
  const user = row(byEmail.rows[0] as Record<string, unknown>);
  await client.execute({ sql: "UPDATE users SET entra_oid = ? WHERE id = ?", args: [oid, user.id] });
  return { ...user, entraLinked: true };
}

export async function saveMicrosoftToken(userId: string, refreshToken: string, scope: string | null, now = new Date()) {
  await (
    await db()
  ).execute({
    sql: `INSERT INTO user_tokens (user_id, refresh_token, scope, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET refresh_token = excluded.refresh_token, scope = excluded.scope, updated_at = excluded.updated_at`,
    args: [userId, sealServer("microsoft-token", refreshToken), scope, now.toISOString()],
  });
}

export async function microsoftRefreshToken(userId: string): Promise<string | null> {
  const result = await (await db()).execute({ sql: "SELECT refresh_token FROM user_tokens WHERE user_id = ?", args: [userId] });
  return result.rows[0] ? unsealServer("microsoft-token", result.rows[0].refresh_token) : null;
}

export async function forgetMicrosoftToken(userId: string) {
  await (await db()).execute({ sql: "DELETE FROM user_tokens WHERE user_id = ?", args: [userId] });
}

// ── Sitzungen ──

export async function createSession(
  userId: string,
  method: SessionMethod,
  client: { ip: string | null; userAgent: string | null },
  now = new Date(),
): Promise<{ id: string; expiresAt: number }> {
  const id = randomBytes(24).toString("base64url");
  const expiresAt = now.getTime() + SESSION_DAYS * 86_400_000;
  const conn = await db();
  await conn.execute({
    sql: "INSERT INTO sessions (id, user_id, method, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      sha256(id),
      userId,
      method,
      now.toISOString(),
      now.toISOString(),
      new Date(expiresAt).toISOString(),
      client.ip,
      client.userAgent?.slice(0, 300) ?? null,
    ],
  });
  await conn.execute({ sql: "UPDATE users SET last_login_at = ? WHERE id = ?", args: [now.toISOString(), userId] });
  return { id, expiresAt };
}

/** Liefert Konto und Sitzung, wenn die Sitzung gilt (nicht widerrufen, nicht abgelaufen, nicht zu lange ungenutzt, Konto aktiv). */
export async function sessionUser(sessionId: string, now = new Date()): Promise<{ user: User; session: Session } | null> {
  const conn = await db();
  const result = await conn.execute({
    sql: `SELECT s.id AS sid, s.method, s.created_at AS s_created, s.last_seen_at, s.expires_at, s.ip, s.user_agent, s.revoked_at, u.*
          FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    args: [sha256(sessionId)],
  });
  const r = result.rows[0] as Record<string, unknown> | undefined;
  if (!r || r.revoked_at || r.disabled_at) return null;
  if (new Date(String(r.expires_at)).getTime() < now.getTime()) return null;
  const lastSeen = new Date(String(r.last_seen_at)).getTime();
  if (now.getTime() - lastSeen > IDLE_HOURS * 3_600_000) return null;
  if (now.getTime() - lastSeen > 5 * 60_000) {
    await conn.execute({ sql: "UPDATE sessions SET last_seen_at = ? WHERE id = ?", args: [now.toISOString(), r.sid as string] });
  }
  return {
    user: row(r),
    session: {
      id: String(r.sid),
      method: r.method as SessionMethod,
      createdAt: String(r.s_created),
      lastSeenAt: String(r.last_seen_at),
      expiresAt: String(r.expires_at),
      ip: (r.ip as string | null) ?? null,
      userAgent: (r.user_agent as string | null) ?? null,
    },
  };
}

export async function listSessions(userId: string, now = new Date()): Promise<Session[]> {
  const result = await (
    await db()
  ).execute({
    sql: `SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`,
    args: [userId, now.toISOString()],
  });
  return result.rows.map((r) => ({
    id: String(r.id),
    method: r.method as SessionMethod,
    createdAt: String(r.created_at),
    lastSeenAt: String(r.last_seen_at),
    expiresAt: String(r.expires_at),
    ip: (r.ip as string | null) ?? null,
    userAgent: (r.user_agent as string | null) ?? null,
  }));
}

/** Widerruft eine Sitzung (die ID ist hier der gespeicherte Hash aus listSessions/sessionUser). */
export async function revokeSession(userId: string, storedId: string, now = new Date()) {
  await (
    await db()
  ).execute({ sql: "UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?", args: [now.toISOString(), storedId, userId] });
}

export async function revokeSessionByToken(sessionId: string, now = new Date()) {
  await (await db()).execute({ sql: "UPDATE sessions SET revoked_at = ? WHERE id = ?", args: [now.toISOString(), sha256(sessionId)] });
}

export async function revokeAllSessions(userId: string, exceptStoredId?: string, now = new Date()) {
  await (
    await db()
  ).execute({
    sql: "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?",
    args: [now.toISOString(), userId, exceptStoredId ?? ""],
  });
}

// ── Anmeldebremse ──

/** Nach 5 Fehlversuchen in 15 Minuten ist der Schlüssel (IP oder Adresse) gesperrt. */
export async function loginBlocked(keys: string[], now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - LOCK_MINUTES * 60_000).toISOString();
  for (const key of keys) {
    const result = await (
      await db()
    ).execute({ sql: "SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND ok = 0 AND at > ?", args: [key, since] });
    if (Number(result.rows[0].n) >= LOCK_AFTER_FAILURES) return true;
  }
  return false;
}

export async function recordLogin(keys: string[], ok: boolean, now = new Date()) {
  const conn = await db();
  for (const key of keys) {
    if (ok) await conn.execute({ sql: "DELETE FROM login_attempts WHERE key = ?", args: [key] });
    else await conn.execute({ sql: "INSERT INTO login_attempts (key, ok, at) VALUES (?, 0, ?)", args: [key, now.toISOString()] });
  }
  await conn.execute({ sql: "DELETE FROM login_attempts WHERE at < ?", args: [new Date(now.getTime() - 86_400_000).toISOString()] });
}

// ── Protokoll ──

export type AuditEntry = { id: number; at: string; userName: string | null; action: string; detail: string | null; ip: string | null };

export async function audit(
  action: string,
  detail: string | null,
  who: { userId?: string | null; userName?: string | null; ip?: string | null } = {},
  now = new Date(),
) {
  await (
    await db()
  ).execute({
    sql: "INSERT INTO audit_log (at, user_id, user_name, action, detail, ip) VALUES (?, ?, ?, ?, ?, ?)",
    args: [now.toISOString(), who.userId ?? null, who.userName ?? null, action, detail, who.ip ?? null],
  });
}

export async function listAudit(limit = 200): Promise<AuditEntry[]> {
  const result = await (await db()).execute({ sql: "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", args: [limit] });
  return result.rows.map((r) => ({
    id: Number(r.id),
    at: String(r.at),
    userName: (r.user_name as string | null) ?? null,
    action: String(r.action),
    detail: (r.detail as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
  }));
}
