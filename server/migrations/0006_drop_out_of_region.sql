-- Retroactive cleanup: pets parsed from non-Kyiv posts that landed
-- before the geo gate at upsert time. Match the same Greater Kyiv
-- bbox used in pipeline/upsert.ts (50.20–50.65 N / 30.10–30.90 E).
--
-- Fallback-coord pets (50.4501, 30.5234) are kept — already hidden
-- from /dogs/nearby and useful for parser audit.
DELETE FROM "lost_dogs"
WHERE NOT (last_seen_lat = 50.4501 AND last_seen_lng = 30.5234)
  AND (
    last_seen_lat < 50.20
    OR last_seen_lat > 50.65
    OR last_seen_lng < 30.10
    OR last_seen_lng > 30.90
  );
