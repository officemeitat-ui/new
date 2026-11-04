import { z } from "zod";
import { ConnectorError, getJson, getText, type HttpOptions } from "./http";

/**
 * BookStack REST API (self-hosted documentation). Every instance documents its API at
 * `<base>/api/docs`; sources: https://github.com/BookStackApp/BookStack – routes/api.php,
 * app/Api/ListingResponseBuilder.php (count ≤ 500, offset, sort, filter[field:op]),
 * app/Api/ApiTokenGuard.php (header `Authorization: Token <id>:<secret>`).
 */

export type BookStackConfig = {
  /** e.g. https://doku.me-it.at (without /api). */
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
  allowPrivate?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const PAGE_SIZE = 500;
/** Bounds against a hostile or broken instance (security review 2, finding 5). */
export const BOOKSTACK_LIMITS = { maxEntries: 20_000, maxListingBytes: 2 * 1024 * 1024 };

const bookSchema = z.object({
  id: z.number().int(),
  name: z.string().max(500),
  slug: z.string().max(300),
});
const pageSchema = z.object({
  id: z.number().int(),
  book_id: z.number().int(),
  name: z.string().max(500),
  slug: z.string().max(300),
  draft: z.boolean().optional().default(false),
  template: z.boolean().optional().default(false),
  updated_at: z.string().max(40),
});
const listing = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), total: z.number() });

export type BookStackBook = z.infer<typeof bookSchema>;
export type BookStackPage = z.infer<typeof pageSchema>;

function options(config: BookStackConfig, maxBytes?: number): HttpOptions {
  return {
    ...(maxBytes ? { maxBytes } : {}),
    service: "BookStack",
    headers: { authorization: `Token ${config.tokenId}:${config.tokenSecret}` },
    // The address comes from the customer (SSRF protection, see http.ts).
    publicOnly: true,
    allowPrivate: config.allowPrivate,
    fetch: config.fetch,
    sleep: config.sleep,
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ConnectorError(502, "invalid_response", "BookStack antwortet nicht wie erwartet.");
  }
  return parsed.data;
}

/**
 * Reads every entry of a listing endpoint, 500 at a time. Bounded: at most 20,000 entries,
 * 2 MB per page, and it stops when the offset does not move – a hostile server cannot make
 * the process run out of memory or loop forever.
 */
async function listAll<T>(config: BookStackConfig, path: string, schema: z.ZodType<T>) {
  const all: T[] = [];
  // The instance may cap the page size lower than requested (API_MAX_ITEM_COUNT): advance by
  // what actually came back.
  for (let offset = 0; ;) {
    const url = `${config.baseUrl}/api/${path}?count=${PAGE_SIZE}&offset=${offset}&sort=id`;
    const page = parse(
      listing(schema),
      await getJson(url, options(config, BOOKSTACK_LIMITS.maxListingBytes)),
    );
    if (page.data.length === 0 || offset + page.data.length >= page.total) {
      all.push(...page.data);
      return all;
    }
    all.push(...page.data);
    offset += page.data.length;
    if (all.length > BOOKSTACK_LIMITS.maxEntries) {
      throw new ConnectorError(
        413,
        "too_many",
        `BookStack liefert mehr als ${BOOKSTACK_LIMITS.maxEntries.toLocaleString("de-AT")} Einträge – bitte wenden Sie sich an ME-IT.`,
      );
    }
  }
}

/** Connection test: one small request (token valid, instance reachable). */
export async function testBookStack(config: BookStackConfig): Promise<number> {
  const url = `${config.baseUrl}/api/books?count=1&offset=0`;
  return parse(listing(bookSchema), await getJson(url, options(config, 64 * 1024))).total;
}

export function listBooks(config: BookStackConfig): Promise<BookStackBook[]> {
  return listAll(config, "books", bookSchema);
}

/** Published pages only (no drafts, no templates). */
export async function listPages(config: BookStackConfig): Promise<BookStackPage[]> {
  const pages = await listAll(config, "pages", pageSchema);
  return pages.filter((page) => !page.draft && !page.template);
}

/** GET /api/pages/{id}/export/markdown */
export function exportPageMarkdown(config: BookStackConfig, pageId: number): Promise<string> {
  return getText(`${config.baseUrl}/api/pages/${pageId}/export/markdown`, options(config));
}

export function pageUrl(baseUrl: string, bookSlug: string, pageSlug: string): string {
  return `${baseUrl}/books/${encodeURIComponent(bookSlug)}/page/${encodeURIComponent(pageSlug)}`;
}
