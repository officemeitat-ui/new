import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { base32Encode, totpCode, verifyTotp } from "@/lib/totp";

process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), "auth-")), "test.db")}`;
process.env.SESSION_SECRET = "test-session-geheimnis";
process.env.AUTH_MS_CLIENT_ID = "11111111-2222-3333-4444-555555555555";
process.env.AUTH_MS_CLIENT_SECRET = "geheim";
process.env.AUTH_MS_TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
process.env.PUBLIC_URL = "https://arbeitsplatz.example.at";

let users: typeof import("@/lib/users");
let entra: typeof import("@/lib/entra");
let session: typeof import("@/lib/session");

beforeAll(async () => {
  users = await import("@/lib/users");
  entra = await import("@/lib/entra");
  session = await import("@/lib/session");
});

const now = new Date("2026-11-17T08:00:00Z");
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

describe("Einmalcodes (TOTP)", () => {
  it("rechnet wie RFC 6238 (SHA-1-Testvektoren)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("toleriert ein Zeitfenster und lässt denselben Code kein zweites Mal zu", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const at = new Date(1111111109 * 1000);
    const step = verifyTotp(secret, "081 804", at);
    expect(step).toBe(Math.floor(1111111109 / 30));
    expect(verifyTotp(secret, "081804", new Date(at.getTime() + 30_000))).toBe(step);
    expect(verifyTotp(secret, "081804", at, step)).toBeNull();
    expect(verifyTotp(secret, "081804", new Date(at.getTime() + 120_000))).toBeNull();
    expect(verifyTotp(secret, "12345", at)).toBeNull();
  });
});

describe("Konten, zweiter Faktor, Sitzungen", () => {
  it("legt Konten an und prüft Passwörter", async () => {
    await expect(users.createUser({ email: "max@it-muster.at", name: "Max", role: "inhaber", password: "kurz" })).rejects.toThrow(
      "mindestens 12",
    );
    const max = await users.createUser({
      email: " Max@IT-Muster.at ",
      name: "Max Muster",
      role: "inhaber",
      password: "ein langer Passwortsatz",
    });
    expect(max).toMatchObject({ email: "max@it-muster.at", role: "inhaber", hasPassword: true, totpEnabled: false });
    await expect(users.createUser({ email: "max@it-muster.at", name: "X", role: "technik" })).rejects.toThrow("schon ein Konto");
    expect(await users.checkPassword("MAX@it-muster.at", "ein langer Passwortsatz")).toMatchObject({ id: max.id });
    expect(await users.checkPassword("max@it-muster.at", "falsch falsch falsch")).toBeNull();
    expect(await users.checkPassword("niemand@it-muster.at", "ein langer Passwortsatz")).toBeNull();
  });

  it("richtet den Einmalcode ein, nimmt Wiederherstellungscodes genau einmal", async () => {
    const max = (await users.findUserByEmail("max@it-muster.at"))!;
    const secret = await users.startTotpSetup(max.id);
    expect(await users.pendingTotpSecret(max.id)).toBe(secret);
    expect(await users.confirmTotpSetup(max.id, "000000", now)).toBeNull();
    const step = Math.floor(now.getTime() / 30_000);
    const codes = (await users.confirmTotpSetup(max.id, totpCode(secret, step), now))!;
    expect(codes).toHaveLength(8);
    expect(codes[0]).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    expect(await users.pendingTotpSecret(max.id)).toBeNull();

    // Derselbe Code ein zweites Mal: abgelehnt. Der nächste: angenommen.
    expect(await users.verifySecondFactor(max.id, totpCode(secret, step), now)).toBeNull();
    expect(await users.verifySecondFactor(max.id, totpCode(secret, step + 1), later(0.5))).toBe("code");
    // Wiederherstellungscode: klein geschrieben, ohne Bindestrich – einmal gültig
    const recovery = codes[3].toLowerCase().replace("-", "");
    expect(await users.verifySecondFactor(max.id, recovery, now)).toBe("wiederherstellung");
    expect(await users.verifySecondFactor(max.id, recovery, now)).toBeNull();
    expect(await users.remainingRecoveryCodes(max.id)).toBe(7);

    // Das Geheimnis liegt verschlüsselt in der Datenbank
    const { db } = await import("@/lib/db");
    const stored = (await (await db()).execute({ sql: "SELECT totp_secret FROM users WHERE id = ?", args: [max.id] })).rows[0];
    expect(String(stored.totp_secret)).toMatch(/^enc1:/);
    expect(String(stored.totp_secret)).not.toContain(secret);
  });

  it("Sitzungen: gültig, widerrufbar, laufen bei Untätigkeit ab, gesperrte Konten fliegen raus", async () => {
    const max = (await users.findUserByEmail("max@it-muster.at"))!;
    const a = await users.createSession(
      max.id,
      "passwort+code",
      { ip: "198.51.100.7", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140" },
      now,
    );
    const b = await users.createSession(max.id, "microsoft", { ip: null, userAgent: null }, now);
    const token = await session.createSessionToken(a.id, a.expiresAt);
    expect(await session.readSessionToken(token)).toEqual({ sessionId: a.id, expiresAt: a.expiresAt });
    expect(await session.readSessionToken(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();

    const current = (await users.sessionUser(a.id, later(10)))!;
    expect(current.user.id).toBe(max.id);
    expect(await users.sessionUser(a.id, later(60 * 25))).toBeNull(); // 25 Stunden nicht benutzt

    expect(await users.listSessions(max.id, later(10))).toHaveLength(2);
    await users.revokeAllSessions(max.id, current.session.id, later(11));
    expect(await users.sessionUser(b.id, later(12))).toBeNull();
    expect(await users.sessionUser(a.id, later(12))).not.toBeNull();

    const tech = await users.createUser({ email: "lisa@it-muster.at", name: "Lisa", role: "technik", password: "noch ein langer Satz" });
    const s = await users.createSession(tech.id, "passwort+code", { ip: null, userAgent: null }, now);
    await users.updateUser(tech.id, { disabled: true }, later(1));
    expect(await users.sessionUser(s.id, later(2))).toBeNull();
    expect(await users.checkPassword("lisa@it-muster.at", "noch ein langer Satz")).toBeNull();
    await expect(users.updateUser(max.id, { role: "technik" })).rejects.toThrow("letzte Inhaber-Konto");
  });

  it("bremst nach fünf Fehlversuchen", async () => {
    const keys = ["ip:203.0.113.5", "mail:max@it-muster.at"];
    for (let i = 0; i < 4; i++) await users.recordLogin(keys, false, now);
    expect(await users.loginBlocked(keys, now)).toBe(false);
    await users.recordLogin(keys, false, now);
    expect(await users.loginBlocked(keys, now)).toBe(true);
    expect(await users.loginBlocked(keys, later(16))).toBe(false);
    expect(await users.loginBlocked(["ip:203.0.113.6"], now)).toBe(false);
  });

  it("protokolliert", async () => {
    await users.audit("Doku entsperrt", null, { userName: "Max Muster", ip: "198.51.100.7" }, now);
    expect((await users.listAudit(5))[0]).toMatchObject({ action: "Doku entsperrt", userName: "Max Muster", ip: "198.51.100.7" });
  });
});

describe("Microsoft-Anmeldung", () => {
  const idToken = (claims: Record<string, unknown>) =>
    `x.${Buffer.from(
      JSON.stringify({
        aud: process.env.AUTH_MS_CLIENT_ID,
        tid: process.env.AUTH_MS_TENANT_ID,
        iss: `https://login.microsoftonline.com/${process.env.AUTH_MS_TENANT_ID}/v2.0`,
        exp: Math.floor(now.getTime() / 1000) + 3600,
        nonce: "n-1",
        oid: "oid-max",
        preferred_username: "Max@IT-Muster.at",
        name: "Max Muster",
        ...claims,
      }),
    ).toString("base64url")}.sig`;

  it("baut die Anmeldeadresse mit PKCE", () => {
    const url = new URL(entra.authorizeUrl({ state: "s", nonce: "n", verifier: "v".repeat(43) }));
    expect(url.pathname).toBe(`/${process.env.AUTH_MS_TENANT_ID}/oauth2/v2.0/authorize`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(entra.pkceChallenge("v".repeat(43)));
    expect(url.searchParams.get("redirect_uri")).toBe("https://arbeitsplatz.example.at/api/auth/microsoft/callback");
    expect(url.searchParams.get("scope")).toContain("Files.Read.All");
  });

  it("prüft das ID-Token streng", () => {
    expect(entra.validateIdToken(idToken({}), "n-1", now)).toEqual({
      oid: "oid-max",
      tid: process.env.AUTH_MS_TENANT_ID,
      email: "Max@IT-Muster.at",
      name: "Max Muster",
    });
    expect(() => entra.validateIdToken(idToken({ nonce: "anders" }), "n-1", now)).toThrow("passt nicht");
    expect(() => entra.validateIdToken(idToken({ aud: "fremde-app" }), "n-1", now)).toThrow("andere Anwendung");
    expect(() =>
      entra.validateIdToken(
        idToken({
          tid: "99999999-9999-9999-9999-999999999999",
          iss: "https://login.microsoftonline.com/99999999-9999-9999-9999-999999999999/v2.0",
        }),
        "n-1",
        now,
      ),
    ).toThrow("eigenen Microsoft-365-Mandanten");
    expect(() => entra.validateIdToken(idToken({ exp: Math.floor(now.getTime() / 1000) - 600 }), "n-1", now)).toThrow("abgelaufen");
  });

  it("ordnet Microsoft-Konten nur vorhandenen Benutzern zu und merkt sich die Objekt-ID", async () => {
    expect(await users.userForMicrosoft("oid-fremd", "fremd@it-muster.at")).toBeNull();
    const max = (await users.userForMicrosoft("oid-max", "MAX@it-muster.at"))!;
    expect(max).toMatchObject({ email: "max@it-muster.at", entraLinked: true });
    // Später zählt die Objekt-ID – auch wenn sich die Adresse ändert
    expect((await users.userForMicrosoft("oid-max", "max.muster@neu.at"))!.id).toBe(max.id);
    await users.saveMicrosoftToken(max.id, "refresh-123", "Files.Read.All", now);
    expect(await users.microsoftRefreshToken(max.id)).toBe("refresh-123");
  });
});
