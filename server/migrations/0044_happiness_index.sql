-- The happiness index (D-74): two running totals per dog — happiness
-- weighted by seconds, and seconds — accumulated by the decay cron only
-- while the person is with the dog (last_poll_at within the online
-- window). Index = happy_weight_s / active_s, an honest all-time average
-- that moves with how the person plays. Hand-written, like 0032 onward.
alter table "companion_state" add column if not exists "happy_weight_s" double precision default 0 not null;
--> statement-breakpoint
alter table "companion_state" add column if not exists "active_s" double precision default 0 not null;
--> statement-breakpoint
alter table "companion_state" add column if not exists "last_poll_at" timestamp with time zone;
