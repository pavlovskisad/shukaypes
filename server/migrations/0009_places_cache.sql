CREATE TABLE IF NOT EXISTS "places_cache" (
  "cell_lat" double precision NOT NULL,
  "cell_lng" double precision NOT NULL,
  "category" text NOT NULL,
  "spots" jsonb NOT NULL,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("cell_lat", "cell_lng", "category")
);

CREATE INDEX IF NOT EXISTS "places_cache_fetched_idx" ON "places_cache" ("fetched_at");
