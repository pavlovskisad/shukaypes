-- Second one-off wipe of all territory, same reasoning as 0019.
--
-- What's in the database was claimed under rules that have since changed
-- again: bots were frozen at their five seed marks by a spacing rule that
-- refused to let them add any (every visit renewed instead), and the mood
-- gates were still refusing player marks. So the current picture is five
-- dots per bot in a patch they never grew, plus whatever the player
-- managed around them — not a picture of how the mechanic now behaves.
--
-- Same shape as 0019: a MIGRATION, not an endpoint, so it runs exactly
-- once on deploy and leaves nothing behind that can wipe a live city.
-- Replaying it on a fresh database truncates two empty tables.
--
-- Bots re-seed on the next boot and, this time, actually grow their patch
-- as they walk it (up to botMaxMarks).
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
