/**
 * Minimal Microsoft Graph client for app-only access (client credentials).
 *
 * - Token: https://learn.microsoft.com/graph/auth-v2-service#step-3-request-an-access-token
 * - Paging: https://learn.microsoft.com/graph/paging (follow @odata.nextLink)
 * - Throttling: https://learn.microsoft.com/graph/throttling (429 + Retry-After)
 */

export type GraphConfig = {
  clientId: string;
  clientSecret: string;
  /** The customer's Entra directory (tenant) ID from admin consent. */
  directoryTenantId: string;
  /** https://login.microsoftonline.com (configurable for national clouds and tests). */
  loginUrl: string;
  /** https://graph.microsoft.com/v1.0 */
  graphUrl: string;
  fetch?: typeof fetch;
  /** Waiting between retries; replaced in tests. */
  sleep?: (ms: number) => Promise<void>;
};

export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isDirectoryTenantId = (value: string) => GUID.test(value);

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

/** For tests. */
export function clearGraphTokenCache() {
  tokenCache.clear();
}

const MAX_RETRIES = 3;
const MAX_WAIT_MS = 30_000;

export class GraphClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: GraphConfig) {
    if (!isDirectoryTenantId(config.directoryTenantId)) {
      throw new GraphError(400, "invalid_tenant", "Ungültige Microsoft-Verzeichnis-ID.");
    }
    this.fetch = config.fetch ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private get graphBase() {
    return this.config.graphUrl.replace(/\/+$/, "");
  }

  async token(): Promise<string> {
    const key = `${this.config.loginUrl}|${this.config.clientId}|${this.config.directoryTenantId}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const url = `${this.config.loginUrl.replace(/\/+$/, "")}/${this.config.directoryTenantId}/oauth2/v2.0/token`;
    const response = await this.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      // Typical: consent was revoked or the app's secret expired.
      throw new GraphError(
        response.status,
        body.error ?? "token_failed",
        "Die Anmeldung bei Microsoft 365 ist fehlgeschlagen. Bitte verbinden Sie Microsoft 365 erneut.",
      );
    }
    // Renew a minute early.
    const lifetime = Math.max(60, (body.expires_in ?? 3599) - 60);
    tokenCache.set(key, { token: body.access_token, expiresAt: Date.now() + lifetime * 1000 });
    return body.access_token;
  }

  /** One request; retries on 429/503 with Retry-After. `pathOrUrl` is relative to graphUrl. */
  async request<T>(method: "GET" | "POST", pathOrUrl: string, body?: unknown): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.graphBase}${pathOrUrl}`;
    // Never send the token anywhere but Microsoft Graph (nextLinks come from the response).
    if (!url.startsWith(`${this.graphBase}/`)) {
      throw new GraphError(400, "foreign_url", "Unerwartete Adresse in der Graph-Antwort.");
    }
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${await this.token()}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
        const seconds = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2 ** attempt * 1000;
        await this.sleep(Math.min(wait, MAX_WAIT_MS));
        continue;
      }
      if (response.status === 204) return undefined as T;
      const json = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      if (!response.ok) {
        throw new GraphError(
          response.status,
          json.error?.code ?? `http_${response.status}`,
          graphMessage(response.status),
        );
      }
      return json as T;
    }
  }

  /** Follows @odata.nextLink until `limit` items are collected. */
  async list<T>(path: string, limit: number): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    let next: string | undefined = path;
    while (next && items.length < limit) {
      const page: { value?: T[]; "@odata.nextLink"?: string } = await this.request("GET", next);
      items.push(...(page.value ?? []));
      next = page["@odata.nextLink"];
    }
    return { items: items.slice(0, limit), truncated: Boolean(next) || items.length > limit };
  }
}

/** User-facing message; the Graph error details stay in the logs. */
function graphMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Microsoft 365 verweigert den Zugriff. Bitte prüfen Sie die Zustimmung des Administrators und die Intune-Lizenz.";
  }
  if (status === 404) return "Das Gerät wurde in Intune nicht gefunden.";
  if (status === 429)
    return "Microsoft 365 drosselt gerade die Anfragen. Bitte versuchen Sie es gleich erneut.";
  return "Microsoft 365 ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.";
}
