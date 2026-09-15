-- The console's memory (D-84): one row every five minutes holding the
-- numbers worth trending, so a panel can say whether something is moving
-- and not only what it is. Written by a cron, read by /admin/history,
-- pruned past sixty days. Hand-written, like 0032 onward.
--
-- WIDE AND EXPLICIT rather than a JSON blob keyed by metric name: these
-- are charted, and a chart wants a column. Adding a series later is a
-- migration, which is the right amount of friction for something that
-- becomes a line on a page somebody reads.
create table if not exists "metrics_snapshots" (
  "at" timestamp with time zone primary key default now(),
  "presence_total" integer not null default 0,
  "presence_people" integer not null default 0,
  "presence_bots" integer not null default 0,
  "with_dog_people" integer not null default 0,
  "with_dog_bots" integer not null default 0,
  "paws_5m" integer not null default 0,
  "bones_5m" integer not null default 0,
  "marks_5m" integer not null default 0,
  "paws_live" integer not null default 0,
  "bones_live" integer not null default 0,
  "marks_total" integer not null default 0,
  "ground_pieces" integer not null default 0,
  "owners_with_ground" integer not null default 0,
  "real_accounts" integer not null default 0,
  "dau" integer not null default 0,
  "tick_max_ms" integer not null default 0,
  "bots_index_mean" double precision,
  "bots_hunger_mean" double precision,
  "bots_happiness_mean" double precision
);
--> statement-breakpoint
-- Every read is "the last N hours, oldest first". The primary key is
-- already on `at`, so this index would be redundant — left unmade on
-- purpose, and noted so nobody adds it twice.
