-- Fifth one-off wipe. Same shape as 0019, 0020, 0022 and 0023.
--
-- Every shape currently in the table was clustered at shapeLinkM 1000 and
-- hulled convexly. Both of those just changed:
--
--   * marks now link into one territory within 500m rather than 1000m, so
--     the same dots would form different clusters — and the ones already
--     merged across a long gap stay merged, because the cluster is rebuilt
--     from the marks each time and those marks are still there
--   * boundaries now follow the walk (concaveman) instead of spanning it
--
-- Which means the exact thing that prompted the change — a territory
-- reaching across ground nobody walked — would persist in the existing
-- data for markTtlDays regardless of the new rules. Measured before the
-- change: 9% of edges over 400m, up to 679m.
--
-- A MIGRATION, not an endpoint, so it runs exactly once on deploy and
-- leaves nothing behind that could wipe a live city later. Replaying it on
-- a fresh database truncates two empty tables.
--
-- Bots do not seed, so the city starts empty and fills as they walk.
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
