import { z } from "zod";
import { ConnectorError, getJson, type HttpOptions } from "./http";

/**
 * Atera REST API v3 (PSA/RMM). Official reference: https://app.atera.com/apidocs
 *
 * Used here, as documented there and in Atera-based open-source connectors (e.g.
 * github.com/MSPbotsAIFramework/atera-mcp, Apache-2.0):
 * - Base URL https://app.atera.com/api/v3, key in `X-API-KEY` (newer JWT keys: Bearer).
 * - GET /tickets?Page=&ItemsInPage= (max 50)&TicketStatus=Open|Pending|Resolved|Closed
 *   &DateFrom=YYYY-MM-DD → { items, page, totalPages, totalItemCount, nextLink }.
 * - GET /tickets/{id}/comments → { items } with IsInternal per comment.
 *
 * TODO(verify): the text and date field names of a comment are read tolerantly
 * (Comment/CommentText, Date/CommentTimestamp/CreatedDate) until checked against the official
 * reference with a live key (docs/adr/0010).
 */

export type AteraConfig = {
  apiKey: string;
  /** https://app.atera.com/api/v3 (tests point this elsewhere). */
  baseUrl: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export const ATERA_PAGE_SIZE = 50;
export const ATERA_STATUSES = ["Open", "Pending", "Resolved", "Closed"] as const;
export type AteraStatus = (typeof ATERA_STATUSES)[number];

const ticketSchema = z.looseObject({
  TicketID: z.number(),
  TicketNumber: z.union([z.number(), z.string()]).nullish(),
  TicketTitle: z.string().nullish(),
  TicketStatus: z.string().nullish(),
  TicketType: z.string().nullish(),
  TicketPriority: z.string().nullish(),
  CustomerID: z.number().nullish(),
  CustomerName: z.string().nullish(),
  CreatedDate: z.string().nullish(),
  LastUpdatedDate: z.string().nullish(),
});
const pageSchema = <T extends z.ZodType>(item: T) =>
  z.looseObject({
    items: z.array(item),
    page: z.number().nullish(),
    totalPages: z.number().nullish(),
    nextLink: z.string().nullish(),
  });
const commentSchema = z.looseObject({
  Comment: z.string().nullish(),
  CommentText: z.string().nullish(),
  IsInternal: z.boolean().nullish(),
  Date: z.string().nullish(),
  CommentTimestamp: z.string().nullish(),
  CreatedDate: z.string().nullish(),
});

export type AteraTicket = z.infer<typeof ticketSchema>;
export type AteraComment = { text: string; internal: boolean; date: string | null };

/** Newer Atera keys are JWTs (sent as Bearer); older static keys go into X-API-KEY. */
const isJwt = (key: string) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key);

function options(config: AteraConfig): HttpOptions {
  return {
    service: "Atera",
    headers: isJwt(config.apiKey)
      ? { authorization: `Bearer ${config.apiKey}` }
      : { "x-api-key": config.apiKey },
    fetch: config.fetch,
    sleep: config.sleep,
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ConnectorError(502, "invalid_response", "Atera antwortet nicht wie erwartet.");
  }
  return parsed.data;
}

/** One page of tickets with the given status, created on or after `dateFrom` (YYYY-MM-DD). */
export async function listTickets(
  config: AteraConfig,
  query: { status: AteraStatus; page: number; dateFrom?: string },
) {
  const params = new URLSearchParams({
    Page: String(Math.max(1, query.page)),
    ItemsInPage: String(ATERA_PAGE_SIZE),
    TicketStatus: query.status,
  });
  if (query.dateFrom) params.set("DateFrom", query.dateFrom);
  const result = parse(
    pageSchema(ticketSchema),
    await getJson(`${config.baseUrl}/tickets?${params}`, options(config)),
  );
  const hasMore =
    Boolean(result.nextLink) ||
    (typeof result.page === "number" &&
      typeof result.totalPages === "number" &&
      result.page < result.totalPages);
  return { tickets: result.items, hasMore };
}

export async function listTicketComments(
  config: AteraConfig,
  ticketId: number,
): Promise<AteraComment[]> {
  const result = parse(
    pageSchema(commentSchema),
    await getJson(`${config.baseUrl}/tickets/${ticketId}/comments`, options(config)),
  );
  return result.items
    .map((item) => ({
      text: (item.Comment ?? item.CommentText ?? "").trim(),
      internal: item.IsInternal === true,
      date: item.Date ?? item.CommentTimestamp ?? item.CreatedDate ?? null,
    }))
    .filter((comment) => comment.text.length > 0);
}

/** Cheap check of key and access: the first page of one ticket. */
export async function testAtera(config: AteraConfig) {
  await listTickets(config, { status: "Resolved", page: 1 });
}
