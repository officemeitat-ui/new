import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Anmeldung mit Microsoft (Entra ID, OpenID Connect, Autorisierungscode mit PKCE).
// MFA, Gerätebindung und Standortregeln setzt Entra ID per Conditional Access durch – der Arbeitsplatz verlässt sich darauf.
// Zusätzlich gibt die Anmeldung delegierten Zugriff auf OneDrive/SharePoint – mit den Rechten der angemeldeten Person.
//
//   AUTH_MS_CLIENT_ID / AUTH_MS_CLIENT_SECRET  App-Registrierung „Arbeitsplatz-Anmeldung“ (Web, Redirect-URI siehe README)
//   AUTH_MS_TENANT_ID                           eigener Mandant (Standard: MS_TENANT_ID) – nur Konten daraus dürfen hinein

export const MICROSOFT_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Files.Read.All", "Sites.Read.All"];

const loginBase = () => (process.env.MS_LOGIN_URL || "https://login.microsoftonline.com").replace(/\/+$/, "");
const tenant = () => process.env.AUTH_MS_TENANT_ID || process.env.MS_TENANT_ID || "";

export function microsoftLoginConfigured(): boolean {
  return Boolean(process.env.AUTH_MS_CLIENT_ID && process.env.AUTH_MS_CLIENT_SECRET && tenant());
}

export function redirectUri(): string {
  const base = (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/auth/microsoft/callback`;
}

export const randomToken = () => randomBytes(32).toString("base64url");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function authorizeUrl(params: { state: string; nonce: string; verifier: string; loginHint?: string }): string {
  const query = new URLSearchParams({
    client_id: process.env.AUTH_MS_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: redirectUri(),
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state: params.state,
    nonce: params.nonce,
    code_challenge: pkceChallenge(params.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  if (params.loginHint) query.set("login_hint", params.loginHint);
  return `${loginBase()}/${tenant()}/oauth2/v2.0/authorize?${query}`;
}

export type MicrosoftIdentity = { oid: string; tid: string; email: string | null; name: string | null };
export type MicrosoftTokens = { accessToken: string; refreshToken: string | null; expiresIn: number; scope: string | null };

export class MicrosoftLoginError extends Error {}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${loginBase()}/${tenant()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_MS_CLIENT_ID ?? "",
      client_secret: process.env.AUTH_MS_CLIENT_SECRET ?? "",
      ...body,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || data.error) {
    throw new MicrosoftLoginError(`Microsoft: ${data.error_description?.split("\n")[0] ?? data.error ?? `HTTP ${response.status}`}`);
  }
  return data;
}

/**
 * Prüft das ID-Token. Es kommt direkt per TLS vom Token-Endpunkt (OpenID Connect Core 3.1.3.7) – geprüft werden
 * Aussteller, Empfänger, Ablauf, Nonce und dass das Konto aus dem eigenen Mandanten stammt.
 */
export function validateIdToken(idToken: string, nonce: string, now = new Date()): MicrosoftIdentity {
  const [, payload] = idToken.split(".");
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8"));
  } catch {
    throw new MicrosoftLoginError("Ungültige Antwort von Microsoft");
  }
  const expectedTenant = tenant();
  const tid = String(claims.tid ?? "");
  if (claims.aud !== process.env.AUTH_MS_CLIENT_ID) throw new MicrosoftLoginError("Anmeldung war für eine andere Anwendung bestimmt");
  // Ist der Mandant als GUID angegeben, muss er exakt passen; bei einem Domänennamen sorgt der Endpunkt dafür.
  const tenantIsGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedTenant);
  if (!tid || (tenantIsGuid && tid.toLowerCase() !== expectedTenant.toLowerCase())) {
    throw new MicrosoftLoginError("Dieses Konto gehört nicht zum eigenen Microsoft-365-Mandanten");
  }
  if (claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) throw new MicrosoftLoginError("Unbekannter Aussteller");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now.getTime() - 60_000) throw new MicrosoftLoginError("Anmeldung abgelaufen");
  if (claims.nonce !== nonce) throw new MicrosoftLoginError("Anmeldung passt nicht zu dieser Sitzung");
  const oid = String(claims.oid ?? "");
  if (!oid) throw new MicrosoftLoginError("Microsoft hat keine Konto-ID geliefert");
  const email = [claims.email, claims.preferred_username].find((v) => typeof v === "string" && v.includes("@")) as string | undefined;
  return { oid, tid, email: email ?? null, name: typeof claims.name === "string" ? claims.name : null };
}

export async function redeemCode(code: string, verifier: string, nonce: string, now = new Date()) {
  const data = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
    scope: MICROSOFT_SCOPES.join(" "),
  });
  if (!data.id_token || !data.access_token) throw new MicrosoftLoginError("Microsoft hat kein Token geliefert");
  return {
    identity: validateIdToken(data.id_token, nonce, now),
    tokens: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresIn: data.expires_in ?? 3600,
      scope: data.scope ?? null,
    } satisfies MicrosoftTokens,
  };
}

/** Neues Zugriffstoken für Microsoft Graph mit dem gespeicherten Refresh-Token (delegiert, Rechte der Person). */
export async function refreshAccessToken(refreshToken: string): Promise<MicrosoftTokens> {
  const data = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: MICROSOFT_SCOPES.filter((s) => s !== "openid" && s !== "profile" && s !== "email").join(" "),
  });
  if (!data.access_token) throw new MicrosoftLoginError("Microsoft hat kein Token geliefert");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresIn: data.expires_in ?? 3600,
    scope: data.scope ?? null,
  };
}
