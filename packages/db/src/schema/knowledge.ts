import { sql } from "drizzle-orm";
import { customType, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_columns";
import { authUser } from "./auth";
import { tenants } from "./tenancy";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export type KnowledgeDocumentStatus = "processing" | "ready" | "failed";

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
    createdBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("knowledge_collections_tenant_name_uq").on(t.tenantId, t.name)],
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
    error: text(),
    pageCount: integer(),
    chunkCount: integer().notNull().default(0),
    createdBy: uuid().references(() => authUser.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("knowledge_documents_collection_sha_uq").on(t.collectionId, t.sha256),
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
