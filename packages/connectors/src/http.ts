import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Shared HTTP helper for API-key connectors (BookStack, Atera): timeouts, size limit, retry on
 * throttling, no redirects – and no requests to private networks (SSRF protection), because a
 * BookStack address is entered by the customer.
 */

export class ConnectorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

export type HttpOptions = {
  /** Shown in error messages, e.g. "BookStack". */
  service: string;
  headers: Record<string, string>;
  /** Plain http and private addresses (development and tests only). */
  allowPrivate?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

const MAX_RETRIES = 2;
const MAX_WAIT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** IPv4/IPv6 ranges that must not be reached from a customer-entered URL. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

/**
 * Checks a customer-entered base URL: https only, no credentials in the URL, and the host must
 * resolve to public addresses only. Returns the normalised URL without trailing slash.
 */
export async function assertSafeBaseUrl(raw: string, allowPrivate = false): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConnectorError(
      400,
      "invalid_url",
      "Bitte eine vollständige Adresse wie https://doku.firma.at angeben.",
    );
  }
  if (url.username || url.password) {
    throw new ConnectorError(400, "invalid_url", "Die Adresse darf keine Zugangsdaten enthalten.");
  }
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) {
    throw new ConnectorError(400, "invalid_url", "Die Adresse muss mit https:// beginnen.");
  }
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host)
      ? [host]
      : await lookup(host, { all: true }).then(
          (list) => list.map((entry) => entry.address),
          () => {
            throw new ConnectorError(
              400,
              "invalid_url",
              `Die Adresse ${url.hostname} ist nicht erreichbar.`,
            );
          },
        );
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new ConnectorError(
        400,
        "private_address",
        "Interne Netzwerkadressen sind nicht erlaubt. Die Adresse muss aus dem Internet erreichbar sein.",
      );
    }
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

const isTimeout = (error: unknown) =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

async function readLimited(response: Response, service: string): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) {
    throw new ConnectorError(413, "too_large", `${service} liefert zu große Daten.`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ConnectorError(413, "too_large", `${service} liefert zu große Daten.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** GET with timeout, size limit and up to two retries on 429/503 (Retry-After). */
export async function getText(url: string, options: HttpOptions): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await doFetch(url, {
        headers: { accept: "application/json", ...options.headers },
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      throw isTimeout(error)
        ? new ConnectorError(
            504,
            "timeout",
            `${options.service} antwortet gerade nicht. Bitte später erneut versuchen.`,
          )
        : new ConnectorError(
            502,
            "unreachable",
            `${options.service} ist nicht erreichbar. Bitte die Adresse prüfen.`,
          );
    }
    if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
      await response.body?.cancel();
      const seconds = Number(response.headers.get("retry-after") ?? "2");
      await sleep(Math.min(Number.isFinite(seconds) ? seconds * 1000 : 2000, MAX_WAIT_MS));
      continue;
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new ConnectorError(
        502,
        "redirect",
        `${options.service} leitet um – bitte die genaue API-Adresse angeben.`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new ConnectorError(
        response.status,
        "unauthorized",
        `${options.service} hat die Zugangsdaten abgelehnt.`,
      );
    }
    if (response.status === 404) {
      await response.body?.cancel();
      throw new ConnectorError(404, "not_found", `${options.service}: Eintrag nicht gefunden.`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ConnectorError(
        response.status,
        "http_error",
        `${options.service} meldet einen Fehler (${response.status}).`,
      );
    }
    try {
      return await readLimited(response, options.service);
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw isTimeout(error)
        ? new ConnectorError(
            504,
            "timeout",
            `${options.service} antwortet gerade nicht. Bitte später erneut versuchen.`,
          )
        : error;
    }
  }
}

export async function getJson(url: string, options: HttpOptions): Promise<unknown> {
  const text = await getText(url, options);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ConnectorError(
      502,
      "invalid_response",
      `${options.service} antwortet nicht wie erwartet.`,
    );
  }
}
