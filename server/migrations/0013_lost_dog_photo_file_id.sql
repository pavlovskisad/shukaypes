-- Add stable Telegram file_id storage for bot-ingested lost-pet photos.
-- The old flow stored the resolved file_path URL in `photo_url`, but
-- Telegram only guarantees those URLs for ~1 hour, so photos went dark
-- shortly after the dog was added. The file_id is permanent; the API
-- now serves `/photos/<file_id>` and re-resolves the file_path on
-- demand via TG's getFile.

ALTER TABLE "lost_dogs"
  ADD COLUMN IF NOT EXISTS "photo_file_id" text;

-- Pre-fix bot ingests stored expired TG file URLs straight into
-- photo_url. Their underlying links are already dead, so null them
-- out — the UI falls back to the emoji/breed card instead of
-- rendering a broken-image icon.
UPDATE "lost_dogs"
  SET "photo_url" = NULL
  WHERE "photo_url" LIKE 'https://api.telegram.org/file/bot%';
