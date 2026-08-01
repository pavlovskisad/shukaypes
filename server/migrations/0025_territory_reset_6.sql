-- Sixth one-off wipe, same shape as 0019, 0020, 0022, 0023 and 0024.
--
-- Dogs no longer walk into the Dnipro, so the territory already claimed out
-- on the water is the last thing in the table that could not be produced
-- under the current rules. It is also the one kind of ground nobody could
-- ever take back: you cannot walk there to mark it.
--
-- A MIGRATION, not an endpoint, so it runs exactly once on deploy and leaves
-- nothing behind that could wipe a live city later. Replaying it on a fresh
-- database truncates two empty tables.
--
-- Bots do not seed, so the city starts empty and fills as they walk — on
-- land this time.
--
-- IRREVERSIBLE. Every claim in the database goes.
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
