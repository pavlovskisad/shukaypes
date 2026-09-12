-- Accounts: an email and a password on top of the identity a person
-- already has.
--
-- HAND-WRITTEN, like 0032 onward — drizzle-kit generate still diffs
-- against a stale baseline and would emit ADD COLUMNs for columns that
-- already exist in production.
--
-- ADDITIVE AND NULLABLE, every column. A row is still created on first
-- contact by a device id or a Telegram signature, before any of these
-- are known; the DOOR (auth.ts) then shows the registration screen and
-- refuses everything but /auth/* until the row carries registered_at
-- (and, when a mail sender is configured, email_verified_at). The row
-- itself is never replaced — registering ATTACHES an email to the
-- account the device already has. The accounts that predate the door
-- are wiped at rollout (db/wipe-users.ts): the owner's decision, there
-- being no real users to carry.
--
-- Uniqueness on lower(email) is partial so unregistered rows, all NULL,
-- do not collide. A nickname stays in `username` (it already feeds the
-- leaderboard and rival territory); it becomes unique among registered
-- accounts only, because unregistered rows carry a generated
-- `walker-xxxxxx` placeholder nobody chose. The uniqueness key is
-- `nickname_key`, folded by the APPLICATION (NFKC + lowercase): a
-- lower() index would fold «Оля» and «оля» together on one database
-- locale and not on another, and this must not depend on which.

alter table "users" add column if not exists "email" text;
--> statement-breakpoint
alter table "users" add column if not exists "email_verified_at" timestamp with time zone;
--> statement-breakpoint
alter table "users" add column if not exists "password_hash" text;
--> statement-breakpoint
alter table "users" add column if not exists "pet_name" text;
--> statement-breakpoint
alter table "users" add column if not exists "pet_species" text;
--> statement-breakpoint
alter table "users" add column if not exists "pet_breed" text;
--> statement-breakpoint
alter table "users" add column if not exists "nickname_key" text;
--> statement-breakpoint
alter table "users" add column if not exists "registered_at" timestamp with time zone;
--> statement-breakpoint
alter table "users" add column if not exists "consent_at" timestamp with time zone;
--> statement-breakpoint
alter table "users" add column if not exists "avatar_file_id" text;
--> statement-breakpoint
create unique index if not exists "users_email_unique" on "users" (lower("email")) where "email" is not null;
--> statement-breakpoint
create unique index if not exists "users_nickname_key_unique" on "users" ("nickname_key") where "nickname_key" is not null;
--> statement-breakpoint
-- One-time tokens: e-mail verification and password reset. Only the
-- SHA-256 of the token is stored, so a database read never yields a
-- usable link. Single use, short-lived, and cascade with the account.
create table if not exists "auth_tokens" (
	"id" text primary key not null,
	"user_id" text not null references "users"("id") on delete cascade,
	"kind" text not null,
	"token_hash" text not null unique,
	"expires_at" timestamp with time zone not null,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone default now() not null
);
--> statement-breakpoint
create index if not exists "auth_tokens_user_idx" on "auth_tokens" ("user_id");
--> statement-breakpoint
-- Long-lived, revocable logins. The short HMAC session token
-- (lib/session.ts) is still what every request carries; this is what
-- mints a fresh one when it expires, so an e-mail login survives more
-- than a day without the client quietly falling back to an anonymous
-- device identity. Hashed for the same reason as auth_tokens.
create table if not exists "auth_sessions" (
	"id" text primary key not null,
	"user_id" text not null references "users"("id") on delete cascade,
	"token_hash" text not null unique,
	"device_id" text,
	"created_at" timestamp with time zone default now() not null,
	"last_used_at" timestamp with time zone default now() not null,
	"expires_at" timestamp with time zone not null,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
create index if not exists "auth_sessions_user_idx" on "auth_sessions" ("user_id");
