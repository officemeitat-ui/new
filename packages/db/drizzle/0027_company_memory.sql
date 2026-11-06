ALTER TABLE "knowledge_collections" ADD COLUMN "kind" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "origin" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_collections_tenant_memory_uq" ON "knowledge_collections" USING btree ("tenant_id") WHERE "knowledge_collections"."kind" = 'memory';--> statement-breakpoint
-- Documents of connected sources (SharePoint, BookStack, Atera) were created before "origin".
UPDATE "knowledge_documents" SET "origin" = 'source' WHERE "source_id" IS NOT NULL;
