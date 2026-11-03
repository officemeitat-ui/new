CREATE TABLE "price_tables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"input_per_m_tok" numeric(12, 6) NOT NULL,
	"output_per_m_tok" numeric(12, 6) NOT NULL,
	"cache_read_per_m_tok" numeric(12, 6) NOT NULL,
	"cache_write_per_m_tok" numeric(12, 6) NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "usd_eur_rate" numeric(10, 6);--> statement-breakpoint
CREATE UNIQUE INDEX "price_tables_model_valid_from_uq" ON "price_tables" USING btree ("model","valid_from");