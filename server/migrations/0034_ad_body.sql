-- Keep the ad text we already fetched.
--
-- Two things needed it and neither could be done without it:
--
--   1. The app bounced the walker out to OLX after a sighting, purely
--      because the owner's phone number lives in the ad and we threw the
--      ad away. Storing it lets the post be read in-app.
--   2. Parse accuracy could not be measured at all. Scoring a parser
--      needs the input it actually read; `title` is an OLX listing
--      headline or a 200-char Telegram snippet, and never was that.
--
-- The text is fetched either way — this only stops us discarding it.
--
-- HAND-WRITTEN, for the reason recorded in 0032: migrations/meta still
-- has gaps and the generator has already once emitted a file that would
-- have failed mid-migration against production. Additive, idempotent,
-- one nullable column, no rewrite of the existing table.

ALTER TABLE "scrape_log" ADD COLUMN IF NOT EXISTS "raw_body" text;
