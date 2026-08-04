-- Eleventh wipe, and the first one that is not fixing anything.
--
-- Every previous reset cleared ground the current rules could not have
-- produced: hulls from a claim rule that no longer existed, overlaps from
-- a race, confetti from a floor that was too low. This one clears a city
-- that is merely OLD — built correctly, but assembled while the rules
-- were still arriving one at a time.
--
-- What is worth seeing is a city where all of it applied from the first
-- mark: local claims, marks every 40m, boundaries that dig in at 120m, a
-- capture taking the scent with the ground, a floor under the fragments,
-- and pockets closing only when they are too small to mean anything. The
-- map that has been running since last night has each of those switched
-- on at a different hour, which is a different thing to look at and a
-- worse baseline for tuning against.
--
-- The alternative considered was filling the leftover pockets in place.
-- Rejected as disproportionate: with no PostGIS it means a hand-rolled
-- shoelace over nested JSONB to get each hole's area, and the cheap
-- approximation leaves area_m2 knowingly wrong until something else
-- touches that piece. The pockets are 1.6% of held ground and clear
-- themselves as blocks change hands.
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
