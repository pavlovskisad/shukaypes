-- Tell a found stray apart from a lost pet.
--
-- «песик (знайдений)» — somebody has the animal safe and wants its OWNER
-- — has been showing under «загублені» with a «терміново» badge, asking
-- walkers to comb the streets for a dog already indoors. Both are real
-- jobs; they are not the same job.
--
-- Hand-written for the reason in 0032: migrations/meta still has gaps and
-- the generator has once emitted a file that would have failed mid-run.
--
-- ADDITIVE ONLY, and deliberately so. Adding the column changes no
-- existing row's meaning: everything defaults to false, which is exactly
-- what the app assumes today. Marking the rows that ARE found reports is
-- a separate, dry-runnable pass (flag:found-reports) — this file runs
-- automatically on every deploy (Dockerfile CMD), so it must never be the
-- thing that decides which pets disappear from somebody's map.
alter table "lost_dogs" add column if not exists "is_found_report" boolean not null default false;

-- The map query filters on it alongside status, so it rides that index
-- rather than earning its own.
