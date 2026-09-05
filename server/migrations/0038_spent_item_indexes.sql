-- Make the map's token/food lookup proportional to ONE player.
--
-- Measured on production before writing this. fetchNearbyTokens asks for
-- `owner_id = $1 AND collected_at IS NULL AND <haversine> <= radius`, and
-- the planner answered it with tokens_collected_idx:
--
--   Index Scan using tokens_collected_idx  (actual time=623ms rows=0)
--     Index Cond: (collected_at IS NULL)
--     Filter: (owner_id = '…' AND <haversine> <= 1000)
--     Rows Removed by Filter: 29367
--
-- It walks EVERY uncollected token in the database — all 632 players'
-- worth — computes a haversine on each, and only then discards the
-- 29,366 that belong to somebody else. Warm that is 16-36ms, so nothing
-- is on fire today; the shape is the problem. Cost scales with how many
-- other people are playing, which is precisely the number beta is meant
-- to increase.
--
-- A partial index on owner_id over just the unspent rows gives the
-- planner the one thing it was missing: a way to reach a single player's
-- live items directly. Everything else stays as it is.
--
-- PARTIAL, not composite, and that is the whole trick: every read of
-- these two tables in the codebase filters `IS NULL` (16 of them, all
-- checked), so the index only ever needs to cover unspent rows. Today
-- that is 29,367 of 540,520 tokens and 9,870 of 230,142 food items — a
-- ~5% index instead of a 100% one, and it does not grow with the pile of
-- spent rows behind it.
--
-- Cheap to build for the same reason: ~29k entries, not 540k. Plain
-- CREATE INDEX (not CONCURRENTLY) because drizzle runs migrations inside
-- a transaction and CONCURRENTLY cannot; the brief write lock is worth
-- less than the special-casing.
--
-- Additive and reversible — DROP INDEX puts the old plan back.
create index if not exists "tokens_owner_uncollected_idx"
  on "tokens" ("owner_id")
  where "collected_at" is null;

create index if not exists "food_owner_unconsumed_idx"
  on "food_items" ("owner_id")
  where "consumed_at" is null;
