CREATE TABLE IF NOT EXISTS "scrape_log" (
	"url" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"title" text,
	"dog_id" text,
	"parse_confidence" double precision,
	"ingest_action" text,
	"skip_reason" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scrape_log" ADD CONSTRAINT "scrape_log_dog_id_lost_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."lost_dogs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scrape_log_source_idx" ON "scrape_log" USING btree ("source","first_seen_at");