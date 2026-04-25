-- Pilot moves to real scraped pets only. Seeded sample pets (Бусинка,
-- Ультра, Мася, etc) are no longer needed — scrape volume from OLX +
-- Facebook covers the real signal. Hard delete; their nanoid ids
-- weren't referenced from anywhere user-facing yet.
DELETE FROM "lost_dogs" WHERE "source" = 'seed';
