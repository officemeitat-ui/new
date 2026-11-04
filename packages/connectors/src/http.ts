import { lookup as lookupCallback, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

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
  /**
   * The URL was entered by a customer: connect only to public addresses, checked when the
   * connection is made (no gap between check and connect, so DNS rebinding does not help).
   */
  publicOnly?: boolean;
  /** Plain http and private addresses (development and tests only). */
  allowPrivate?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Response size limit (default 10 MB). */
  maxBytes?: number;
};

const MAX_RETRIES = 2;
const MAX_WAIT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Address ranges that must not be reached from a customer-entered URL: private, loopback,
 * link-local, CGNAT, multicast, documentation and other reserved networks (IANA special-purpose
 * registries). Node's BlockList also matches IPv4-mapped IPv6 forms such as ::ffff:7f00:1.
 */
const BLOCKED = (() => {
  const list = new BlockList();
  for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const) {
    list.addSubnet(network, prefix, "ipv4");
  }
  for (const [network, prefix] of [
    ["::", 128],
    ["::1", 128],
    ["::", 96], // IPv4-compatible (deprecated)
    ["::ffff:0:0:0", 96], // IPv4-translated (SIIT)
    ["64:ff9b::", 96], // NAT64 – could reach internal IPv4 targets
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
  ] as const) {
    list.addSubnet(network, prefix, "ipv6");
  }
  return list;
})();

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // not an address at all: never treat as public
  return BLOCKED.check(address, family === 4 ? "ipv4" : "ipv6");
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

const PRIVATE_ERROR = "EPRIVATEADDRESS";

/**
 * DNS lookup for outgoing connections that refuses private targets. Used as `lookup` of the
 * socket itself, so the address that is checked is the address that is connected to.
 */
export const publicOnlyLookup: LookupFunction = (
  hostname: string,
  options: LookupOptions,
  callback,
) => {
  lookupCallback(hostname, { family: options.family ?? 0, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as unknown as LookupAddress[];
    if (list.length === 0 || list.some((entry) => isPrivateAddress(entry.address))) {
      return callback(Object.assign(new Error("private address"), { code: PRIVATE_ERROR }), "", 0);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

/** GET over https with `publicOnlyLookup`; returns a standard Response. */
function publicOnlyFetch(
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal; redirect?: string },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== "https:") {
      reject(new ConnectorError(400, "invalid_url", "Die Adresse muss mit https:// beginnen."));
      return;
    }
    // A literal IP skips the lookup entirely: check it here.
    const literal = target.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && isPrivateAddress(literal)) {
      reject(Object.assign(new Error("private address"), { code: PRIVATE_ERROR }));
      return;
    }
    const req = httpsRequest(
      target,
      { method: "GET", headers: init.headers, lookup: publicOnlyLookup, signal: init.signal },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = res.statusCode ?? 502;
        const empty = [204, 205, 304].includes(status);
        if (empty) res.resume();
        resolve(
          new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
            status: status >= 200 && status <= 599 ? status : 502,
            headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const isTimeout = (error: unknown) =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

async function readLimited(
  response: Response,
  service: string,
  limit = MAX_RESPONSE_BYTES,
): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > limit) {
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
    if (total > limit) {
      await reader.cancel();
      throw new ConnectorError(413, "too_large", `${service} liefert zu große Daten.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** GET with timeout, size limit and up to two retries on 429/503 (Retry-After). */
export async function getText(url: string, options: HttpOptions): Promise<string> {
  const doFetch =
    options.fetch ?? (options.publicOnly && !options.allowPrivate ? publicOnlyFetch : fetch);
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
      if (error instanceof ConnectorError) throw error;
      if ((error as { code?: string }).code === PRIVATE_ERROR) {
        throw new ConnectorError(
          400,
          "private_address",
          "Interne Netzwerkadressen sind nicht erlaubt. Die Adresse muss aus dem Internet erreichbar sein.",
        );
      }
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
      return await readLimited(response, options.service, options.maxBytes);
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
