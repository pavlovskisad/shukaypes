-- Give kyiv_lore somewhere to keep more than one sentence.
--
-- Every landmark the sniff press or a walk stop surfaces carries one
-- dog-voice line and a "read more" button. The button only has anything
-- behind it when the row has a Wikipedia handle, and the seed took that
-- handle from exactly one place: the OSM `wikipedia=` tag. Measured
-- against the same Overpass query the seed runs, a minority of the
-- corpus carries that tag, while a much larger share carries a
-- `wikidata=` tag whose entity links to an article the seed never
-- followed — and the rest can usually be matched to the article
-- geotagged at the same spot. So most "read more" taps end in the dog
-- shrugging, for rows an article exists for.
--
-- Two additions:
--
--   detail       the dog's longer telling, 2-4 sentences, written from
--                the article + Wikidata description by enrich-lore.ts.
--                Shown instantly on "read more", no network, no
--                Wikipedia dependency at read time. Null where there is
--                no research — the script never writes prose it cannot
--                source.
--   wiki_source  how the Wikipedia handle was found (osm | wikidata |
--                geosearch), so a fuzzy geosearch match can be audited
--                and reverted separately from the certain ones.
--
-- Additive, nullable, no backfill here: the columns are filled by
-- `pnpm --filter @shukajpes/server enrich:lore --apply` after a dry run
-- has been read. Rows already holding an OSM-tagged handle get
-- wiki_source = 'osm' so the provenance column is complete from day one.
alter table "kyiv_lore" add column if not exists "wiki_source" text;
alter table "kyiv_lore" add column if not exists "detail" text;
alter table "kyiv_lore" add column if not exists "detail_at" timestamp with time zone;

update "kyiv_lore"
  set "wiki_source" = 'osm'
  where "wikipedia_title" is not null and "wiki_source" is null;
