-- One-off wipe of all territory, so the mechanic can be watched building
-- itself from nothing under the current rules.
--
-- Everything up to here was laid down by earlier versions: hulls that
-- overlapped each other freely, bot patches seeded at random offsets that
-- sometimes landed on top of one another, and marks made before strength
-- and contest existed. The partition resolves all of that correctly, but
-- it resolves it into a picture nobody designed — and a tangle inherited
-- from three different rule sets is a bad thing to judge the feature by.
--
-- Done as a MIGRATION rather than an endpoint on purpose. It runs exactly
-- once, on deploy, and leaves no "delete everyone's territory" button
-- behind in a running server. Replaying it on a fresh database truncates
-- two empty tables and costs nothing.
--
-- The bots re-seed themselves on the next boot (seedBotTerritory no-ops
-- only while a bot still holds live marks), this time at their new
-- deterministic home positions. Players simply start marking again.
--
-- IRREVERSIBLE. Every claim in the database goes.
TRUNCATE TABLE "territory_raids";
TRUNCATE TABLE "territory_marks";

-- The companion's cooldown anchor points at a mark that no longer exists.
-- Left alone, the spacing rule would keep measuring against a ghost and
-- refuse the first mark of the new era anywhere near it.
UPDATE "companion_state"
SET "last_mark_at" = NULL,
    "last_mark_lat" = NULL,
    "last_mark_lng" = NULL,
    "on_home_ground" = false;
