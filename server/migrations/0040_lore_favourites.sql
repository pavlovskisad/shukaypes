-- Somewhere to keep the places a walker liked.
--
-- The sniff press and the walk stops surface ~2700 landmarks one at a
-- time, and each one is gone the moment its bubble closes. Once the
-- "read more" started carrying real stories (0039), people began
-- wanting to find a place again, and the only way was to stand near it
-- and hope the random pick landed on it. This is the heart under the
-- story, and the list behind it.
--
-- Composite key: a second tap is a no-op, never a duplicate row. Both
-- foreign keys cascade — a deleted user takes their list with them, and
-- a landmark that ever leaves kyiv_lore takes its hearts.
--
-- Additive; DROP TABLE reverses it.
CREATE TABLE IF NOT EXISTS "lore_favourites" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "lore_id" text NOT NULL REFERENCES "kyiv_lore"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("user_id", "lore_id")
);
