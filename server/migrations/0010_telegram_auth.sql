-- Telegram identity columns on users. Nullable for existing web/PWA
-- rows; populated when a session arrives with valid Telegram Mini App
-- initData. telegram_id is the canonical Telegram user id (bigint —
-- TG ids exceed 32-bit range). Profile fields are denormalised so we
-- can render the user's name + avatar without hitting Telegram on
-- every page load.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "telegram_id" bigint,
  ADD COLUMN IF NOT EXISTS "telegram_username" text,
  ADD COLUMN IF NOT EXISTS "telegram_first_name" text,
  ADD COLUMN IF NOT EXISTS "telegram_photo_url" text;

CREATE UNIQUE INDEX IF NOT EXISTS "users_telegram_id_unique"
  ON "users" ("telegram_id")
  WHERE "telegram_id" IS NOT NULL;
