CREATE TABLE IF NOT EXISTS "quests" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "dog_id" text REFERENCES "lost_dogs"("id") ON DELETE SET NULL,
  "type" text NOT NULL DEFAULT 'detective',
  "status" text NOT NULL DEFAULT 'active',
  "waypoints" jsonb NOT NULL,
  "current_index" integer NOT NULL DEFAULT 0,
  "reward_points" integer NOT NULL DEFAULT 50,
  "started_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "quests_active_idx" ON "quests" ("user_id", "status");
