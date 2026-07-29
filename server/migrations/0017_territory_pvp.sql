-- Territory PvP: mark strength, rival lookups, and raid notifications.

-- How well established a mark is. Fresh = 1; re-marking the same spot on a
-- later walk hardens it. A rival's mark weakens yours by one, so a soft
-- edge mark falls to a single visit while a hardened core takes several
-- across separate walks — the border war happens at the border.
ALTER TABLE "territory_marks"
  ADD COLUMN IF NOT EXISTS "strength" integer NOT NULL DEFAULT 1;

-- Rivals' marks are looked up by AREA, not by owner: "whose marks are near
-- this point", for both contesting and for drawing their ground when you
-- walk into it.
CREATE INDEX IF NOT EXISTS "territory_marks_bbox_idx"
  ON "territory_marks" ("lat", "lng");

-- Raids — someone marked over your ground. Delivered on the victim's next
-- sync and then marked seen, rather than pushed through Redis like pokes:
-- a raid that lands while you're asleep still has to reach you, and a
-- 2-minute TTL would drop it.
CREATE TABLE IF NOT EXISTS "territory_raids" (
  "id" text PRIMARY KEY,
  "victim_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "raider_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "raider_name" text NOT NULL,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "killed" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "seen_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "territory_raids_victim_idx"
  ON "territory_raids" ("victim_id", "seen_at");
