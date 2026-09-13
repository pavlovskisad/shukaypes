-- One row per portrait drawn (D-72), so the per-person daily cap on
-- model spend is counted from the database rather than from a
-- per-process memory that a deploy resets. Cascades with the account.
-- Hand-written, like 0032 onward.
create table if not exists "avatar_draws" (
	"id" text primary key not null,
	"user_id" text not null references "users"("id") on delete cascade,
	"created_at" timestamp with time zone default now() not null
);
--> statement-breakpoint
create index if not exists "avatar_draws_user_time_idx" on "avatar_draws" ("user_id", "created_at");
