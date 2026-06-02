CREATE TABLE IF NOT EXISTS "kyiv_lore" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "name_en" text,
  "category" text NOT NULL,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "story" text NOT NULL,
  "osm_type" text NOT NULL,
  "osm_id" text NOT NULL,
  "wikidata_id" text,
  "wikipedia_title" text,
  "source_lang" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  "last_rewrote_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "lore_lat_lng_idx" ON "kyiv_lore" ("lat", "lng");
