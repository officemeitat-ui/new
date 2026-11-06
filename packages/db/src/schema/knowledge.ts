import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_columns";
import { authUser } from "./auth";
import { tenants } from "./tenancy";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/** "proposed": suggested by an agent, invisible to search until a person confirms it. */
export type KnowledgeDocumentStatus = "proposed" | "processing" | "ready" | "failed";
/** Where a document comes from. */
export type KnowledgeDocumentOrigin = "upload" | "source" | "article" | "memory";
/** "memory": the company's memory (Unternehmensgedächtnis), one per tenant. */
export type KnowledgeCollectionKind = "standard" | "memory";
export type KnowledgeSourceStatus = "idle" | "syncing" | "error";

/** A folder of documents (M5). Agents are given collections, not single documents. */
export const knowledgeCollections = pgTable(
  "knowledge_collections",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    kind: text().$type<KnowledgeCollectionKind>().notNull().default("standard"),
    createdBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("knowledge_collections_tenant_name_uq").on(t.tenantId, t.name),
    uniqueIndex("knowledge_collections_tenant_memory_uq")
      .on(t.tenantId)
      .where(sql`${t.kind} = 'memory'`),
  ],
);

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    collectionId: uuid()
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    title: text().notNull(),
    fileName: text().notNull(),
    /** pdf | docx | markdown | text */
    kind: text().notNull(),
    sizeBytes: integer().notNull(),
    sha256: text().notNull(),
    status: text().$type<KnowledgeDocumentStatus>().notNull().default("processing"),
    origin: text().$type<KnowledgeDocumentOrigin>().notNull().default("upload"),
    error: text(),
    pageCount: integer(),
    chunkCount: integer().notNull().default(0),
    createdBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    /** Set for documents that come from a synced source (SharePoint). */
    sourceId: uuid().references((): AnyPgColumn => knowledgeSources.id, { onDelete: "cascade" }),
    /** SharePoint driveItem id and content tag (cTag) – unchanged files are skipped. */
    sourceItemId: text(),
    sourceVersion: text(),
    sourceUrl: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("knowledge_documents_collection_sha_uq").on(t.collectionId, t.sha256),
    uniqueIndex("knowledge_documents_source_item_uq").on(t.sourceId, t.sourceItemId),
    index("knowledge_documents_tenant_collection_idx").on(t.tenantId, t.collectionId),
  ],
);

/**
 * The original file, kept apart so document lists never load it. Stored in Postgres for now
 * (ADR 0007); the table is the seam for moving to S3-compatible storage later.
 */
export const knowledgeFiles = pgTable("knowledge_files", {
  documentId: uuid()
    .primaryKey()
    .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
  tenantId: uuid()
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  content: bytea().notNull(),
});

/** Searchable pieces of a document with German full-text index. */
export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid()
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    collectionId: uuid()
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    page: integer(),
    heading: text(),
    text: text().notNull(),
    tsv: tsvector()
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('german', coalesce(heading, '')), 'A') || to_tsvector('german', text)`,
      ),
  },
  (t) => [
    uniqueIndex("knowledge_chunks_document_seq_uq").on(t.documentId, t.seq),
    index("knowledge_chunks_tsv_idx").using("gin", t.tsv),
    index("knowledge_chunks_tenant_collection_idx").on(t.tenantId, t.collectionId),
  ],
);

/**
 * A SharePoint document library synced into a collection (M5/M6). The delta link makes every
 * sync after the first one incremental (only changes). One source per collection.
 */
export type KnowledgeSourceProvider = "sharepoint" | "bookstack" | "atera";

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: id(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    collectionId: uuid()
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    provider: text().$type<KnowledgeSourceProvider>().notNull().default("sharepoint"),
    /** SharePoint only. */
    siteId: text(),
    siteName: text(),
    siteUrl: text(),
    driveId: text(),
    driveName: text(),
    /** SharePoint delta link (other providers compare versions per item). */
    deltaLink: text(),
    /** Shown in the UI, e.g. "doku.me-it.at" or "Atera – gelöste Tickets". */
    displayName: text(),
    /** Provider settings without secrets (BookStack URL, Atera filters …). */
    settings: jsonb().$type<Record<string, unknown>>(),
    /** API credentials, encrypted (packages/core/src/crypto.ts); never sent to the browser. */
    secret: text(),
    status: text().$type<KnowledgeSourceStatus>().notNull().default("idle"),
    syncStartedAt: timestamp({ withTimezone: true }),
    lastSyncAt: timestamp({ withTimezone: true }),
    lastError: text(),
    /** Progress of the current or last sync. */
    itemsSeen: integer().notNull().default(0),
    itemsImported: integer().notNull().default(0),
    itemsSkipped: integer().notNull().default(0),
    createdBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("knowledge_sources_collection_uq").on(t.collectionId),
    index("knowledge_sources_tenant_idx").on(t.tenantId),
  ],
);
