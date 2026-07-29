-- Territory: marks are the only truth now.
--
-- The cells table recorded ownership separately from the shapes the map
-- draws, and the two diverged immediately — cells were claimed by a blob
-- around each mark AND by a trail along everywhere the user walked, none
-- of which was ever rendered. Harmless while nothing was contested, and a
-- guaranteed source of "someone took territory that never looked like
-- mine" the moment stealing lands.
--
-- Territory is now the convex hull of a user's live marks, computed on
-- read from territory_marks. Decay moved to the mark (they expire), so
-- there's nothing here worth migrating.

DROP TABLE IF EXISTS "territory_cells";
