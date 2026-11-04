import {
  assertSafeBaseUrl,
  ConnectorError,
  exportPageMarkdown,
  listBooks,
  listPages,
  testBookStack,
  listTicketComments,
  listTickets,
  pageUrl,
  testAtera,
  type AteraComment,
  type AteraConfig,
  type AteraStatus,
  type AteraTicket,
  type BookStackConfig,
} from "@nexus/connectors";
import { conflict, forbidden, validationError } from "@nexus/core";
import { decryptSecret, encryptSecret } from "@nexus/core/crypto";
import { getEnv } from "@nexus/core/env";
import { and, eq, inArray, withTenant, type Database } from "@nexus/db";
import { knowledgeDocuments, knowledgeSources, tenants } from "@nexus/db/schema";
import { detectKind, MAX_FILE_BYTES } from "@nexus/knowledge/detect";
import { z } from "zod";
import { appendAudit } from "./audit";
import { getCollection } from "./knowledge";
import type { MicrosoftAppConfig } from "./integrations";
import {
  claimSync,
  eachLimited,
  getKnowledgeSource,
  SYNC_DEADLINE_MS,
  syncSharePointSource,
  upsertSourceDocument,
  type SyncResult,
} from "./sharepoint";

/**
 * Knowledge from BookStack (own documentation) and Atera (solved tickets), ADR 0010. Both run
 * like the SharePoint sync: in the background, item by item, only what changed.
 */

const CONCURRENCY = 3;
/** Safety limit per run and status: 100 pages of 50 tickets. */
const MAX_ATERA_PAGES = 100;
const ATERA_STATUSES_FOR_KNOWLEDGE: AteraStatus[] = ["Resolved", "Closed"];

export type ConnectorEnv = {
  /** Plain http and private hosts (development and tests only). */
  allowPrivate: boolean;
  ateraUrl: string;
};

export function connectorEnv(): ConnectorEnv {
  const env = getEnv();
  return { allowPrivate: env.CONNECTOR_ALLOW_PRIVATE_URLS, ateraUrl: env.ATERA_API_URL };
}

/** Errors a person can act on are shown; everything else stays in the logs. */
function sourceErrorMessage(error: unknown, service: string): string {
  if (error instanceof ConnectorError) return error.message;
  if (error instanceof Error && error.name === "AppError") return error.message;
  return `Der Abgleich mit ${service} ist fehlgeschlagen. Der Fehler wurde protokolliert.`;
}

/** Connector failures while connecting are the user's to fix (URL, token): show them. */
async function userFacing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ConnectorError) throw validationError(error.message);
    throw error;
  }
}

/** AAD of a source's encrypted credentials: bound to company and collection. */
const secretOwner = (tenantId: string, collectionId: string) =>
  `knowledge_source:${tenantId}:${collectionId}`;

/**
 * BookStack and Atera are usually the partner's own systems with data of many customers: only
 * companies the partner explicitly allowed may connect them (security review 2, finding 6).
 */
async function assertPartnerSourcesAllowed(db: Database, tenantId: string) {
  const [tenant] = await withTenant(db, tenantId, (tx) =>
    tx
      .select({ allowed: tenants.partnerSourcesAllowed })
      .from(tenants)
      .where(eq(tenants.id, tenantId)),
  );
  if (!tenant?.allowed) {
    throw forbidden(
      "BookStack und Atera können nur Firmen verbinden, die Ihr IT-Partner dafür freigegeben hat.",
    );
  }
}

async function assertNoSource(db: Database, tenantId: string, collectionId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const collection = await getCollection(tx, tenantId, collectionId);
    if (await getKnowledgeSource(tx, tenantId, collection.id)) {
      throw conflict("Diese Sammlung ist bereits mit einer Quelle verbunden.");
    }
    return collection;
  });
}

/* --------------------------------------------------------------- BookStack */

const bookStackSecret = z.object({ tokenId: z.string(), tokenSecret: z.string() });
const bookStackSettings = z.object({ baseUrl: z.string() });

/**
 * Connects a BookStack instance after a test call. The token needs read access only; it is
 * stored encrypted and never shown again.
 */
export async function connectBookStack(
  db: Database,
  input: {
    tenantId: string;
    collectionId: string;
    baseUrl: string;
    tokenId: string;
    tokenSecret: string;
    actorId: string;
    env?: ConnectorEnv;
  },
) {
  const env = input.env ?? connectorEnv();
  const tokenId = input.tokenId.trim();
  const tokenSecret = input.tokenSecret.trim();
  if (!tokenId || !tokenSecret) throw validationError("Bitte Token-ID und Token-Secret angeben.");
  await assertPartnerSourcesAllowed(db, input.tenantId);
  const collection = await assertNoSource(db, input.tenantId, input.collectionId);
  // Test before saving: wrong URL or token fail here, not in the background. One small request.
  const { baseUrl, books } = await userFacing(async () => {
    const url = await assertSafeBaseUrl(input.baseUrl.replace(/\/api\/?$/, ""), env.allowPrivate);
    return {
      baseUrl: url,
      books: await testBookStack({
        baseUrl: url,
        tokenId,
        tokenSecret,
        allowPrivate: env.allowPrivate,
      }),
    };
  });
  const host = new URL(baseUrl).host;
  return withTenant(db, input.tenantId, async (tx) => {
    const [source] = await tx
      .insert(knowledgeSources)
      .values({
        tenantId: input.tenantId,
        collectionId: collection.id,
        provider: "bookstack",
        displayName: `BookStack ${host}`,
        settings: { baseUrl },
        secret: encryptSecret(
          JSON.stringify({ tokenId, tokenSecret }),
          secretOwner(input.tenantId, collection.id),
        ),
        createdBy: input.actorId,
      })
      .returning();
    await appendAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.actorId,
      action: "knowledge.source_connected",
      targetType: "knowledge_collection",
      targetId: collection.id,
      metadata: { provider: "bookstack", host, books },
    });
    return source!;
  });
}

/** Mirrors all published BookStack pages (as Markdown) into the collection. */
export async function syncBookStackSource(
  db: Database,
  input: {
    tenantId: string;
    sourceId: string;
    enqueueIngest: (documentId: string) => Promise<void>;
    env?: ConnectorEnv;
    now?: Date;
  },
): Promise<SyncResult> {
  return runSync(db, input, "BookStack", async (source, result, progress, checkTime) => {
    const env = input.env ?? connectorEnv();
    const { baseUrl } = bookStackSettings.parse(source.settings);
    await assertPartnerSourcesAllowed(db, input.tenantId);
    const secret = bookStackSecret.parse(
      JSON.parse(
        decryptSecret(source.secret ?? "", secretOwner(source.tenantId, source.collectionId)),
      ),
    );
    const config: BookStackConfig = {
      // Checked again on every run: the address could resolve differently by now.
      baseUrl: await assertSafeBaseUrl(baseUrl, env.allowPrivate),
      ...secret,
      allowPrivate: env.allowPrivate,
    };
    const books = new Map((await listBooks(config)).map((book) => [book.id, book]));
    const pages = await listPages(config);
    const known = await knownVersions(db, input.tenantId, source.id);

    await eachLimited(pages, CONCURRENCY, async (page) => {
      checkTime();
      result.seen += 1;
      const id = String(page.id);
      if (known.get(id) === page.updated_at) return;
      try {
        const markdown = await exportPageMarkdown(config, page.id);
        const bytes = new TextEncoder().encode(markdown);
        const fileName = `${page.slug}.md`;
        const kind = bytes.byteLength <= MAX_FILE_BYTES ? detectKind(fileName, bytes) : null;
        if (!kind || markdown.trim().length === 0) {
          result.skipped += 1;
          return;
        }
        const book = books.get(page.book_id);
        const stored = await withTenant(db, input.tenantId, (tx) =>
          upsertSourceDocument(tx, {
            tenantId: input.tenantId,
            collectionId: source.collectionId,
            sourceId: source.id,
            item: {
              id,
              fileName,
              title: book ? `${book.name} – ${page.name}` : page.name,
              version: page.updated_at,
              url: book ? pageUrl(config.baseUrl, book.slug, page.slug) : null,
            },
            bytes,
            kind,
          }),
        );
        if ("duplicate" in stored) {
          result.skipped += 1;
          return;
        }
        await input.enqueueIngest(stored.documentId);
        result.imported += 1;
      } catch {
        result.failed += 1;
      }
      if (result.seen % 50 === 0) await progress();
    });

    // Pages deleted in BookStack (or turned into drafts) disappear here too.
    const current = new Set(pages.map((page) => String(page.id)));
    const gone = [...known.keys()].filter((id) => !current.has(id));
    if (gone.length > 0) {
      const removed = await withTenant(db, input.tenantId, (tx) =>
        tx
          .delete(knowledgeDocuments)
          .where(
            and(
              eq(knowledgeDocuments.sourceId, source.id),
              inArray(knowledgeDocuments.sourceItemId, gone),
            ),
          )
          .returning({ id: knowledgeDocuments.id }),
      );
      result.removed += removed.length;
    }
  });
}

/* ------------------------------------------------------------------- Atera */

const ateraSecret = z.object({ apiKey: z.string() });
const ateraSettings = z.object({ monthsBack: z.number().int().min(1).max(60) });

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/**
 * Credentials typed into tickets ("Passwort: …", "PIN=…", "API-Key: …"): the value is removed,
 * the label stays (security review 2, finding 6).
 */
const CREDENTIAL =
  /\b(passw(?:ort|ord)|kennwort|pwd|pw|pin|puk|zugangsdaten|api[- ]?key|api[- ]?schlüssel|lizenzschlüssel|license key|token|secret|wlan[- ]?schlüssel|wpa[- ]?key)\b\s*[:=]\s*[^\s,;]+/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g;
const PHONE_CANDIDATE = /(?:\+|\b00)?\d[\d\s/().-]{5,}\d/g;
const DATE_LIKE =
  /^(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{2,4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/;

/**
 * Data minimisation for ticket texts: e-mail addresses, phone numbers and IBANs are replaced,
 * HTML is reduced to text. Names in free text cannot be detected reliably (docs/adr/0010).
 */
export function maskPersonalData(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(CREDENTIAL, (_match, label: string) => `${label}: [entfernt]`)
    .replace(EMAIL, "[E-Mail]")
    .replace(IBAN, "[IBAN]")
    .replace(PHONE_CANDIDATE, (match) => {
      const digits = match.replace(/\D/g, "").length;
      return digits >= 7 && !DATE_LIKE.test(match.trim()) ? "[Telefon]" : match;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A solved ticket as a knowledge document: problem, course and solution – no contact data.
 * One section without sub-headings, so search returns problem and solution together.
 */
export function ticketToMarkdown(ticket: AteraTicket, comments: AteraComment[]): string {
  const number = ticket.TicketNumber ?? ticket.TicketID;
  const facts = [
    ticket.CustomerName ? `Kunde: ${ticket.CustomerName}` : null,
    ticket.TicketType ? `Art: ${ticket.TicketType}` : null,
    ticket.TicketStatus ? `Status: ${ticket.TicketStatus}` : null,
    ticket.CreatedDate ? `Erstellt: ${ticket.CreatedDate.slice(0, 10)}` : null,
  ].filter((fact): fact is string => fact !== null);
  const lines = [
    `# Ticket ${number}: ${maskPersonalData(ticket.TicketTitle ?? "Ohne Titel")}`,
    "",
    facts.join(" · "),
  ];
  for (const comment of comments) {
    const label = comment.internal ? "Interne Notiz (Technik)" : "Nachricht";
    const date = comment.date ? ` – ${comment.date.slice(0, 10)}` : "";
    lines.push("", `**${label}${date}:** ${maskPersonalData(comment.text)}`);
  }
  if (comments.length === 0) lines.push("", "Keine Kommentare.");
  return `${lines.join("\n")}\n`;
}

/** Connects Atera after a test call; only solved tickets of the last months are taken over. */
export async function connectAtera(
  db: Database,
  input: {
    tenantId: string;
    collectionId: string;
    apiKey: string;
    monthsBack: number;
    actorId: string;
    env?: ConnectorEnv;
  },
) {
  const env = input.env ?? connectorEnv();
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 10) throw validationError("Bitte den API-Schlüssel aus Atera angeben.");
  const settings = ateraSettings.safeParse({ monthsBack: input.monthsBack });
  if (!settings.success) throw validationError("Zeitraum: 1 bis 60 Monate.");
  await assertPartnerSourcesAllowed(db, input.tenantId);
  const collection = await assertNoSource(db, input.tenantId, input.collectionId);
  await userFacing(() => testAtera({ apiKey, baseUrl: env.ateraUrl }));
  return withTenant(db, input.tenantId, async (tx) => {
    const [source] = await tx
      .insert(knowledgeSources)
      .values({
        tenantId: input.tenantId,
        collectionId: collection.id,
        provider: "atera",
        displayName: "Atera – gelöste Tickets",
        settings: settings.data,
        secret: encryptSecret(
          JSON.stringify({ apiKey }),
          secretOwner(input.tenantId, collection.id),
        ),
        createdBy: input.actorId,
      })
      .returning();
    await appendAudit(tx, input.tenantId, {
      actorType: "user",
      actorId: input.actorId,
      action: "knowledge.source_connected",
      targetType: "knowledge_collection",
      targetId: collection.id,
      metadata: { provider: "atera", monthsBack: settings.data.monthsBack },
    });
    return source!;
  });
}

function monthsAgo(now: Date, months: number): string {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

/**
 * Takes over solved and closed tickets (problem, comments, solution) created within the chosen
 * period. Unchanged tickets are skipped by their last update; tickets that leave the period
 * stay (knowledge does not expire with the window – retention rules apply as for uploads).
 */
export async function syncAteraSource(
  db: Database,
  input: {
    tenantId: string;
    sourceId: string;
    enqueueIngest: (documentId: string) => Promise<void>;
    env?: ConnectorEnv;
    now?: Date;
  },
): Promise<SyncResult> {
  return runSync(db, input, "Atera", async (source, result, progress, checkTime) => {
    const env = input.env ?? connectorEnv();
    const { monthsBack } = ateraSettings.parse(source.settings);
    await assertPartnerSourcesAllowed(db, input.tenantId);
    const { apiKey } = ateraSecret.parse(
      JSON.parse(
        decryptSecret(source.secret ?? "", secretOwner(source.tenantId, source.collectionId)),
      ),
    );
    const config: AteraConfig = { apiKey, baseUrl: env.ateraUrl };
    const dateFrom = monthsAgo(input.now ?? new Date(), monthsBack);
    const known = await knownVersions(db, input.tenantId, source.id);

    for (const status of ATERA_STATUSES_FOR_KNOWLEDGE) {
      for (let page = 1; page <= MAX_ATERA_PAGES; page++) {
        const { tickets, hasMore } = await listTickets(config, { status, page, dateFrom });
        checkTime();
        await eachLimited(tickets, CONCURRENCY, async (ticket) => {
          checkTime();
          result.seen += 1;
          const id = String(ticket.TicketID);
          const version = ticket.LastUpdatedDate ?? ticket.CreatedDate ?? status;
          if (known.get(id) === version) return;
          try {
            const comments = await listTicketComments(config, ticket.TicketID);
            const bytes = new TextEncoder().encode(ticketToMarkdown(ticket, comments));
            if (bytes.byteLength > MAX_FILE_BYTES) {
              result.skipped += 1;
              return;
            }
            const number = ticket.TicketNumber ?? ticket.TicketID;
            const stored = await withTenant(db, input.tenantId, (tx) =>
              upsertSourceDocument(tx, {
                tenantId: input.tenantId,
                collectionId: source.collectionId,
                sourceId: source.id,
                item: {
                  id,
                  fileName: `ticket-${number}.md`,
                  title: `Ticket ${number}: ${maskPersonalData(ticket.TicketTitle ?? "")}`.trim(),
                  version,
                  url: null,
                },
                bytes,
                kind: "markdown",
              }),
            );
            if ("duplicate" in stored) {
              result.skipped += 1;
              return;
            }
            await input.enqueueIngest(stored.documentId);
            result.imported += 1;
          } catch {
            result.failed += 1;
          }
        });
        await progress();
        if (!hasMore) break;
      }
    }
  });
}

/* ------------------------------------------------------------------ shared */

type SourceRow = typeof knowledgeSources.$inferSelect;

async function knownVersions(db: Database, tenantId: string, sourceId: string) {
  const rows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        itemId: knowledgeDocuments.sourceItemId,
        version: knowledgeDocuments.sourceVersion,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.sourceId, sourceId)),
  );
  return new Map(rows.filter((r) => r.itemId !== null).map((r) => [r.itemId!, r.version]));
}

/** Claim, progress, final state and error handling – the same for every provider. */
async function runSync(
  db: Database,
  input: { tenantId: string; sourceId: string; now?: Date },
  service: string,
  work: (
    source: SourceRow,
    result: SyncResult,
    progress: () => Promise<void>,
    checkTime: () => void,
  ) => Promise<void>,
): Promise<SyncResult> {
  const { tenantId, sourceId } = input;
  const result: SyncResult = {
    status: "done",
    seen: 0,
    imported: 0,
    removed: 0,
    skipped: 0,
    failed: 0,
    restarted: false,
  };
  if (!(await claimSync(db, tenantId, sourceId, input.now)))
    return { ...result, status: "skipped" };
  const [source] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)),
  );
  if (!source) return { ...result, status: "skipped" };
  const counters = () => ({
    itemsSeen: result.seen,
    itemsImported: result.imported,
    itemsSkipped: result.skipped + result.failed,
  });
  const progress = async () => {
    await withTenant(db, tenantId, (tx) =>
      tx.update(knowledgeSources).set(counters()).where(eq(knowledgeSources.id, sourceId)),
    );
  };
  const deadline = Date.now() + SYNC_DEADLINE_MS;
  const checkTime = () => {
    if (Date.now() > deadline) {
      throw new ConnectorError(
        504,
        "deadline",
        "Der Abgleich hat das Zeitlimit von 20 Minuten erreicht; der nächste Lauf macht weiter.",
      );
    }
  };
  try {
    await work(source, result, progress, checkTime);
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(knowledgeSources)
        .set({
          status: "idle",
          lastSyncAt: new Date(),
          lastError:
            result.failed > 0
              ? `${result.failed} Einträge konnten nicht geladen werden und werden beim nächsten Abgleich erneut versucht.`
              : null,
          ...counters(),
        })
        .where(eq(knowledgeSources.id, sourceId)),
    );
    return result;
  } catch (error) {
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(knowledgeSources)
        .set({
          status: "error",
          lastError: sourceErrorMessage(error, service).slice(0, 500),
          ...counters(),
        })
        .where(eq(knowledgeSources.id, sourceId)),
    );
    return { ...result, status: "error" };
  }
}

/** Runs the sync that fits the source's provider (worker job). */
export async function syncKnowledgeSource(
  db: Database,
  input: {
    tenantId: string;
    sourceId: string;
    enqueueIngest: (documentId: string) => Promise<void>;
    microsoft?: MicrosoftAppConfig | null;
    env?: ConnectorEnv;
    now?: Date;
  },
): Promise<SyncResult & { provider: string | null }> {
  const [source] = await withTenant(db, input.tenantId, (tx) =>
    tx
      .select({ provider: knowledgeSources.provider })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, input.sourceId)),
  );
  const provider = source?.provider ?? null;
  const result =
    provider === "bookstack"
      ? await syncBookStackSource(db, input)
      : provider === "atera"
        ? await syncAteraSource(db, input)
        : provider === "sharepoint"
          ? await syncSharePointSource(db, {
              ...input,
              ...(input.microsoft !== undefined ? { config: input.microsoft } : {}),
            })
          : ({
              status: "skipped",
              seen: 0,
              imported: 0,
              removed: 0,
              skipped: 0,
              failed: 0,
              restarted: false,
            } satisfies SyncResult);
  return { ...result, provider };
}
