-- Seventh one-off wipe, same shape as 0019, 0020, 0022, 0023, 0024 and 0025.
--
-- Every bot in the city was carrying at least twice botMaxMarks — all thirty
-- of them at the payload's 24-mark cap, on distinct positions, a day after
-- the last wipe. The ceiling is now an invariant rather than a gate, so the
-- map would have healed itself over the next round of marking; this takes
-- the shorter road and starts the city from nothing instead.
--
-- What it costs: the bots' oversized ranges were the only record of the leak
-- as it stood. The mp_bot_over_cap warning is what watches for it now.
--
-- A MIGRATION, not an endpoint, so it runs exactly once on deploy and leaves
-- nothing behind that could wipe a live city later. Replaying it on a fresh
-- database truncates two empty tables.
--
-- Bots do not seed, so the city starts empty and fills as they walk — this
-- time at the size it was designed to be.
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
