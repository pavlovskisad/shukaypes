-- Territory marks: the ordered spots the dog has marked.
--
-- territory_cells stays the ownership truth; this table records the SHAPE
-- of how the ground was won. The map draws these as dots joined by the
-- route walked between them, and when that route closes a loop the cells
-- inside the ring are claimed — so the sequence matters, not just the set
-- of points.

CREATE TABLE IF NOT EXISTS "territory_marks" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "closed_loop" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- The chain is always read per user in time order (newest N), which is
-- exactly this index.
CREATE INDEX IF NOT EXISTS "territory_marks_user_created_idx"
  ON "territory_marks" ("user_id", "created_at");
