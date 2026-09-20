-- The day's six (D-99): the daily tasks become six server-counted
-- goals that pay paws, plus a bonus for the whole set.
--
-- The four new counters. `land_m2` is ground GAINED, summed over the
-- day's claims, so it is metres rather than a count — double precision
-- because claimGround returns a real area, not an integer.
alter table "daily_tasks" add column if not exists "search_quests" integer default 0 not null;
--> statement-breakpoint
alter table "daily_tasks" add column if not exists "landmarks" integer default 0 not null;
--> statement-breakpoint
alter table "daily_tasks" add column if not exists "land_m2" double precision default 0 not null;
--> statement-breakpoint
alter table "daily_tasks" add column if not exists "max_happiness" integer default 0 not null;
--> statement-breakpoint
-- WHICH landmarks, not how many. /lore/discover takes the list of
-- already-seen ids from the CLIENT, so a counter would pay three times
-- for the same statue sniffed three times with an empty exclude list.
-- The task says three landmarks; this is what makes that true.
alter table "daily_tasks" add column if not exists "landmark_ids" text[] default '{}' not null;
--> statement-breakpoint
-- WHAT HAS ALREADY BEEN PAID. Rewards are granted the moment a counter
-- crosses its target, and a counter keeps climbing afterwards — so the
-- row has to remember, or a fourth bone pays for the third one again.
-- One text[] of task keys rather than a boolean per task: a task added
-- later needs no migration, and the set is what the reward rule reads.
alter table "daily_tasks" add column if not exists "paid" text[] default '{}' not null;
--> statement-breakpoint
alter table "daily_tasks" add column if not exists "bonus_paid_at" timestamp with time zone;
--> statement-breakpoint
-- The old counters (tokens, lost_pet_checks, sightings) are deliberately
-- LEFT IN PLACE. They are not shown any more, but every historical row
-- carries them, and dropping a column to tidy a display is how you lose
-- the only record of what people did.
--
-- spot_visits and bones carry over and keep counting; spot_visits now
-- means a spot arrived at on a planned route, which is a narrower
-- thing than it counted yesterday. Rows from before today therefore
-- hold a looser number under the same name, and that is fine for
-- history and wrong for nothing the app reads.
comment on column "daily_tasks"."spot_visits" is 'D-99: arrivals at a spot ON A PLANNED ROUTE. Rows before 2026-09-20 counted any arrival.';
--> statement-breakpoint
-- THE WALK THE WALKER SAID THEY WERE MAKING.
--
-- "visit a spot (build and finish the route)" is two events with a walk
-- between them, and the server saw neither: routes are planned entirely
-- on the phone. Without this the task could only ever be the client
-- asserting it, which is the one thing D-99 exists to stop.
--
-- So the plan is recorded when it is made — and only if the walker is
-- actually far from it, or "planning a route" to the bench you are
-- sitting on would finish the task — and the ARRIVAL is noticed by
-- /collect/path, from positions the server wrote itself. One plan per
-- walker: planning another replaces it, which is what the app does.
create table if not exists "walk_plans" (
  "user_id" text primary key references "users"("id") on delete cascade,
  "lat" double precision not null,
  "lng" double precision not null,
  "name" text,
  "start_dist_m" double precision not null,
  "created_at" timestamp with time zone default now() not null
);
