import { createHash } from "node:crypto";
import {
  deltaPage,
  downloadItem,
  GraphError,
  listLibraries,
  searchSites,
  type DriveItem,
} from "@nexus/connectors";
import { conflict, notFound } from "@nexus/core";
import { and, eq, inArray, sql, withSystem, withTenant, type Database, type Tx } from "@nexus/db";
import { knowledgeDocuments, knowledgeFiles, knowledgeSources } from "@nexus/db/schema";
import { detectKind, MAX_FILE_BYTES } from "@nexus/knowledge/detect";
import { appendAudit } from "./audit";
import { tenantGraph, type MicrosoftAppConfig } from "./integrations";
import { getCollection } from "./knowledge";

/** A sync that has been "running" this long is treated as crashed and may be restarted. */
export const STALE_SYNC_MS = 30 * 60_000;
/**
 * Overall time limit of one sync, below STALE_SYNC_MS, so the recovery job never hands a source
 * to a second sync while the first one still runs (security review 2). The next run continues:
 * unchanged items are skipped by their version.
 */
export const SYNC_DEADLINE_MS = 20 * 60_000;
const SUPPORTED_EXTENSIONS = new Set(["pdf", "docx", "md", "markdown", "txt"]);
const DOWNLOAD_CONCURRENCY = 4;

const extensionOf = (name: string) => name.toLowerCase().split(".").at(-1) ?? "";

/* --------------------------------------------------------------- browsing */

export async function findSharePointSites(
  db: Database,
  tenantId: string,
  query: string,
  config?: MicrosoftAppConfig | null,
) {
  return searchSites(await tenantGraph(db, tenantId, config), query);
}

export async function findSharePointLibraries(
  db: Database,
  tenantId: string,
  siteId: string,
  config?: MicrosoftAppConfig | null,
) {
  return listLibraries(await tenantGraph(db, tenantId, config), siteId);
}

/* ------------------------------------------------------------- connection */

export async function getKnowledgeSource(tx: Tx, tenantId: string, collectionId: string) {
  const [source] = await tx
    .select()
    .from(knowledgeSources)
    .where(
      and(eq(knowledgeSources.tenantId, tenantId), eq(knowledgeSources.collectionId, collectionId)),
    );
  return source ?? null;
}

export async function connectSharePointLibrary(
  tx: Tx,
  input: {
    tenantId: string;
    collectionId: string;
    site: { id: string; name: string; webUrl: string };
    library: { id: string; name: string };
    actorId: string;
  },
) {
  const collection = await getCollection(tx, input.tenantId, input.collectionId);
  if (await getKnowledgeSource(tx, input.tenantId, collection.id)) {
    throw conflict("Diese Sammlung ist bereits mit einer Quelle verbunden.");
  }
  const [source] = await tx
    .insert(knowledgeSources)
    .values({
      tenantId: input.tenantId,
      collectionId: collection.id,
      siteId: input.site.id,
      siteName: input.site.name.slice(0, 200),
      siteUrl: input.site.webUrl || null,
      driveId: input.library.id,
      driveName: input.library.name.slice(0, 200),
      createdBy: input.actorId,
    })
    .returning();
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "knowledge.source_connected",
    targetType: "knowledge_collection",
    targetId: collection.id,
    metadata: {
      provider: "sharepoint",
      site: input.site.name,
      library: input.library.name,
    },
  });
  return source!;
}

/** Removes the connection and the documents that came from it (uploads stay). */
export async function disconnectKnowledgeSource(
  tx: Tx,
  input: { tenantId: string; collectionId: string; actorId: string },
) {
  const source = await getKnowledgeSource(tx, input.tenantId, input.collectionId);
  if (!source) throw notFound("Keine Verbindung vorhanden.");
  await tx.delete(knowledgeSources).where(eq(knowledgeSources.id, source.id));
  await appendAudit(tx, input.tenantId, {
    actorType: "user",
    actorId: input.actorId,
    action: "knowledge.source_disconnected",
    targetType: "knowledge_collection",
    targetId: input.collectionId,
    metadata: {
      provider: source.provider,
      name: source.displayName ?? `${source.siteName ?? ""} / ${source.driveName ?? ""}`,
    },
  });
}

/** All sources, for the hourly sync (system job). */
export async function listAllKnowledgeSources(db: Database) {
  return withSystem(db, "knowledge sources: hourly sync of all sources", (tx) =>
    tx
      .select({ id: knowledgeSources.id, tenantId: knowledgeSources.tenantId })
      .from(knowledgeSources),
  );
}

/**
 * Marks a source as syncing, unless a sync is already running. A sync stuck for longer than
 * STALE_SYNC_MS (worker crash) may be taken over. Returns false if someone else is syncing.
 */
export async function claimSync(
  db: Database,
  tenantId: string,
  sourceId: string,
  now = new Date(),
) {
  const stale = new Date(now.getTime() - STALE_SYNC_MS);
  const claimed = await withTenant(db, tenantId, (tx) =>
    tx
      .update(knowledgeSources)
      .set({
        status: "syncing",
        syncStartedAt: now,
        lastError: null,
        itemsSeen: 0,
        itemsImported: 0,
        itemsSkipped: 0,
      })
      .where(
        and(
          eq(knowledgeSources.id, sourceId),
          sql`(${knowledgeSources.status} <> 'syncing' or ${knowledgeSources.syncStartedAt} < ${stale})`,
        ),
      )
      .returning({ id: knowledgeSources.id }),
  );
  return claimed.length === 1;
}

/* -------------------------------------------------------------------- sync */

export type SyncResult = {
  status: "done" | "skipped" | "error";
  seen: number;
  imported: number;
  removed: number;
  skipped: number;
  failed: number;
  restarted: boolean;
};

/** One item of an external source, stored as a knowledge document (all providers). */
export type SourceItem = {
  /** Stable ID in the source system (SharePoint item, BookStack page, Atera ticket). */
  id: string;
  fileName: string;
  title: string;
  /** Changes whenever the item changes (cTag/eTag, updated_at …). */
  version: string | null;
  url: string | null;
};

/** Creates or replaces the document of a source item; parsing happens in the ingest job. */
export async function upsertSourceDocument(
  tx: Tx,
  input: {
    tenantId: string;
    collectionId: string;
    sourceId: string;
    item: SourceItem;
    bytes: Uint8Array;
    kind: string;
  },
): Promise<{ documentId: string } | { duplicate: true }> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const [duplicate] = await tx
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.collectionId, input.collectionId),
        eq(knowledgeDocuments.sha256, sha256),
        sql`${knowledgeDocuments.sourceItemId} is distinct from ${input.item.id}`,
      ),
    );
  if (duplicate) return { duplicate: true };

  const values = {
    title: input.item.title.slice(0, 200) || input.item.fileName,
    fileName: input.item.fileName.slice(0, 200),
    kind: input.kind,
    sizeBytes: input.bytes.byteLength,
    sha256,
    status: "processing" as const,
    error: null,
    sourceVersion: input.item.version,
    sourceUrl: input.item.url,
  };
  const [existing] = await tx
    .select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.sourceId, input.sourceId),
        eq(knowledgeDocuments.sourceItemId, input.item.id),
      ),
    );
  if (existing) {
    await tx.update(knowledgeDocuments).set(values).where(eq(knowledgeDocuments.id, existing.id));
    await tx
      .update(knowledgeFiles)
      .set({ content: Buffer.from(input.bytes) })
      .where(eq(knowledgeFiles.documentId, existing.id));
    return { documentId: existing.id };
  }
  const [created] = await tx
    .insert(knowledgeDocuments)
    .values({
      ...values,
      tenantId: input.tenantId,
      collectionId: input.collectionId,
      sourceId: input.sourceId,
      sourceItemId: input.item.id,
    })
    .returning({ id: knowledgeDocuments.id });
  await tx.insert(knowledgeFiles).values({
    documentId: created!.id,
    tenantId: input.tenantId,
    content: Buffer.from(input.bytes),
  });
  return { documentId: created!.id };
}

function sharePointItem(item: DriveItem): SourceItem {
  const name = (item.name ?? item.id).slice(0, 200);
  return {
    id: item.id,
    fileName: name,
    title:
      name
        .replace(/\.[^.]+$/, "")
        .replace(/_+/g, " ")
        .trim() || name,
    version: item.cTag ?? item.eTag ?? null,
    url: item.webUrl ?? null,
  };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/**
 * Synchronises one SharePoint library into its collection (worker job). The first run lists the
 * whole library; later runs only fetch changes via the stored delta link. New and changed files
 * (pdf, docx, md, txt up to 10 MB) are downloaded – four at a time – and handed to the normal
 * ingest; deleted files are removed. Progress is written after every page, so the UI can show it.
 */
export async function syncSharePointSource(
  db: Database,
  input: {
    tenantId: string;
    sourceId: string;
    config?: MicrosoftAppConfig | null;
    enqueueIngest: (documentId: string) => Promise<void>;
    now?: Date;
  },
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

  const [found] = await withTenant(db, tenantId, (tx) =>
    tx.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)),
  );
  if (!found?.driveId) return { ...result, status: "skipped" };
  const source = { ...found, driveId: found.driveId };

  const progress = () =>
    withTenant(db, tenantId, (tx) =>
      tx
        .update(knowledgeSources)
        .set({
          itemsSeen: result.seen,
          itemsImported: result.imported,
          itemsSkipped: result.skipped + result.failed,
        })
        .where(eq(knowledgeSources.id, sourceId)),
    );

  try {
    const graph = await tenantGraph(db, tenantId, input.config);
    let url: string | null = source.deltaLink;
    let full = url === null;
    const seenIds = new Set<string>();
    let deltaLink: string | undefined;

    const deadline = Date.now() + SYNC_DEADLINE_MS;
    while (true) {
      if (Date.now() > deadline) {
        throw new GraphError(
          504,
          "deadline",
          "Der Abgleich hat das Zeitlimit von 20 Minuten erreicht; der nächste Lauf macht weiter.",
        );
      }
      let page;
      try {
        page = await deltaPage(graph, source.driveId, url);
      } catch (error) {
        // 410 Gone: the stored state expired – enumerate everything again and reconcile.
        if (error instanceof GraphError && error.status === 410 && !full) {
          url = null;
          full = true;
          result.restarted = true;
          seenIds.clear();
          continue;
        }
        throw error;
      }

      const files = page.items.filter((item) => !item.folder);
      await eachLimited(files, DOWNLOAD_CONCURRENCY, async (item) => {
        result.seen += 1;
        seenIds.add(item.id);
        if (item.deleted) {
          const removed = await withTenant(db, tenantId, (tx) =>
            tx
              .delete(knowledgeDocuments)
              .where(
                and(
                  eq(knowledgeDocuments.sourceId, sourceId),
                  eq(knowledgeDocuments.sourceItemId, item.id),
                ),
              )
              .returning({ id: knowledgeDocuments.id }),
          );
          result.removed += removed.length;
          return;
        }
        if (!item.file) return;
        const name = item.name ?? "";
        if (!SUPPORTED_EXTENSIONS.has(extensionOf(name)) || (item.size ?? 0) > MAX_FILE_BYTES) {
          result.skipped += 1;
          return;
        }
        const [existing] = await withTenant(db, tenantId, (tx) =>
          tx
            .select({ version: knowledgeDocuments.sourceVersion })
            .from(knowledgeDocuments)
            .where(
              and(
                eq(knowledgeDocuments.sourceId, sourceId),
                eq(knowledgeDocuments.sourceItemId, item.id),
              ),
            ),
        );
        const version = item.cTag ?? item.eTag ?? null;
        if (existing && version !== null && existing.version === version) return; // unchanged

        try {
          const bytes = await downloadItem(graph, source.driveId, item, MAX_FILE_BYTES);
          const kind = detectKind(name, bytes);
          if (!kind) {
            result.skipped += 1;
            return;
          }
          const stored = await withTenant(db, tenantId, (tx) =>
            upsertSourceDocument(tx, {
              tenantId,
              collectionId: source.collectionId,
              sourceId,
              item: sharePointItem(item),
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
      });
      await progress();

      if (page.nextLink) {
        url = page.nextLink;
        continue;
      }
      deltaLink = page.deltaLink;
      break;
    }

    // After a full listing, documents of this source that no longer exist are removed.
    if (full) {
      const stale = await withTenant(db, tenantId, (tx) =>
        tx
          .select({ id: knowledgeDocuments.id, itemId: knowledgeDocuments.sourceItemId })
          .from(knowledgeDocuments)
          .where(eq(knowledgeDocuments.sourceId, sourceId)),
      );
      const gone = stale.filter((d) => d.itemId && !seenIds.has(d.itemId)).map((d) => d.id);
      if (gone.length > 0) {
        await withTenant(db, tenantId, (tx) =>
          tx.delete(knowledgeDocuments).where(inArray(knowledgeDocuments.id, gone)),
        );
        result.removed += gone.length;
      }
    }

    await withTenant(db, tenantId, (tx) =>
      tx
        .update(knowledgeSources)
        .set({
          status: "idle",
          deltaLink: deltaLink ?? source.deltaLink,
          lastSyncAt: new Date(),
          lastError:
            result.failed > 0
              ? `${result.failed} Datei(en) konnten nicht geladen werden und werden beim nächsten Abgleich erneut versucht.`
              : null,
          itemsSeen: result.seen,
          itemsImported: result.imported,
          itemsSkipped: result.skipped + result.failed,
        })
        .where(eq(knowledgeSources.id, sourceId)),
    );
    return result;
  } catch (error) {
    const message =
      error instanceof GraphError || (error instanceof Error && error.name === "AppError")
        ? error.message
        : "Der Abgleich mit SharePoint ist fehlgeschlagen. Der Fehler wurde protokolliert.";
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(knowledgeSources)
        .set({ status: "error", lastError: message.slice(0, 500) })
        .where(eq(knowledgeSources.id, sourceId)),
    );
    return { ...result, status: "error" };
  }
}

/** For the page: "is a sync of this source stuck?" */
export function isSyncStale(
  source: { status: string; syncStartedAt: Date | null },
  now = new Date(),
) {
  return (
    source.status === "syncing" &&
    source.syncStartedAt !== null &&
    now.getTime() - source.syncStartedAt.getTime() > STALE_SYNC_MS
  );
}
