-- Daily-task progress per user per local date. Promoted from
-- localStorage so progress survives a cache wipe and syncs across
-- devices on the same userId.
--
-- Composite PK on (user_id, date) — at most one row per user per
-- calendar day. The client tells us its local date; we don't track
-- timezones server-side. Yesterday's row stays around for history.
CREATE TABLE IF NOT EXISTS "daily_tasks" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "date" text NOT NULL,
  "tokens" integer NOT NULL DEFAULT 0,
  "bones" integer NOT NULL DEFAULT 0,
  "lost_pet_checks" integer NOT NULL DEFAULT 0,
  "spot_visits" integer NOT NULL DEFAULT 0,
  "sightings" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  CONSTRAINT "daily_tasks_pk" PRIMARY KEY ("user_id", "date")
);
