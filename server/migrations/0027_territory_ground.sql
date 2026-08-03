-- Ground becomes a thing that exists, instead of a thing recomputed.
--
-- A territory was the hull of a cluster of live marks, rebuilt from
-- scratch on every read. That cannot express losing a piece and keeping
-- the rest: with nowhere to remember the bite, an overrun dot could only
-- survive (and hand the ground back when the rival faded), die (and
-- collapse the shape — to NOTHING at three dots, since three is the
-- minimum that encloses anything), or move (and redraw the shape into
-- something that was never the cut).
--
-- So the ground is stored, marks grow it, and a capture cuts it once at
-- the moment it happens. Two owners can never overlap, and a read is a
-- read — which also takes clustering, hull-building and polygon
-- subtraction off the sync path, where they were the CPU bottleneck.
--
-- bbox columns rather than PostGIS: the only spatial question is "which
-- pieces are in this view", and a range scan answers it without the
-- deployment having to grow an extension.
CREATE TABLE IF NOT EXISTS "territory_ground" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "ring" jsonb NOT NULL,
  "holes" jsonb,
  "min_lat" double precision NOT NULL,
  "max_lat" double precision NOT NULL,
  "min_lng" double precision NOT NULL,
  "max_lng" double precision NOT NULL,
  "area_m2" double precision NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "territory_ground_user_idx" ON "territory_ground" ("user_id");
CREATE INDEX IF NOT EXISTS "territory_ground_bbox_idx"
  ON "territory_ground" ("min_lat", "max_lat", "min_lng", "max_lng");

-- Eighth wipe, and the one with the best reason: every claim in the table
-- was produced under a rule that no longer exists. Nothing carries over,
-- because there is nothing to carry it into — the old marks describe
-- shapes that were never stored.
--
-- Bots do not seed, so the city starts empty and fills as they walk.
--
-- IRREVERSIBLE. Every claim in the database goes.
TRUNCATE TABLE "territory_ground";
TRUNCATE TABLE "territory_raids";
TRUNCATE TABLE "territory_marks";

-- The companion's cooldown anchor points at a mark that no longer exists;
-- left alone the spacing rule keeps measuring against a ghost and refuses
-- the first mark of the new era anywhere near it.
UPDATE "companion_state"
SET "last_mark_at" = NULL,
    "last_mark_lat" = NULL,
    "last_mark_lng" = NULL,
    "on_home_ground" = false;
