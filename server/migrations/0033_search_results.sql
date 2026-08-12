-- Every completed search, found or not.
--
-- `sightings` only gets a row when the answer is "yes, I saw it". The
-- other answer — zone walked, nothing there — is the majority case and
-- the one that proves somebody actually searched, and it has never been
-- written anywhere but an ephemeral log line. This table is where it goes.
--
-- HAND-WRITTEN, for the reason recorded in 0032: migrations/meta has
-- snapshots for 0000-0002 and 0032, so `drizzle-kit generate` still has
-- gaps to diff across and has already once emitted a file that would have
-- failed mid-migration against production. Only the new objects are here,
-- every statement idempotent, so a re-run cannot break a live database.
--
-- Additive only. It creates one table and two indexes, touches no
-- existing table, and takes no lock anything else is waiting on.

CREATE TABLE IF NOT EXISTS "search_results" (
	"id" text PRIMARY KEY NOT NULL,
	"dog_id" text NOT NULL,
	"user_id" text,
	"seen" boolean NOT NULL,
	"paws" integer NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "search_results" ADD CONSTRAINT "search_results_dog_id_lost_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."lost_dogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "search_results" ADD CONSTRAINT "search_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_results_created_at_idx" ON "search_results" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_results_dog_id_idx" ON "search_results" USING btree ("dog_id");
