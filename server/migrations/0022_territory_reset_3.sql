-- Third one-off wipe of all territory, same shape and reasoning as 0019
-- and 0020.
--
-- Everything currently claimed was claimed under rules that have since
-- changed, in most cases several times over in a single session:
--
--   * marks used to land on ground their owner already held, so patches
--     are full of dots that never moved a border and were only ever
--     topping up a scent
--   * bots roamed and marked on a completely different tempo — half as
--     many trips ended anywhere worth marking, and a mark was 13 minutes
--     apart rather than 5
--   * the partition that turns those marks into ground has been rewritten
--     around them: claims are cut differently, and clipper slivers were
--     being kept as territory rather than discarded
--
-- So the picture in the database is an archaeology of five different
-- rulesets layered on top of each other, not a picture of how the mechanic
-- now behaves. Reading anything off it — whose ground is whose, whether a
-- border looks right, whether the tempo feels good — means reading the
-- history rather than the rules.
--
-- A MIGRATION, not an endpoint, so it runs exactly once on deploy and
-- leaves nothing behind that could wipe a live city later. Replaying it on
-- a fresh database truncates two empty tables.
--
-- Bots re-seed themselves on the next boot, and now grow their patches by
-- walking the frontier rather than circling home.
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
