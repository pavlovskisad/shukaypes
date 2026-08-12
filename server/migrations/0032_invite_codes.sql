-- Invite codes for the closed beta.
--
-- HAND-WRITTEN, ON PURPOSE. `drizzle-kit generate` produced a migration
-- containing the entire schema — every table since 0002 and a stack of
-- ALTER TABLE ... ADD COLUMN for columns that already exist in
-- production. The cause is in migrations/meta: snapshots exist for
-- 0000-0002 and nothing between 0003 and 0031, so the generator diffed
-- today's schema against a baseline from thirty migrations ago.
--
-- CREATE TABLE IF NOT EXISTS would have been harmless. ADD COLUMN is not
-- idempotent, so applying that file against production would have failed
-- mid-migration on `users.telegram_id` already existing — during a
-- deploy, on a database with real users in it.
--
-- Only the genuinely new objects are below. The accompanying
-- 0032_snapshot.json IS accurate (it was built from the current
-- schema.ts), so it repairs the baseline: the next `generate` will diff
-- against reality rather than against 0002.

CREATE TABLE IF NOT EXISTS "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invite_redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"user_id" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_code_invite_codes_code_fk" FOREIGN KEY ("code") REFERENCES "public"."invite_codes"("code") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invite_redemptions_code_idx" ON "invite_redemptions" USING btree ("code");
