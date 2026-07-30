-- Fourth one-off wipe. Same shape and reasoning as 0019, 0020 and 0022.
--
-- This one is not a tidy-up, it is a necessity: the rules that produced
-- everything in these tables no longer exist.
--
--   * a claim used to be the hull of your marks grown outward by 150m, and
--     is now the hull itself. Every shape in the database was drawn under
--     the old rule and is 65-94% larger than the same marks would draw now
--   * marking near a rival used to DELETE their marks. So the mark set is
--     not a record of where dogs walked, it is what survived being deleted
--   * ground was split between neighbours by proximity (a Voronoi cell per
--     mark); it now goes to whoever marked most recently. Timestamps that
--     never mattered before now decide ownership, and the ones in here were
--     written when they did not
--   * marks linked into one territory within 350m and now do so within
--     1000m, so the same dots would cluster into completely different
--     shapes
--
-- Any picture built from this data is a picture of four dead rulesets.
--
-- A MIGRATION, not an endpoint, so it runs exactly once on deploy and
-- leaves nothing behind that could wipe a live city later. Replaying it on
-- a fresh database truncates two empty tables.
--
-- Bots no longer seed themselves either (botSeedMarks is 0), so the city
-- genuinely starts empty and fills as they walk.
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
