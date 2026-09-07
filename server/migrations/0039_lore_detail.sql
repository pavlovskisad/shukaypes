-- Give kyiv_lore somewhere to keep more than one sentence.
--
-- Every landmark the sniff press or a walk stop surfaces carries one
-- dog-voice line and a "read more" button. The button only has anything
-- behind it when the row has a Wikipedia handle, and the seed took that
-- handle from exactly one place: the OSM `wikipedia=` tag.
--
-- MEASURED against the same Overpass population the seed builds (three
-- of its four chunks, 2666 named rows; the fourth, obelisks and towers,
-- is a few dozen):
--
--   wikipedia= tag                                   226   8%
--   wikidata= tag, no wikipedia                       35   1%
--   neither                                         2405  90%
--
-- of the 2405 with neither:
--   inscription= (the plaque's own text)             542
--   subject:wikidata= (who the memorial is FOR)      125
--   description=                                     151
--   any of inscription/description/subject/date/
--     artist/architect                               888
--
-- So 92% of "read more" taps shrug, and for a third of those rows the
-- mapper had already written down what the plaque says and whom it is
-- for — the seed never read past `name`.
--
-- Three additions:
--
--   facts        the OSM tags worth keeping (inscription, description,
--                start_date, subject:wikidata, artist, architect, kind,
--                material) as jsonb. Research input for the longer
--                telling; never shown raw.
--   detail       the dog's longer telling, 2-4 sentences, written from
--                the article + facts by enrich-lore.ts. Shown instantly
--                on "read more", no network, no Wikipedia dependency at
--                read time. Null where there is no research — the
--                script never writes prose it cannot source.
--   wiki_source  how the Wikipedia handle was found (osm | wikidata |
--                subject | title | geosearch), so the fuzzier sources
--                can be audited and reverted separately from the
--                certain ones.
--
-- Additive, nullable, no backfill here: the columns are filled by
-- `pnpm --filter @shukajpes/server enrich:lore --apply` after a dry run
-- has been read. Rows already holding an OSM-tagged handle get
-- wiki_source = 'osm' so the provenance column is complete from day one.
alter table "kyiv_lore" add column if not exists "wiki_source" text;
alter table "kyiv_lore" add column if not exists "facts" jsonb;
alter table "kyiv_lore" add column if not exists "detail" text;
alter table "kyiv_lore" add column if not exists "detail_at" timestamp with time zone;

update "kyiv_lore"
  set "wiki_source" = 'osm'
  where "wikipedia_title" is not null and "wiki_source" is null;
