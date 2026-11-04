import type { KnowledgeIngestJob } from "@nexus/core";
import type { Logger } from "@nexus/core/logger";
import { withTenant, type Database } from "@nexus/db";
import { completeIngest, failIngest, loadDocumentForIngest } from "@nexus/domain";
import {
  chunkDocument,
  KNOWLEDGE_KINDS,
  parseDocument,
  ParseError,
  type KnowledgeKind,
} from "@nexus/knowledge";

export type KnowledgeIngestDeps = {
  db: Database;
  log: Logger;
  /** Whether BullMQ will not retry this job again; defaults to true (tests, single attempt). */
  finalAttempt?: boolean;
};

const isKind = (value: string): value is KnowledgeKind =>
  (KNOWLEDGE_KINDS as readonly string[]).includes(value);

/**
 * Extracts the text of an uploaded document, splits it into chunks and indexes them.
 * Idempotent: running it twice replaces the chunks. Parse problems end as "failed" with a
 * message for the user; the original file stays so it can be inspected.
 */
export async function processKnowledgeIngest(job: KnowledgeIngestJob, deps: KnowledgeIngestDeps) {
  const { db, log } = deps;
  const document = await withTenant(db, job.tenantId, (tx) =>
    loadDocumentForIngest(tx, job.documentId),
  );
  if (!document) {
    log.warn({ documentId: job.documentId }, "document is gone – skipping ingest");
    return { status: "skipped" as const };
  }

  try {
    if (!isKind(document.kind)) throw new ParseError("Dieser Dateityp wird nicht unterstützt.");
    const parsed = await parseDocument(document.kind, new Uint8Array(document.content));
    const chunks = chunkDocument(parsed);
    if (chunks.length === 0) throw new ParseError("Das Dokument enthält keinen lesbaren Text.");
    const pages = parsed.pages.map((p) => p.page).filter((p): p is number => p !== null);
    await withTenant(db, job.tenantId, (tx) =>
      completeIngest(tx, {
        tenantId: job.tenantId,
        documentId: document.id,
        collectionId: document.collectionId,
        pageCount: pages.length > 0 ? Math.max(...pages) : null,
        chunks,
      }),
    );
    log.info({ documentId: document.id, chunks: chunks.length }, "document indexed");
    return { status: "ready" as const, chunks: chunks.length };
  } catch (error) {
    // Unexpected errors (e.g. a database blip) are retried by BullMQ; only the last attempt
    // marks the document as failed, so it never stays "processing" (robustness review).
    if (!(error instanceof ParseError) && deps.finalAttempt === false) throw error;
    const message =
      error instanceof ParseError
        ? error.message
        : "Das Dokument konnte nicht verarbeitet werden. Der Fehler wurde protokolliert.";
    if (!(error instanceof ParseError))
      log.error({ documentId: document.id, err: error }, "ingest failed");
    await withTenant(db, job.tenantId, (tx) => failIngest(tx, document.id, message));
    return { status: "failed" as const, error: message };
  }
}
