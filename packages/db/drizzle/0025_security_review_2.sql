CREATE TABLE "integration_directory_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_tenant_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "partner_sources_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_directory_history" ADD CONSTRAINT "integration_directory_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_history_uq" ON "integration_directory_history" USING btree ("provider","external_tenant_id","tenant_id");