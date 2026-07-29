-- Home ground: is the dog standing on territory we hold?
--
-- Written on each map sync, where the shapes are already in hand.
-- Denormalised onto the companion because the DECAY CRON needs it — that
-- is one bulk UPDATE across every row, and it can branch on a column but
-- cannot go and compute a convex hull per user.
--
-- Defaults false, so every existing companion simply starts off-home and
-- flips on its owner's next sync.
ALTER TABLE "companion_state"
  ADD COLUMN IF NOT EXISTS "on_home_ground" boolean NOT NULL DEFAULT false;
