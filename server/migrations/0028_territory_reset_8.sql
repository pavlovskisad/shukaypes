-- Ninth wipe, and the only one that fixes something rather than tidying.
--
-- The ground in this table is corrupt, not merely old. Auditing prod found
-- two owners holding the same block — 91m inside one border, 41m inside the
-- other — which the model is built on never happening. The two holes that
-- allowed it are closed (a lock on the ground rather than on rows, and never
-- growing into ground we failed to cut), but neither one repairs an overlap
-- that is already stored. Nothing does: there is no rule for deciding, after
-- the fact, which of two owners should have had it.
--
-- The rest of the table is also drawn under a claim rule that no longer
-- exists — whole-cluster hulls up to a kilometre across — and with no decay
-- those pieces would sit there permanently.
--
-- Bots do not seed, so the city starts empty and fills as they walk, in
-- claims the size of a walk.
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
