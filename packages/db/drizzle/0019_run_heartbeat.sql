ALTER TABLE "runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");