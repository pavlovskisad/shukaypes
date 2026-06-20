-- Trigram GIN indexes for fuzzy place-name lookup. Stage B of the
-- gazetteer rollout. pg_trgm extension was already enabled in 0011.
--
-- We index two text sources separately so a query like "Львівська"
-- can hit either the canonical name OR an alias (e.g. "вул.
-- Хрещатик" vs "Хрещатик"):
--
--   search_key  — already normalised at seed time (lowercase, no
--                 diacritics, no apostrophes); we index it directly.
--   aliases     — text[] of variants; the index is over the lowercased
--                 space-joined string so word_similarity can probe
--                 across all aliases in one shot.
--
-- gin_trgm_ops makes both indexes usable for the % (LIKE-ish) and <%
-- (word_similarity) operators we use in services/gazetteer.ts.

CREATE INDEX IF NOT EXISTS "kyiv_gazetteer_search_trgm"
  ON "kyiv_gazetteer" USING gin (search_key gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "kyiv_gazetteer_aliases_trgm"
  ON "kyiv_gazetteer" USING gin (lower(array_to_string(aliases, ' ')) gin_trgm_ops);
