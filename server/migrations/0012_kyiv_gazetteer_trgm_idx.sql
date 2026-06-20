-- Trigram GIN indexes for fuzzy place-name lookup. Stage B of the
-- gazetteer rollout. pg_trgm extension was already enabled in 0011.
--
-- Postgres won't index over a non-IMMUTABLE function expression, and
-- array_to_string() is STABLE, not IMMUTABLE — so the first cut of
-- this migration that did `lower(array_to_string(aliases, ' '))`
-- failed with 42P17. Workaround: materialise the joined-aliases
-- blob as a real text column (aliases_text), populated at seed
-- time, and index that column directly. Plain text, plain index, no
-- IMMUTABLE drama.

-- Clean up any partial state from the failed earlier attempt of
-- this migration (defensive — IF NOT EXISTS would also catch this
-- but explicit is clearer).
DROP INDEX IF EXISTS "kyiv_gazetteer_aliases_trgm";

ALTER TABLE "kyiv_gazetteer"
  ADD COLUMN IF NOT EXISTS "aliases_text" text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "kyiv_gazetteer_search_trgm"
  ON "kyiv_gazetteer" USING gin (search_key gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "kyiv_gazetteer_aliases_trgm"
  ON "kyiv_gazetteer" USING gin (aliases_text gin_trgm_ops);
