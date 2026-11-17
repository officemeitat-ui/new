import "server-only";

// Microsoft Graph mit App-Zugang (Client Credentials) – gemeinsam für Postfach und Belege.
// Die Kalender-Anbindung (lib/calendar-sync/microsoft.ts) nutzt dieselbe App-Registrierung.

const LOGIN_URL = process.env.MS_LOGIN_URL || "https://login.microsoftonline.com";
export const GRAPH_URL = process.env.MS_GRAPH_URL || "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type GraphCredentials = { tenantId: string; clientId: string; clientSecret: string };

export function graphCredentials(): GraphCredentials | null {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) return null;
  return { tenantId: MS_TENANT_ID, clientId: MS_CLIENT_ID, clientSecret: MS_CLIENT_SECRET };
}

async function send(service: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new GraphError(`${service}: nicht erreichbar (${error instanceof Error ? error.message : String(error)})`);
  }
}

export type GraphClient = {
  /** Aufruf relativ zu GRAPH_URL (oder mit vollständiger URL, z. B. @odata.nextLink); Fehler als GraphError. */
  request(pathOrUrl: string, init?: RequestInit & { allow404?: boolean }): Promise<Response>;
  json<T>(pathOrUrl: string, init?: RequestInit): Promise<T>;
};

export function createGraphClient(credentials: GraphCredentials, service = "Microsoft 365"): GraphClient {
  let cached: { token: string; expiresAt: number } | undefined;

  async function token(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await send(`${service} (Anmeldung)`, `${LOGIN_URL}/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    if (!response.ok) throw new GraphError(`${service}: Anmeldung fehlgeschlagen (HTTP ${response.status})`, response.status);
    const data = (await response.json()) as { access_token: string; expires_in: number };
    cached = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return cached.token;
  }

  async function request(pathOrUrl: string, init: RequestInit & { allow404?: boolean } = {}): Promise<Response> {
    const { allow404, ...rest } = init;
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_URL}${pathOrUrl}`;
    const response = await send(service, url, {
      ...rest,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
        // Unveränderliche IDs: Verschieben in einen anderen Ordner ändert die ID der E-Mail nicht.
        Prefer: 'IdType="ImmutableId"',
        ...rest.headers,
      },
    });
    if (response.ok || (allow404 && response.status === 404)) return response;
    const detail = await response
      .json()
      .then((data: { error?: { message?: string } }) => data.error?.message)
      .catch(() => undefined);
    throw new GraphError(`${service}: HTTP ${response.status}${detail ? ` – ${detail}` : ""}`, response.status);
  }

  return {
    request,
    async json<T>(pathOrUrl: string, init?: RequestInit) {
      return (await (await request(pathOrUrl, init)).json()) as T;
    },
  };
}
