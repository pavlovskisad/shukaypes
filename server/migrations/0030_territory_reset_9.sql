-- Tenth wipe. The case for this one is a measurement, not a feeling.
--
-- Every rule that decides what a piece of ground LOOKS like has changed
-- since the last wipe, and stored ground never re-derives — it only
-- changes where somebody captures an edge, so a shape drawn under a dead
-- rule survives in any quiet corner indefinitely.
--
--   claims went from the whole transitive cluster to local
--   the claim radius went 500m -> 250m
--   the cadence went 150s/140m -> 20s/40m
--   the hull edge limit went 350m -> 120m, which is the curve itself
--
-- Measured on prod immediately before this: of 74 pieces holding 251ha,
-- TEN pieces spanning over 600m held 160ha — 64% of all the ground on the
-- map. A local claim cannot span more than about 500m by construction, so
-- every one of those is whole-cluster geometry. They also carry the rings
-- that dominate the payload: 119, 114, 91, 91 corners, sitting on the
-- 120-point ceiling.
--
-- Two thirds of the map being un-reshapeable leftovers is the whole
-- argument. The rest of the table would go on looking like the old game
-- next to ground drawn by the new one.
--
-- Marks go too. Under the rule that landed with this, a capture takes the
-- marks inside it — so the dots still sitting under other people's colour
-- from before that are the last thing in the database that the current
-- rules could not have produced.
--
-- Bots do not seed, so the city starts empty and fills as they walk: local
-- claims, 40m apart, outlines that follow the streets.
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
