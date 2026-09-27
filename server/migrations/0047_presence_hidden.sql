-- Multiplayer privacy opt-out. When true, the walker's live position is
-- never written to the presence set, so they are invisible to others on the
-- map while still seeing everyone else. Defaults false (visible), matching
-- prior behaviour for existing rows.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "presence_hidden" boolean NOT NULL DEFAULT false;
