CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"provider" text DEFAULT 'sharepoint' NOT NULL,
	"site_id" text NOT NULL,
	"site_name" text NOT NULL,
	"site_url" text,
	"drive_id" text NOT NULL,
	"drive_name" text NOT NULL,
	"delta_link" text,
	"status" text DEFAULT 'idle' NOT NULL,
	"sync_started_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_imported" integer DEFAULT 0 NOT NULL,
	"items_skipped" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "source_item_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "source_version" text;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_collection_id_knowledge_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."knowledge_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_collection_uq" ON "knowledge_sources" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "knowledge_sources_tenant_idx" ON "knowledge_sources" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_documents_source_item_uq" ON "knowledge_documents" USING btree ("source_id","source_item_id");