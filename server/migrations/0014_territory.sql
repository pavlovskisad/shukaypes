-- Territory marking (slice 1).
--
-- The dog claims ground on its own as you walk. Ownership resolves on a
-- fixed ~110m grid (server/src/utils/territoryGrid.ts): one row per
-- claimed cell, exactly one owner. `strength` is the value AT
-- `last_marked_at` — the live value subtracts decay for elapsed time on
-- read, so an unvisited claim fades to neutral in a few days without a
-- cron touching every row.

CREATE TABLE IF NOT EXISTS "territory_cells" (
  "cell_id" text PRIMARY KEY,
  "owner_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "strength" integer NOT NULL,
  "last_marked_at" timestamptz NOT NULL DEFAULT now(),
  "mark_count" integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS "territory_owner_idx" ON "territory_cells" ("owner_id");
-- Viewport queries filter latitude then longitude.
CREATE INDEX IF NOT EXISTS "territory_bbox_idx" ON "territory_cells" ("lat", "lng");

-- Companion-side marking state: when and where the dog last marked, so
-- the cooldown and the minimum-spacing rule have something to compare
-- against. Nullable — a dog that has never marked has no last mark.
ALTER TABLE "companion_state"
  ADD COLUMN IF NOT EXISTS "last_mark_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_mark_lat" double precision,
  ADD COLUMN IF NOT EXISTS "last_mark_lng" double precision;
