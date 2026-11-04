CREATE TABLE "partner_agent_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_template_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "partner_template_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "partner_template_version" integer;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "rolled_out_version_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_agent_templates" ADD CONSTRAINT "partner_agent_templates_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_agent_templates" ADD CONSTRAINT "partner_agent_templates_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_agent_templates_partner_idx" ON "partner_agent_templates" USING btree ("partner_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_partner_template_id_partner_agent_templates_id_fk" FOREIGN KEY ("partner_template_id") REFERENCES "public"."partner_agent_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_tenant_partner_template_uq" ON "agents" USING btree ("tenant_id","partner_template_id");