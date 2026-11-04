ALTER TABLE "knowledge_sources" ALTER COLUMN "site_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ALTER COLUMN "site_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ALTER COLUMN "drive_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ALTER COLUMN "drive_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD COLUMN "secret" text;