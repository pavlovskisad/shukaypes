CREATE TABLE IF NOT EXISTS "kyiv_gazetteer" (
  "id" text PRIMARY KEY NOT NULL,
  "name_uk" text NOT NULL,
  "name_en" text,
  "aliases" text[] NOT NULL DEFAULT '{}',
  "search_key" text NOT NULL,
  "category" text NOT NULL,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "osm_type" text NOT NULL,
  "osm_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "kyiv_gazetteer_search_idx" ON "kyiv_gazetteer" ("search_key");
CREATE INDEX IF NOT EXISTS "kyiv_gazetteer_category_idx" ON "kyiv_gazetteer" ("category");

-- pg_trgm for fuzzy text search in stage B. Created here so the
-- migration is the single source of truth; lookup endpoint will add
-- the GIN index on search_key in a follow-up migration.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
