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
/** No call may hang a page or a job: Graph answers within seconds when it is healthy. */
const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

function timeoutError(): GraphError {
  return new GraphError(
    504,
    "timeout",
    "Microsoft 365 antwortet gerade nicht. Bitte versuchen Sie es später erneut.",
  );
}

const isTimeout = (error: unknown) =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }).catch((error: unknown) => {
      throw isTimeout(error) ? timeoutError() : error;
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${await this.token()}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }).catch((error: unknown) => {
        throw isTimeout(error) ? timeoutError() : error;
      });
      if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
        await response.body?.cancel().catch(() => undefined); // free the connection
        const seconds = Number(response.headers.get("retry-after"));
        const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2 ** attempt * 1000;
        await this.sleep(Math.min(wait, MAX_WAIT_MS));
        continue;
      }
      if (response.status === 204) return undefined as T;
      let json: { error?: { code?: string; message?: string } };
      try {
        json = (await response.json()) as typeof json;
      } catch (error) {
        // A broken or timed-out body of a successful response is an error, not "no data".
        if (response.ok)
          throw isTimeout(error)
            ? timeoutError()
            : new GraphError(502, "bad_response", graphMessage(502));
        json = {};
      }
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

  /**
   * Downloads file content from a pre-authenticated URL (driveItem `@microsoft.graph.downloadUrl`,
   * https://learn.microsoft.com/graph/api/driveitem-get-content). No token is sent: the URL
   * carries its own short-lived authorisation. Stops at `maxBytes`.
   */
  async download(url: string, maxBytes: number): Promise<Uint8Array> {
    const parsed = new URL(url);
    const graph = new URL(this.graphBase);
    // Only https in production; http is accepted only when Graph itself is http (tests).
    if (parsed.protocol !== "https:" && parsed.protocol !== graph.protocol) {
      throw new GraphError(400, "foreign_url", "Unerwartete Download-Adresse.");
    }
    const response = await this.fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    }).catch((error: unknown) => {
      throw isTimeout(error) ? timeoutError() : error;
    });
    if (!response.ok || !response.body) {
      throw new GraphError(
        response.status,
        `http_${response.status}`,
        graphMessage(response.status),
      );
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body.cancel();
      throw new GraphError(413, "too_large", "Die Datei ist zu groß.");
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new GraphError(413, "too_large", "Die Datei ist zu groß.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
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
  if (status === 404) return "Der Eintrag wurde in Microsoft 365 nicht gefunden.";
  if (status === 410) return "Der Abgleich muss neu beginnen.";
  if (status === 429)
    return "Microsoft 365 drosselt gerade die Anfragen. Bitte versuchen Sie es gleich erneut.";
  return "Microsoft 365 ist gerade nicht erreichbar. Bitte versuchen Sie es später erneut.";
}
