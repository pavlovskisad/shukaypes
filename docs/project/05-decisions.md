# 05 — Decision log

Decisions that are still load-bearing. Each one says what was decided, when,
why, and what would have to change for it to be reconsidered.

A decision goes here when it is made. A decision nobody wrote down gets
re-litigated in six weeks by someone who cannot tell it apart from an
accident.

**Status key:** ✅ standing · ⚠️ standing but under pressure · ↩️ reversed
(kept because the reasoning still teaches something)

---

## Platform and delivery

### D-01 · Expo + React Native Web, bundled as a single web bundle ✅
*Phase 1 · `app/app.json` → `web.output: "single"`*

One codebase for web, iOS and Android; web is the only target shipped so
far. The single-bundle mode is what makes the PWA and the Telegram Mini App
the same artifact.

**The cost, accepted:** nothing can be code-split. `three` adds ~0.6MB to a
~3.8MB bundle and there is no lazy-loading it. Reconsider only if bundle
size becomes a measured retention problem on Kyiv mobile connections.

### D-02 · PWA and Telegram Mini App, not native apps ✅
*Ongoing*

No app-store review loop, no install friction, and the Mini App path gives a
real signed identity for free in the channel the Kyiv audience already uses.
Native is in the RFP docs as a later phase, not a current plan.

### D-03 · MapLibre GL JS over Google Maps for rendering ✅
*PRs #242–#253, 1–2 Jun 2026*

The app started on Google Maps JS. It moved to MapLibre with vector tiles
from OpenFreeMap and a hand-written "crayon" style override
(`crayonStyle.ts`, 780 lines). Google's renderer could not be pushed to the
look the product needed; a vector style can be repainted arbitrarily.

Google is still used for **Places** (server-proxied and cached) and
**Routes** (called from the client).

### D-04 · Fly.io for the API, Vercel for the web app, Supabase for Postgres ✅
*Phase 3*

Free/cheap tiers cover a Kyiv pilot. Fly is in `fra` (Frankfurt) for
latency. Vercel's git integration handles the frontend so the repo only owns
the server deploy.

---

## Backend architecture

### D-05 · One Fastify process, all crons in-process, no leader election ✅⚠️
*Phase 3 · `fly.toml`, `services/scrape.ts`*

`min_machines_running = 1` keeps one machine warm specifically so decay,
scrape, cleanup and the multiplayer tick keep running. This is correct for
one machine and **blocks a second one** — a replica would double every cron
and run 2×30 bots.

**To reverse:** a Redis leader lock around the cron starts. That is the
single change that unblocks horizontal scaling, and it is not needed yet.

### D-06 · No PostGIS ✅
*Reaffirmed in migration `0027` and `0031`*

Proximity is hand-rolled haversine in SQL for pets, tokens and food, and a
plain bbox range scan on B-trees for territory ground. The territory model
only ever asks "which pieces are in this view", which a range scan answers,
and the deployment does not have to grow an extension.

**The cost:** `fetchNearbyLostDogs` scans every active pet on every
`/sync/map`, per user, every 15s. `AUDIT_FINDINGS.md` §3.1 argues for a
bounding-box pre-filter as the minimum viable fix, and PostGIS + GiST +
`ST_DWithin` as the thorough one. Neither has been done. Note that
`db/schema.ts` still carries a stale comment claiming PostGIS is in use for
`tokens` — it is not.

### D-07 · Polling presence, not WebSockets ✅
*PR #260, 1 Jul 2026*

Fits the sync cadence the client already has, needs no stateful connections
on Fly, and latency does not matter for a walking game. Real players and
bots share one Redis GEO set so they render identically.

### D-08 · `/presence` split off `/sync/map` onto a 3s loop ✅
*PR #351, 29 Jul 2026*

Measured on prod: other dogs' positions were 3.7KB of a 66.4KB payload while
the territory in the other 94% only changed every few minutes, and the
partition behind it cost 2.47s of a 3.57s sync. Polling the whole thing fast
enough for smooth dogs would have meant ~80MB/hour of mobile data and five
times the query load, to refresh polygons that had not moved.

3s is the floor that matters and it is set by the simulation, not the
transport: bots step on a 3.5s tick and GPS lands about once a second.

### D-09 · Redis is strictly cache; the app degrades quietly without it ✅
*PR #265, 2 Jul 2026*

Presence, spawn cooldowns, the path anchor and the language cache all guard
on `redis.status === 'ready'` and no-op if it is down. Redis eager-connects
at boot — partly so the guards are reliable, partly because an idle free
Upstash database got reaped by the provider once for having nothing
connecting to it.

`/health` (Fly's rotation check) deliberately does **not** check Redis;
`/health/deep` does and returns 503. A Redis outage should not make Fly
cycle the machine.

### D-10 · A watchdog thread that kills a wedged process ✅
*PR added after the 5 Aug outage · `services/watchdog.ts`*

The main thread stamps the time into a `SharedArrayBuffer` once a second; a
worker thread with its own event loop reads that stamp and kills the process
if it goes stale for 30s. Shared memory rather than `postMessage`, because a
message would land in exactly the queue that is not being drained.

**The trade, stated honestly:** this converts a silent permanent outage into
a visible restart loop. If something wedges on every boot the server kills
itself repeatedly — noisy, alarming, and far easier to diagnose than a
process sitting there looking healthy. 30s is twenty times the worst honest
number ever logged (1.4s for thirty bots including DB round-trips).

### D-11 · Territory geometry runs in a worker thread, warmed at boot ✅
*`services/groundWorker.ts`*

Bounded by a 2s timeout. Warmed in `index.ts` so the worker's spawn cost is
not paid inside the first claim's transaction, where it would be held under
the advisory locks.

---

## Game and product design

### D-12 · Territory ownership is stored ground, not a derived shape ✅
*PR #363, 3 Aug 2026 — see [`04-territory.md`](04-territory.md)*

A shape recomputed from marks cannot lose a piece and keep the rest. Ground
lives in `territory_ground`; a mark grows the owner's union and cuts every
rival piece it covers, both once at mark time. Two owners can never overlap,
a loss is permanent, and a sync is two indexed queries instead of a
city-wide partition.

### D-13 · Territory hangs off `/collect/path`, so it inherits the anti-cheat ✅
*PR #328, 28 Jul 2026*

`/collect/path` already owns the previous position anchor in Redis and
rejects teleports. Marking there means a tampered client cannot claim ground
it did not walk to any more than it can farm paws. **No new trust surface**
was the design constraint, and it held through every subsequent rebuild.

### D-14 · A claim is local, not the hull of your whole cluster ✅
*PR #364, 3 Aug 2026*

Under stored ground, a global claim meant every mark re-claiming everywhere
the dog had ever walked — districts of paint, and captures on the far side
of the city from a mark made here. The union is what accumulates a
territory, so a claim only has to cover the ground around the mark that made
it.

### D-15 · Every mark is equal ↩️→✅
*Strength tiers introduced early in the territory arc, removed by PR #363*

Marks used to harden to strength 3 on repeat visits and take as many rival
marks to remove. It made the state of a border impossible to read: two zones
touching told you nothing about who was winning without knowing a hidden
number under each dot. One mark, one claim.

### D-16 · Marking cadence 150s/140m → 20s/40m ✅
*PR #365, 3 Aug 2026 · env-overridable*

The old pair made territory out of a handful of far-apart points, so every
outline was a wide polygon between four or five dots. Marks 40m apart draw a
boundary that follows the walk instead of spanning it. 20s sits *below* an
ordinary walker's 40m interval on purpose, so distance is what paces a claim
— a dog that stands still claims nothing however long it waits.

### D-17 · Home-ground rewards are entirely passive ✅
*PR #339*

Denser paws and half-rate happiness decay on ground you hold. Nothing to
activate, nothing to remember, so the reward still lands on a player who
never learns the mechanic has a name.

### D-18 · Lost-pet pins are off the main map ✅
*`LOST_DOG_PINS = false`*

The search layer is meant to be the quiet half of the app. You meet a lost
pet through the companion and the carousel, not through a map peppered with
photo pins competing with the territory you are walking. Pets are still
fetched and still drive supersniff, the carousel and the cinematic pet view.

**This is a real product bet and it should be revisited at pilot.** It
trades discovery for calm; if walkers never encounter a pet, the search
layer does not run.

### D-19 · Search results are paid in paws, not points ✅
*PR #394, 10 Aug 2026*

"+200 points" is a number with no place in the world — nothing else is
denominated in it and nobody can picture it. Paws are what you pick up off
the pavement all day, so a handful at the end of a search is a reward you
already know the size of. **20 for a find, 10 for a zone walked and found
empty.** Flat rather than scaled off the pet's `rewardPoints`, which was
never shown anywhere.

The client spends them one at a time, 70ms apart, so twenty paws arrive as
twenty pickups rather than a counter jumping.

### D-20 · Both answers count ✅
*PR #393, 10 Aug 2026*

At the end of a search the dog asks whether you saw the pet, and "no" is
recorded and paid. A zone confirmed empty is a zone the next walker does not
need to cover. A search flow that only rewards success collects only
successes and learns nothing.

### D-21 · The dog speaks through its own bubble ✅
*PR #394*

The search prompt used to render its own bubble at the bottom of the screen
— a second bubble, in the dog's typeface, nowhere near the dog. It read as a
system dialog wearing the dog's voice. Only the buttons stay in the thumb
zone, because that is where a hand is on a walk.

### D-22 · Opus for active chat, Haiku for ambient and for parsing ✅
*`services/anthropic.ts`, `pipeline/parser.ts`*

`claude-opus-4-8` carries the companion's voice on user-initiated turns;
`claude-haiku-4-5` handles ambient turns (~60% of calls) and every lost-pet
parse (~$0.001/call). Opus is the priciest call in the app; since PR #417
it sits behind per-user and global daily budgets and a kill switch (D-34),
on top of a now-genuinely-per-user rate limit.

### D-23 · The parser geocodes from a landmark table instead of a geocoding API ✅⚠️
*`pipeline/parser.ts`*

The prompt carries a Kyiv district/landmark coordinate grid and asks Haiku
to infer lat/lng. Good enough for a 500–1000m search zone, and it avoided
wiring a paid API to ship. Failures land on the city-centre fallback pin,
which is where the invisible-pets problem comes from.

### D-24 · The gazetteer only sees model-extracted mentions, never raw post words ✅
*`pipeline/parser.ts`, the `mentions.length > 0` gate*

This looks like a bug and is load-bearing. **Measured:** feeding raw post
words to the gazetteer resolves 64 of 88 titles and the hits are mostly
garbage — `котика` ("kitten") matches провулок Валі Котика at 1.00,
`Ужгород` matches Ужгородський провулок at 0.88. 15,948 Kyiv streets, many
named after people, so collisions with ordinary words are the norm.
**A wrong pin is worse than no pin.**

### D-25 · Out-of-city detection is token-exact and title-only ✅
*PR #409, 11 Aug 2026 · `pipeline/outOfArea.ts`*

Kyiv has streets named after other cities (Львівська площа, Харківське шосе,
метро Чернігівська), so matching is token-exact and adjectival endings are
rejected. Anything naming Kyiv itself is skipped.

Only a city named in the **ad title** is ever written. A description
narrates history as readily as location — "evacuated from Kramatorsk" on a
dog lost by the Olimpiiska stadium, titled "КИЇВ!!!".

---

## Safety, ops and process

### D-26 · Data-mutating scripts are dry by default, `--apply` is explicit ✅
*`clean:lost-dogs`, `expire:out-of-area`*

The dry run prints exactly what the apply would do, and a human reads it
before the apply. This is the rule for anything that writes to `lost_dogs`,
`sightings` or `users`.

### D-27 · Prefer the reversible form ✅

Expiring a row (`status = 'expired'`) hides it from every query the app
makes and can be undone with one UPDATE. Deleting it cascades to sightings
and cannot. Nulling a photo URL is not reversible — the URL is gone — so
only do it on a definitive 404.

### D-28 · The ingest alert is edge-triggered and never repeats ✅
*PR #412, 11 Aug 2026*

Alerts once on the way in, once on the way out, and nothing in between. A
monitor that nags hourly gets muted, and a muted monitor is the same silence
it was built to remove. State lives in Redis so a deploy does not
re-announce everything.

### D-29 · `REPORT_TOKEN` retired rather than rotated ↩️
*PR #408, 11 Aug 2026*

A compromised placeholder token was set on the audit endpoint. The plan was
to rotate it. The right question turned out to be: given a session already
holds `FLY_API_TOKEN`, what is a report token worth? Nothing — anyone
holding the Fly token can set the report token to whatever they like, or
skip the endpoint and run the query in the container.

**A lesser key is only a boundary against a holder who lacks the greater
one** — a dashboard, a cron, a non-Fly agent. No such holder exists, so
there was nothing for a token to hold. The code path is untouched:
`checkReportAuth` still accepts `REPORT_TOKEN`, so re-opening the endpoint
to a narrow reader is one `fly secrets set` away.

### D-30 · The CI gate blocks both deploys ✅
*PR #274, 4 Jul 2026 · frontend closed by PR #425, 13 Aug · fixture checks
added by PR #416*

`deploy.yml` runs typecheck + lint + `pnpm check` as a `checks` job and the
Fly deploy `needs: checks`. `react-hooks/rules-of-hooks` is an **error** —
that is the class of bug that white-screened prod. `exhaustive-deps` is a
warning; there are 21 and that is the baseline.

The frontend gap closed on 13 Aug: `vercel.json`'s build command now runs
typecheck + lint first and fails on either — deliberately a *failing build*
rather than Vercel's `ignoreCommand`, because a skipped build leaves the
previous deployment up with nothing visibly wrong. The gate's first catch
was the commit that added it.

### D-31 · Boot-seeding of lost pets was removed ✅
*`index.ts` · "pilot now runs on real scraped pets only"*

The `seedLostDogs()` CLI in `db/seed-dogs.ts` still works for local dev, but
production has no synthetic pets. Everything in `lost_dogs` came from a real
post.

---

## The beta-readiness pass (12–14 Aug 2026)

### D-32 · Dedupe refuses when evidence is thin ✅
*PR #416 · `pipeline/samePet.ts`*

Measurement inverted the task: the plan was to widen the candidate search;
the data showed three of the four pairs the existing rule considered
duplicates were **different animals**. The asymmetry decides the design — a
duplicate pin is untidy, obvious, and fixable by anyone who notices; a
wrong merge overwrites one family's lost pet with another's and the losing
record leaves no trace. Breed compatibility plus descriptor rejection
("чорний кіт" is not a name), identity as a pure checked function, and the
candidate `LIMIT 20` kept but ordered — the measured problem was
over-merging, not missed duplicates.

### D-33 · `search_results` is its own table, not a nullable row in `sightings` ✅
*PR #421*

`sightings` means *the pet was here* — the map reads it and it drives the
pin-moving logic. Widening it to also mean "somebody looked and found
nothing" would put rows that assert nothing into every query that assumes
otherwise. The analytics write is wrapped and runs last: a failure there
must cost a row in a metrics table, never a walker's paws or their answer
about an animal that is still missing.

### D-34 · The chat budget fails open ✅
*PR #417 · `services/chatBudget.ts`*

Counters live in Redis. If Redis is unreachable the choice is between
refusing every chat (the dog goes mute for everyone during an unrelated
outage) and allowing them uncounted. Chat is the product's texture rather
than its function, but a silently-mute companion reads as "the app is
broken" to a beta tester, while the rate limits and the kill switch still
stand in front of the spend. So: open, logged at error level, visible in
the console. The ceilings themselves are sized from measurement — real
usage was three Opus turns in seven days across three people, so 50/user
and 1,000 global per day are two orders of magnitude of headroom, not a
squeeze.

### D-35 · Existing accounts are never invite-gated ✅
*PR #417 · `lib/inviteGate.ts`*

~543 accounts have no email, no password, no recovery — just a device id in
localStorage. A code checked on every request instead of only at signup
locks all of them out permanently. The decision is a pure predicate, and
`check:invites` asserts exhaustively that `hasExistingAccount` dominates
every input, including with the flag forced on. The gate ships dormant
(`INVITE_REQUIRED` unset) until the owner flips it.

### D-36 · A refusal returns 200 in the success shape ✅
*PR #417 · `routes/chat.ts`*

Read from the client rather than guessed: the client throws on non-2xx and
interpolates the thrown string into the dog's speech bubble, so a 429 would
have shown testers `429 /chat: {...}` in the middle of Ukrainian dialogue.
The budget refusal comes back as a normal reply the dog can say.

### D-37 · Crash reporting is self-hosted, not a third-party SDK ✅
*PR #419 · `services/crashReport.ts`, `routes/clientErrors.ts`*

Nothing added to a ~1MB bundle sent over Kyiv cellular, no data-processor
agreement for EU/UA users, and crashes land in the same Fly logs as
everything else. Capped at 5 reports per session, deduped by signature,
`keepalive: true` so the report survives the tab closing on a blank screen
— the most likely next action. The endpoint is auth-exempt and returns 204;
every path swallows its own errors, because it runs at the moment the app
is already broken.

### D-38 · The admin console is one dependency-free page, not a workspace app ✅
*PR #428 · `routes/adminConsole.ts`*

The root Vercel build runs typecheck + lint across every workspace package,
so a Vite + React console in the workspace would make the *walkers'* app
pay for an internal tool's dependencies on every deploy. Same origin also
means no CORS, no second deployment, no config drift. Read-only by
construction — ops switches would need `ADMIN_TOKEN`, which must never live
in a browser. `DASHBOARD_TOKEN` exists precisely as the one key safe to
keep there, and the metrics numbers stay off the public internet because
they are fundraise numbers (DAU, retention, spend) reachable at a path
readable in a public repo.

### D-39 · Dev affordances are gated, not deleted — and the gate is not a security boundary ✅
*PR #420 · `constants/devTools.ts`, `routes/dev.ts`*

`?sim=1`, `?terrReset=1`, `?terrRaid=1` and `/preview` are out of the
shipped build; a typed password at `/dev` (checked server-side against
`DEV_TOOLS_PASSWORD`) turns them back on per browser. The honest framing:
the simulator grants nothing a determined person lacks — the client is
trusted for its own position, so invented coordinates are a `curl` away
regardless. What the gate stops is an *accident*: a beta tester wiping
their own territory off a link found in a chat. That is also why the two
destructive routes check the password server-side and 404 rather than
trusting a client boolean.

### D-40 · Do not repoint Fly's health check at `/health/deep` ✅
*PR #425, arguing against the roadmap*

`/health/deep` fails on Redis too; Redis is free-tier and flaky and the app
degrades gracefully without it, so a Redis blip would mark a *serving*
machine unhealthy and take the app down. On a real database outage,
restarting the machine fixes nothing while costing the logs and the
endpoint you would diagnose from. The right fix is an external monitor
watching `/health/deep` and telling a human — which still does not exist.

### D-41 · Migrations are hand-written until the Drizzle baseline is proven ✅
*PRs #417, #421 · migrations `0032`, `0033`*

`migrations/meta` has snapshots for 0000–0002 and nothing for 0003–0031, so
`drizzle-kit generate` emits the entire schema including non-idempotent
`ADD COLUMN`s — a file that would have failed mid-migration against the
live database during a deploy. New migrations are additive, hand-written,
and verified against a real local Postgres (including through the Drizzle
schema, because a column named differently in `schema.ts` and the migration
typechecks fine and fails at runtime).

### D-42 · `force: true` stays, by the owner's decision ✅
*Recorded 13 Aug*

Tap-to-collect remains while the collection animation is tuned. The
consequence to carry into any reading of beta numbers: collection counts
will not prove anybody walked. `search_results` and distance still will.

---

## The ingestion rescue and the front door (15–20 Aug 2026)

### D-43 · The scrape retry fires with no delay, and that is load-bearing ✅
*PR #448, corrected in production · `lib/scrapeFetch.ts`*

OLX refuses roughly every second request from a given connection. A
back-to-back retry reuses the warm connection and is let through; **any**
pause opens a fresh one and is refused again. Measured:

```
no delay      424242        500ms apart  444444        3s apart  444444
```

`RETRY_DELAY_MS = 0`. A backoff here looks like an obvious politeness
improvement and silently disables the entire fix — the first version
shipped with 500ms and changed nothing. A local mock cannot catch this,
because a mock has no connection behaviour to reuse.

### D-44 · A residential proxy is not the fix; the seam stays unset ✅
*PR #448 — established at the cost of a proxy subscription*

Four Ukrainian residential exits, two in Kyiv, full browser headers:
403/919 every single time, while the Fly datacentre alternates 403/200 and
a different datacentre returns 200 five times out of five. Whatever the
edge is keying on, it is not "is this address residential".
`SCRAPE_PROXY_URL` remains as a narrow seam — scraping only, never the
Anthropic/Google/Telegram traffic — for the day the edge really does
harden.

The methodological lesson is the more valuable half: the original "the
address is blocked" conclusion compared a home *browser* against a
datacentre *Node client* and attributed the gap to the address. Two
variables, one conclusion. And the probe that appeared to confirm it used
an **invented** URL rather than one taken from the source.

### D-45 · Listing pages are ordered newest-first ✅
*PR #457*

OLX orders page one by relevance, so page one is a nearly fixed set. With a
small ledger most of it is new; after 12,381 rows the scraper had seen
everything relevance ordering would ever show it and discovery sat at 100%
already-seen while every log line read `tick complete`. It had not broken —
it had **run out of page**. `search[order]=created_at:desc` is the fix, and
`SourceRunSummary.fresh` exists so the condition is visible: `skipped`
lumps already-seen with title-filtered, so `discovered - skipped` could not
answer it. **`fresh === 0` is a log level, never an alert.**

### D-46 · A deleted ad is the found-signal; age is only a proxy ✅
*PRs #482, #483 · migration `0036`*

A lost-pet ad taken down usually means the story ended, which is far better
evidence than "this row is 90 days old" — an age rule expires a pet still
being searched for and keeps one that went home in April. Production had
exactly that failure: «Льоля» was expired by the age sweep while her
owner was still renewing a live listing.

So `backfill:ad-bodies` records `ad_alive_at` whenever it confirms a live
ad, `expire:no-post` acts only on `404/410` (`ad-gone`), and **anything
else is left alone** — a 403 that survived its retries says nothing about
whether an ad exists, and treating one as gone would take a searched-for
pet off the map.

### D-47 · Contacts are stored and shown, gated behind a reported sighting ✅
*PRs #454, #455, #491 · owner's decision*

The walker needs the ad twice for two different reasons: **during** a
search to answer "is this the dog?" (collar, temperament, name), and
**after** reporting a sighting to reach the owner. The first view runs
through `redactContacts`, the second does not. The effect is that an
owner's phone rings when somebody has actually seen their animal.

**The link to the original ad is gated with the contacts**, and that was a
change of mind mid-work: the first pass masked the phone while still
handing over the OLX url, which made the mask decoration. `sourceUrl` is
now `seen ? url : null`. The accepted consequence, stated in the copy: a
pet with no stored body and no sighting shows an explanation and a close
button, because the alternative was a gate anybody could walk around.

Redaction deliberately **errs toward readability** — anything under nine
digits stays, because that is a house number, a year or a time, and a
redaction that swallows "Оболонь, буд. 12" helps nobody. A number that
slips through is one the walker could get thirty seconds later by
reporting the sighting.

### D-48 · Containment is checked at the source, not the response ✅
*PR #455 · `check:ad-body`*

The fixture fails if any file outside a five-name allowlist mentions
`raw_body`, or if `routes/dogs.ts` stops mentioning `redactContacts` or
`schema.sightings`. Source-level on purpose: a response check only sees the
pets a seeded database happens to hold, and passes happily if the leak sits
behind a branch the fixture never takes. Both mutations were run and both
failed the check.

### D-49 · Found reports are kept in the table and hidden from the map ✅
*PR #480 · migration `0035`*

Somebody who *has* an animal and wants its owner is not somebody who lost
one — but both look identical to a keyword filter, and deliberately so:
`LOST_KEYWORDS` includes `знайд|знайш|найден|нашли|found` and four listing
queries search for found animals, because a found stray needs its owner
found. The defect was presentational: «песик (знайдений)» appeared under
«загублені» with «терміново», sending a walker to search the streets for an
animal already sitting in somebody's flat.

Flagged with `is_found_report` and excluded from the map query, **not**
filtered at ingest, so they can get their own screen and their own call to
action («знаєш чий це?») later. `check:found-report` pins the rule and
**ambiguity stays a search**.

### D-50 · The walk loop does not depend on Google ✅
*PR #493 · `routes/walkDestinations.ts`*

With the Places key off a walk could not happen at all — the radial menu
answered "sniffing out spots…" forever; with the Routes key off there was
no line. A core loop was hostage to a billing account.

Destinations now come from our own tables (307 parks and 82 squares in
`kyiv_gazetteer`; museums, churches and attractions in `kyiv_lore`), merged
with Places **parks only** and deduped by position at 120m because Google's
`place_id` and our `osm:way:…` are different strings for the same park.
When routing declines, the line is drawn **dashed** between the walk's own
points, keeping the stops: the destination and the stories are ours, only
the streets were Google's, and a solid line would claim knowledge of them
we do not have.

### D-51 · A walk is a tour; businesses are not destinations ✅
*PR #493*

Cafés, bars, pet shops and vets were live walk destinations, so "take me
for a walk" could answer with the vet. Going to a named business is a
different mechanic with three entry points of its own (`visit:spot:<id>`,
the chat's `walk_to_spot`, the spot card's route button). The errand
categories were **removed from the pool** rather than merely outranked, so
no combination of distance and recency can resurface one. Streets,
districts and `kyiv_lore`'s 1676 `historic` rows are excluded too — a
street is not a destination and a wall plaque is a *stop*.

### D-52 · Walk stops are spread by equal stretches, not proximity ✅
*PR #490 · `services/loreWalk.ts`*

Taking "the N landmarks closest to the line" puts three plaques in the
first block, because the dense old centre wins every slot. Cutting the walk
into equal stretches and taking the best candidate in each is the whole
difference between a walk that unfolds and a walk that front-loads.

Every parameter came from the real corpus rather than a guess — the 240m
corridor sits where the yield curve flattens on short walks and where
worst-case detour starts climbing on long ones; the first guesses were 160
and 260. The measurement also caught `POOL_LIMIT` sitting *inside* its
working range (800, against a real four-candidate Maidan request pulling
702 rows) — a backstop 14% from the working maximum is one growth spurt
from silently choosing stops out of a truncated city.

### D-53 · The dog is the front door, not a menu ✅
*PR #494*

The app opened onto a map with a six-verb radial menu and nothing saying
what it was for. Now the dog asks «нюх-нюх! шо ти?» and the answer picks a
mode; the corner logo rotates explore → district → supersniff and is the
first thing the dog points at when the screen goes idle. Every level speaks
its own line, so the icons stopped being a guessing game.

Client-only by construction — no server code, no migrations, nothing
written to `lost_dogs`, `sightings` or `users` — so the whole restructure
reverts in a single deploy with `git revert -m 1`.

### D-54 · Territory's soft field is a render change, not a return to Model 1 ✅
*PR #433 · `territoryHeatLayer.ts`*

Ground is drawn as a blurred scent field rather than hard polygons, which
looks like the heat map Model 1 died with. The distinction is recorded in
the source: **Model 1's failure was the grid data model, not the
softness.** Ownership is still stored polygons with cuts applied at mark
time; the blur is re-thresholded so borders stay exactly where the server
put them. The old flat fill survives as a fallback, because territory
vanishing on a device with an unlucky GL stack would be worse than an
ugly edge.

---

## Supply side, placement, and the open launch (21–25 Aug 2026)

### D-55 · The gazetteer places the pet; the model no longer guesses alone ✅
*PRs #506–#530 · `pipeline/resolvePlace.ts`*

The parser inferred coordinates from **~41 hardcoded landmarks** while
`kyiv_gazetteer` — thousands of real streets, seeded for exactly this job —
was read only by `questPlaces`. So «вул. Зодчих» had to become one of 41
guesses, and «Софіївська Борщагівка» (a village *west of* Kyiv) landed in
the city centre with every pipeline stage reporting success.

`audit:pins` found the mechanism, and it is worth keeping: the model
answers "somewhere in Kyiv" with **Maidan**, which sits **22m** from the
fall-through coordinate — close enough to look placed, far enough to escape
the invisible-pin filter, and then jittered into a ring around
Khreshchatyk. "The pet was in the centre" was a rendering artefact.

The audit was deliberately **independent of the parser**: it matches text
against the gazetteer directly rather than re-running the parser's logic,
because a check that reproduces the thing it checks cannot fail.

### D-56 · Placement records how it happened ✅
*Migration `0037` · `placement_source`*

`owner`, `gazetteer-marked:<name>`, `model-landmark:<name>`, `fall-through`,
`sighting`. `label-pins` backfilled the 167 rows placed before the column
existed by recomputation rather than inference, so `GROUP BY
placement_source` describes the whole active table with no nulls. Placement
quality stopped being a thing you argue about and became a thing you query.

### D-57 · An owner's own report guesses nothing ✅
*PR #531 · `POST /dogs/report`*

Structured fields, their own photo, their own pin — so no Haiku, no
gazetteer, `placement_source: 'owner'`, `parseConfidence: 1`. Every
inference in the pipeline exists to recover information a scraped post does
not carry; a first-party report carries it, so inferring anything would be
strictly worse.

The pin is set by **borrowing the map rather than embedding one**: the
sheet hides, a crosshair marks the centre, the person pans underneath and
confirms, and the coordinate is read from the store's existing
`viewportCenter`. Zero MapView changes for a map-picking UI.

### D-58 · The channel post is the photo upload ✅
*PR #531 · `services/crosspost.ts`*

This app's photo pipeline already runs entirely on Telegram `file_id`s
(`routes/photos.ts` is a read proxy; there is no object store anywhere).
Publishing the report via `sendPhoto` returns the `file_id` the row stores
— so **one call does storage, first distribution, and the shareable `t.me`
link at once**. No new dependency, and pet creation survives Telegram being
down because the crosspost happens after the response.

### D-59 · Reports go live instantly and are reviewed after ⚠️
*PR #531 · owner's decision*

A lost pet is time-critical: a review queue that adds an hour costs
searching hours. So the pin is live on submit, and each report alerts the
ops chat with an inline «прибрати з мапи» button, honoured **only from that
chat**. Expiry rather than deletion, per the standing reversibility rule.

**This is correct for known testers and is the largest single risk of an
open launch** — see [`08-open-issues.md`](08-open-issues.md) L-1. The
mitigation that preserves the decision is to split it: keep the *pin*
instant, hold the *public crosspost* for approval.

### D-60 · The beta is open, not invite-gated ✅
*Decided 25 Aug · [`11-strategy.md`](11-strategy.md)*

Two founders announce to a combined ~130K audience; thousands of installs
land in week one and that data lands *during* the raise rather than before
it. `INVITE_REQUIRED` stays off by choice — the gate is built, tested, and
held in reserve as a throttle.

The consequence to carry: **the invite gate was Phase 1's answer to "safe
to hand to a stranger."** Removing it from the plan without replacing it
means the load ceiling and the unreviewed publish path are now load-bearing
in a way they were not designed to be.

### D-61 · Reduce motion means fewer flourishes, never a hopping camera ✅
*Decided 10 Sep · `components/map/camera.ts`, `utils/motion.ts`*

With the OS "reduce motion" setting on, three libraries each did their
own thing: MapLibre zeroed the duration of every camera move that was not
marked `essential` (none were), Reanimated completed every card-stack
animation instantly from a snapshot taken at load, and the fog layers'
repaint governor held the sun still. The net effect was an app that was
half frozen and half snapping — and supersniff's chase camera, which
glides by chaining one short `easeTo` per tick, became a camera that
hopped across the map at the tick rate. That is more motion, not less,
for the person who asked for less.

The decision, following Apple's guidance and WCAG 2.3.3: the setting
removes **non-essential, sweeping** movement and nothing else.

- **Follow** (the camera on the dog) and **short** moves (recentres and
  nudges under about a second) are essential and stay smooth.
- **Cinematic** moves — entering and leaving supersniff, the dog view
  first pulling up over a pet, the cross-city jump to a territory or a
  poke — become a clean cut to the same end state.
- A move the finger asked for is never cinematic: swiping the pet
  carousel or the supersniff fragment carousel re-aims a camera already
  in that view, continues the gesture, and glides. (Found on a device
  the same day: the swipe "blinked" while the first pull-up rightly cut.)
- The card stack's settle and rebound continue the finger's motion and
  stay; its lift flourish and confirmation focus follow the system.
- Drag-pan inertia stays for the same reason — a flick carrying on is
  the finger's own motion. MapLibre would drop it under the setting, so
  the map is constructed with `reduceMotion: false` and the library
  applies the flag nowhere; this policy is the only one.
- The sun's rays, the fog particles, the dog-cam shimmer, the profile
  sun and clouds, and the splash wordmark hold still.

Every camera move goes through `easeCamera(map, kind, opts)` so the
policy is one function rather than twenty-one call sites, and every
consumer reads the setting live through `prefersReducedMotion()` rather
than snapshotting it. An in-app "less motion" switch that overrides the
OS is a product option left open, not needed for this.

### D-62 · Identity once, a session token thereafter ✅
*Decided 12 Sep · `server/src/lib/session.ts`, `app/services/session.ts`*

The Mini App sent the whole Telegram initData on every request — about
half a kilobyte to a kilobyte, twenty times a minute on the presence
poll, a megabyte an hour of upload on a walk (F-1). Behind it the server
re-validated the signature and ran a profile-refresh UPDATE every time;
device-id users cost a SELECT every time. None of it bought anything
after the first request.

Now the first request identifies the old way and the server hands back
a signed token (HMAC-SHA256 over user, device, how identified, issued,
expires; valid a day; renewed in its last six hours). The client sends
that instead and the server resolves it with no database work. A
refused token is dropped and the request retried once the old way.

What it deliberately is not: a change to who can do what. The token
asserts what the header it replaces asserted, for the same person, for
less time than a device id lives. `via` is recorded so P1-6 can gate
value on the Telegram-signed identity later without another handshake.

The key derives from the bot token when `SESSION_SECRET` is unset —
Telegram's own signature already rests on it, so no new trust is
introduced — and with neither set the feature is off and the app is
exactly as it was. `check:session` pins mint, verify, expiry, renewal,
tamper, rotation and off-when-unconfigured.

*D-63 to D-68 were decided between 3 and 8 Sep, before D-61/D-62, and are
numbered in the order they were written up, not in date order.*

### D-63 · Show only the pins we can defend ✅
*Decided 7 Sep · PRs #551, #557 · `server/src/services/placementConfidence.ts`*

Every pin is an invitation to walk somewhere and look. Five misplaced pets
came back from the map as screenshots — a dog in Kharkiv drawn at a Kyiv
stadium, another at Печерськ, a cat on a music school — and what they had
in common was not the city. It was that nothing in the ad put the animal
where we drew it, and `placement_source` already recorded that.

So a pet is offered to a walker only when its coordinate came from a person
(`owner`, `sighting`) or from a place the ad explicitly named
(`gazetteer-marked:`, and since D-64 `gazetteer-judged:`). Bare name
matches, fuzzy matches, model guesses and the fall-through are hidden. All
four paths that can send somebody to a pet — map pins, the search-zone
spawner, the companion's "nearby", `/dogs/nearby` — read one bar, so
relaxing it is one line.

**The cost was measured before it was chosen: 127 visible pets → ~28.** A
hidden pet is one nobody walks for, a real loss to its owner. A pet drawn
in the wrong district is worse: it spends somebody's afternoon and teaches
them the map lies. The owner's call, made on those numbers.

### D-64 · The judge may only reject ✅
*Decided 8 Sep · PRs #562, #563 · `server/src/pipeline/placementJudge.ts`*

A string matcher cannot know that a village street shares a name with a
square in the centre; that is world knowledge, so a model reads the ad
afterwards. But it answers one question — does this ad support this
pin? — and **it never returns a coordinate, never names a place, never
promotes anything the resolver did not find.** Asking a model *where* a pet
is produced «Таруша»; asking whether an ad supports a pin somebody else
chose has a worst case of hiding a pet, which is quiet and reversible.

When it cannot run — no key, no budget, an error, an unreadable answer —
nothing changes: the row keeps its unjudged label and the bar hides it.
Opus rather than Haiku because the distinctions are the hard half and
the volume is ~one pet every other day ($0.19 for 44). And the CLI's dry
run writes a plan that `--apply` replays without asking the model again,
because a model asked twice may answer differently and "a human reads the
dry run" means nothing if the apply writes something else.

### D-65 · A sighting with an invented position is refused ✅
*Decided 5 Sep · PR #544 · `server/src/routes/sightings.ts`, `app/hooks/useLocation.ts`*

The client's Kyiv-centre fallback is fine for opening a map and wrong for
a sighting, where the coordinate *is* the evidence — one such report moved
«Коля» onto the parser's fall-through pair and off the map the evening he
was placed. `POST /sightings` now answers 400 to that pair; the walk flow
drops only the coordinate and still pays the paws, because the person did
walk; and the app says "I can't see where you are" rather than "try
again". Refused on both sides because an old client keeps sending what it
was built to send. An invented report is not a weak report; it is not a
report.

### D-66 · Spent game items are pruned; scores live on `users` ✅
*Decided 6 Sep · PR #545 · `server/src/services/spentItemCleanup.ts`, migration `0038`*

175 MB of a 500 MB database was collected tokens and eaten bones that
nothing reads — all sixteen queries filter to unspent rows, and lifetime
totals are counters on `users` incremented inside the collect transaction,
so deleting every spent row leaves every profile reading the same number.
A daily janitor keeps seven days (long enough for the double-collect guard
to still answer 409), deleting 5,000 rows a batch so the backlog drains
over days rather than as one long transaction on a shared vCPU.
`collect_events` is deliberately untouched — «bones eaten» counts from it.

Separately, a partial index on `owner_id` over unspent rows gives the
planner a way to reach one player's tokens without walking every
uncollected token in the city, which is the cost that scales with how many
people are playing. What this is *not*: a smaller database file. Postgres
reuses the space; the reported size drops only after a `VACUUM FULL`, which
takes an exclusive lock and belongs in a chosen window, not a cron.

### D-67 · A teleport snaps the dog; a walk is lerped ✅
*Decided 8 Sep · PR #561 · `app/hooks/useCompanion.ts` `TELEPORT_M`*

Air-raid alarms come with GPS spoofing that relocates people across the
city, so a fix jumping kilometres is a recurring condition for these users.
Every companion step was a lerp capped at a jog, so after a jump the dog
was left kilometres behind and could never close the gap — and because
the gate's question and buttons are children of the companion, which
`MapView` hides when off-screen, the app was a dead map with nothing to
tap. A gap larger than 300m (bigger than any real walk between ticks,
smaller than the viewport) now snaps the dog to the user, on the fix as
well as on the tick, above the `menuOpen` freeze; and the off-screen rule
stops at the gate. Reproduced by driving the real bundle with spoofed
fixes before and after.

### D-68 · Specificity outranks exactness, and one side must announce a place ✅
*Decided 3–7 Sep · PRs #537, #542, #553 · `server/src/pipeline/resolvePlace.ts`*

Three ordering rules in the resolver, each with a measured cost written
into the fixtures. A narrower reading beats a dictionary-exact broader
one, so an inflected hospital beats a letter-perfect district (one
resolution changed across 192 pets, from a district to a neighbourhood
inside it). Marked still wins over everything. A landmark match needs
either the ad or the gazetteer name to announce a place — «район цирка»,
or a stop named «Вул. Празька» — and a name made only of generic words is
refused (78 resolutions → 72, all ten bad ones gone). And a name shared by
a station and its district is one place at two scales, not a namesake
pair, while «метро X» names a station and only a station: a station we
do not have is a refusal, not a square of the same name.

### D-69 · Registration at the door, for everybody ✅
*Decided 12 Sep · `server/src/lib/accountPolicy.ts`, `server/src/routes/auth.ts`, `app/components/ui/AccountDoor.tsx`*

Every account gets a nickname, an e-mail and a password before the map
opens — PWA and Mini App alike. The owner chose the strict shape over
the two softer ones on the table (progressive registration after the
first walk; Telegram users exempt because Telegram already signs who
they are), and chose it knowing the cost at an open launch: a form in
front of the dog.

**And the table starts empty.** The ~543 rows that existed before the
door were drive-by device ids with nothing real behind them, so rather
than carry them across, they are wiped when the door ships
(`wipe:users`, dry by default, `--apply` explicit) and everybody
registers fresh. Pets and sightings are not the users' and stay; only
their `reported_by` / `reporter_id` link goes (ON DELETE SET NULL). The
multiplayer bots are kept so day one has a populated map.

What the decision does NOT change is the mechanism. Identity still
arrives as a device id or a Telegram signature and still resolves a
`users` row on first contact — minutes before the form is filled — and
registration writes onto that row, so nothing collected before the door
is lost. D-35 (an existing account is never lost to a gate) still holds
for every row created from here on. The three consequences worth
carrying:

- **The API enforces it, not only the UI.** Once identified, every
  route but `/auth/*` answers 403 «registration required» until the
  account is through — stamped into the session slip as a `registered`
  claim so the hot path still costs no database read. A slip minted
  before registration is replaced by the one `/auth/register`,
  `/auth/verify` and `/auth/me` hand back.
- **A login outlives the day.** An e-mail login leaves a 90-day refresh
  token (hashed, revocable, `auth_sessions`) behind; the client trades
  it for a fresh slip instead of falling back to the device id, which
  would have quietly logged the person into an anonymous account. A
  password reset revokes every one of them.
- **Verification is required only when it is possible.** With no mail
  sender configured (`RESEND_API_KEY`, `EMAIL_FROM`) nobody could ever
  satisfy it, so `doorFor` stops asking, loudly, at boot. Two switches
  exist for launch day: `REGISTRATION_REQUIRED=0` takes the door down
  entirely; `EMAIL_VERIFY_REQUIRED=0` keeps it up without the link.

**The door is asked by the dog, not by a page.** The map and the dog
load as always; at the gate, before the four intents, the dog asks
«нюх-нюх! ми знайомі?» with two answers in the same pill grid — «так,
ти шо не впізнав?» opens the account sheet on login, «ні, давай
познайомимось!» on registration. The sheet is a popup in the scene, not
a dimmed modal over it: the map stays as it is, the camera eases so the
dog sits in the upper part of the screen (the follow loop holds while
the sheet is up, or it would pull the dog straight back to centre; the
onboarding hints wait too), the paper is as tall as its form — up to
what the dog needs above it (its centre no higher than 150 px from the
top of the VISIBLE height, measured, not `vh`, which on iOS Safari
counts the space under the toolbars), the register form tightened so
it fits without scrolling even with a pet named (name and breed share
a row); only a form taller than that room scrolls, inside the paper
under its drawn edge. The paper hangs from just under the dog — 190 px
below the safe area — not from the bottom of the screen, where a short
login form left a band of empty map and sat on Safari's toolbar; the
paper reports where its top edge is and the camera puts the dog 40 px
above it. **Amended 14 Sep (PR #631): one block, centred.** The
portrait step's five-line asking pushed the bubble off the top of the
screen, and the GPS pill (D-74) landed between the line and the dog.
Now the dog's line, the dog and the paper are laid out together —
the bubble reports its height, the paper its own, and the paper's
top is chosen so the margin above the bubble equals the margin below
the paper, inside the visible height and both safe areas, never under
12 px; a block taller than the room keeps the top margin and the paper
scrolls inside. Every step of the door gets this, since every step is
the same paper under the same dog. The HUD's pills stay hidden under
the sheet. Its ink is not clipped by the paper (no `overflow: hidden`;
the scroll container clips its own content, rounded), and a corner
arc always gets at least four points, or a pill-shaped field comes out
with pointed ends. The dog — the same dog, on the map —
says the line for whichever screen is showing. The framing ease was being killed a few
ms in by a padding reset on every spots update (MapLibre's `setPadding`
is a `jumpTo`, and a `jumpTo` stops any ease); it now resets only
padding that is there. When the account is
through, the sheet closes, the camera settles back, and the same gate
shows the four intents. A mail link opens the app already through.
Logging out returns to the gate and the same question — and, outside
Telegram, ROTATES THE DEVICE ID: the device that registered *is* the
account (its `x-device-id` maps to the registered row), so dropping the
login alone put the person straight back in. The account is edited from
the profile: a small «змінити» chip on the dog card opens the same paper
with the door's fields (nickname, the pet — renaming the pet renames the
companion), a password change that needs the current one and revokes
every other login, and «вийти з акаунта» as a line at the bottom. The
e-mail is not editable there: a new address would have to be verified
again and the door would close behind the person, so that is its own
flow, not yet built.

The pet is optional (helpers without a pet skip it) and, when given,
names the companion. Passwords are scrypt from Node's own crypto — no
native module in the Fly image. Nickname uniqueness is on a key the
application folds (NFKC + lowercase), because whether «Оля» and «оля»
are one person must not depend on the database's locale, and the local
Postgres this was tested on folds nothing outside ASCII.

Social logins were considered and parked: the Telegram Login Widget is
the one worth adding (same bot, same HMAC, merges the PWA and Mini App
rows for free); Google refuses OAuth inside Telegram's webview
(`disallowed_useragent`); Facebook needs Meta review and Instagram no
longer offers a consumer sign-in at all.

Checked end to end against a local Postgres — the door, both
registration errors and the happy path, verification by link from a
different device, login on a second device, refresh, logout, forgot and
reset, the spent-link and wrong-password cases, and an unregistered row
keeping its id and points through registration — and by
`check:accounts` for the pure half. The wipe was run on the same local
database: pets and sightings survived with their reporter nulled, the
bot row survived, everything owned by the users went with them.

### D-70 · The ink line is one recipe, and it is PR #514's ✅

Every edge in the app is drawn by one component, `HandDrawnFrame`
(`app/components/ui/HandDrawn.tsx`), written on the `app-ui-ux` branch
and merged as PR #514 on 21 Aug: a 2 px stroke of one width that
follows the rounded rectangle a CSS border would trace, nudged along
its normals by one or two slow waves of at most 1.1 px (less on small
things), with corners sampled coarsely enough that a pill's end is not
a perfect semicircle. That is the recipe. The lost-pet form (#532), the
profile park (#560) and the account sheet all draw with it unchanged.

On 12 Sep two changes to the recipe were merged and reverted the next
day: corners sampled with at least four points (#591), and a filled
ribbon whose width swelled and thinned along the run, "pen pressure"
(#592). Both were a session's own idea of hand-drawn, prompted by the
account sheet's paper clipping its ink at the corners — thick where the
line bowed, flat where the clip cut it — which the owner had read as
the intended look. The clip was the defect (D-69: the paper no longer
clips). The line was never meant to change, and the two PRs made every
edge in the app inconsistent with the one they were trying to match.

The rule for next time: the frame's look is not tuned per screen or
per session. A surface that looks different from the cards is either
clipping, sizing or measuring its frame wrong, and that is what to fix.

The recipe has two numbers the owner asked to move on 13 Sep, once and
for every frame: a corner is sampled with at least three points (two
made a pill-shaped field's end a point), and the wobble floor on small
things is half the full amount rather than 0.3 (at 0.3 a 35 px field
wobbled a third of a pixel, so every field came out the same shape,
seed or no seed). Those are the recipe now.

### D-71 · Camera physics: a flick glides like a scroll view, a move from rest eases both ways ✅

The owner's word for the map, 13 Sep: roaming felt "too linear". Two
things were behind it, both in how the camera moves rather than where.

**The flick.** MapLibre's inertia (`handler_inertia.ts`) takes the
finger's speed × `linearity`, runs for that ÷ (`deceleration` ×
`linearity`) seconds, travels speed × duration ÷ 2 along `easing` — so
the glide STARTS at easing′(0) × linearity ÷ 2 times the finger's
speed. The previous numbers (quintic ease-out, linearity 0.7,
deceleration 950) started it at 1.7×: the map kicked forward the
instant the thumb lifted, then died into a crawl within ~750 ms for a
moderate flick. Now the speed decays exponentially, the way a scroll
view glides on iOS (e^-4.6 over the run, 1% left at the end), with
linearity 0.43 so the glide begins at exactly the finger's speed and
deceleration 600 so it carries as far as before (~800 px for a brisk
flick) over a longer, softer tail (~2.5 s, most of it in the first
second). The owner's second pass the same day — "smoother, slower,
softer" — took it to e^-4.2, linearity 0.47 and deceleration 450: a
brisk flick now glides ~3.3 s and ~1200 px, a moderate one ~1.8 s and
~330 px, and is still moving at one second where the first cut had
nearly stopped. Softer necessarily carries farther: the glide starts
at the finger's speed either way, so a gentler decay is a longer run. Computed from MapLibre's own formula, not felt: the headless
browser cannot drive a real drag here (the follow loop keeps the map
perpetually easing), so the thumb test is the owner's.

**A move the app makes.** MapLibre's default curve is an ease-OUT: the
camera leaves at full speed and only slows, which is right for inertia
(the finger set the speed) and a jolt for a move from rest — a
recentre on a tap, the lift when the account sheet opens, the swing
into supersniff. `easeCamera` now applies a cubic ease-in-and-out
(`HOUSE_EASING`) to every `short` and `cinematic` move whose caller
did not pass its own curve. The chained `follow` ease keeps its linear
curve: its whole trick is that each tick continues the last one. The
two `panTo` calls that had bypassed the helper go through it now, so
there is no camera move in the app outside camera.ts.

### D-72 · The pet's portrait: a drawing kept, a photo never stored ✅

The owner asked for "the avatar" on 13 Sep, and whether it should be
"the second-level form after basic info". It is: the step after the
door, not part of it. Registering asks for the four things the app
cannot work without (D-69); the portrait is the first thing it asks
for that it could do without, so it comes after the e-mail is
verified — never a paid model call on an account that may not be
real — and it is skippable («потім»). It comes back the same three
ways: the dog asks once, right after «я підтвердив» or the link
itself (the link device lands on the same step); the account sheet
(«змінити») carries a row to draw, redraw or remove it; and a person
with no pet is asked for their own photo instead — the model draws them
as the animal that suits them, so everyone on the map has a portrait.
(Until 14 Sep the step required a pet: leaving «маю тваринку» unticked
skipped it, and the portrait only surfaced later through «змінити».
The owner asked for everybody; PR #630.)

**What is made.** A photo of the pet goes to an image-editing model
(FLUX.1 Kontext behind fal.ai, `server/src/services/avatar.ts`) with
one prompt — the app's own paper: a few black pen lines on white, no
shading, no colour. One recipe, like the ink line (D-70), not tuned
per pet. The drawing comes back as a PNG and is kept the way every
picture here is kept: uploaded to a Telegram chat by the bot, stored
as the `file_id`, served through `/photos/:fileId`. The chat is
`AVATAR_CHAT_ID`, falling back to `ALERT_CHAT_ID`, so the feature
works the day `FAL_KEY` is set and every drawing goes past the owner
with the nickname and the pet's name as the caption.

**What is not.** The photo. It travels inside one request as a data
URI, the model reads it, and nothing writes it anywhere — not the
database, not Telegram, not a log line. The sheet says so under the
pick button, and the promise is the reason the design is a drawing
and not a cropped photo: a drawing of a dog is not a photo of
somebody's living room.

**Money.** A drawing costs a few cents. Two ceilings: the burst
limiter every paid route has (`limitExpensive`, 10/min), and five
drawings per person per day, counted in `avatar_draws` (migration
`0043`) rather than in process memory a deploy would reset, and
counted BEFORE the model call, because a call that timed out on our
side may still have been billed. The route also refuses before the
door is open (`not_verified`) and says `avatar_unconfigured` when
there is no key, in which case `/auth/me` says `avatarConfigured:
false` and the client never mentions the step.

**Where it shows.** The profile's dog card, beside the name, as a
small round drawing on paper. Nowhere else yet; the map's dog is still
the pixel dog. Whether the portrait replaces it on the map, or marks
the person's ground, is a later decision.

**The hand (13 Sep, same day).** The owner showed the landing page's
posters as the target and sent ten of the illustrator's drawings:
thick felt-tip marker, one line weight, a big cartoon head, dot eyes,
hatching only on shaggy fur. Words alone get a model near a style;
a picture of it gets closer. So a second recipe sends three of
those drawings along with the photo on the multi-image endpoint
(`AVATAR_RECIPE=reference`). It shipped as the default and lasted one
drawing: the owner sent a golden retriever and got the reference
bulldog back, near verbatim — the editing model treated a reference
as the subject, and "do not draw the reference animals" did not hold.
Reverted the same afternoon to `marker` (words only, single
image), whose first drawing was the retriever, recognisable — and,
the owner's words, "too detailed and too realistic": a handsome ink
illustration, not a child's uneven marker doodle. Two things measured
in one afternoon, then: Kontext's multi-image endpoint cannot be
handed an animal drawing as a style sample, and no sentence gets
Kontext to the naive hand. So the reference recipe moved to a model
built for "make this look like that" (Nano Banana, Google's image
edit, via fal) with the illustrator's drawings, and is the default
again; `marker` stays as the fallback. Its first drawing (15:32) was
the retriever, in a hand close to the posters — "wow, that's nice
already" — still a touch neat. The owner's next call: hand the model
the most chaotic drawings, not the cleanest, so the reference set is
now the four scribbliest (mop, maltese, terrier, poodle) and the two
tidiest (bulldog, dachshund) are left out. A model given tidy samples
tidies. That drawing (15:47) was "not enough, definitely too clean":
the right dog, a tidy ink illustration. Three more turns of the same
dial in one change: eight samples instead of four, the samples BEFORE
the photo in the request so the register is set before the subject
arrives, a prompt that asks for twenty to thirty fat strokes and
"draw less", and the photo downscaled to 512 px on the phone so there
is less texture to keep. That got the retriever and a puppy (15:56,
15:58) to a simpler, thicker sketch — "we moving" — still a sketch.

**Our own ink (same afternoon).** What separated those drawings from
the posters was no longer what was drawn but how the line sat on the
paper: thinner than the marker, precise, tidy hatching. That part
the app can do itself, as it draws the UI's frames itself (D-70):
`services/ink.ts` thresholds the model's PNG to pure black and white,
thickens the line to marker weight, and displaces the whole drawing
through a smooth random field seeded from its bytes so no edge is
straight. Previewed on the two real drawings before shipping; on by
default, `AVATAR_INK=off` to compare. The model finds the animal; the
app holds the pen.

**No photo in the drawing step (same afternoon, the owner's
reading).** Every drawing made from the photo was a sketch of the
photo — fur, highlights, a nose with nostrils — however the samples
and the words were arranged; "it tries to do photorealistic things
and very detailed", while the posters are "low effort, super simple,
funny/ugly/clumsy". The photo was the anchor. So the default recipe
(`describe`) shows the photo to a vision model once (Claude Haiku,
`petDescription.ts`), which says in one sentence what a caricaturist
would need — coat, ears, muzzle, markings, expression — and the image
model draws from that sentence and the eight samples with no photo in
the request at all. A caricaturist works from a description. Likeness
becomes breed-level plus the distinctive bits, which is exactly what
the posters are. The photo still is not stored anywhere: one look,
not retained by the API. `reference` (photo beside the samples) is
the automatic fallback when no description can be made.

**The right hand, the wrong dog (first run, same evening).** The
first drawing from words alone was the first one in the illustrator's
hand — fat wobbly line, ugly on purpose, the ink pass and the missing
photo landing together — and it was a fluffy poodle-ish dog for a
smooth golden retriever. Two things lost to the samples: a sentence
that said "long-coated" and did not say "smooth" left the coat to the
eight shaggy sample dogs, and nothing in the request carried the
actual animal. The owner's read: close in style, different pet, and a
person would feel it is not their dog. So the description is now five
labelled parts with the coat's texture one word from a fixed list
(smooth, short, long, shaggy, curly, wiry), the drawing prompt says
the description decides the animal and the samples decide only the
line — a smooth coat is one clean outline with no fur strokes even
though the samples are shaggy — and the photo goes back into the
request, last, named as a likeness check that must not be drawn.
That last part is the owner's suggestion and the one that risks
pulling the model back toward the photo; `AVATAR_DESCRIBE_PHOTO=off`
takes it out again without a code change. The description is logged
now: a wrong drawing is not debuggable without knowing what the
drawing model was told, and the line is about a coat and a pair of
ears.

**The right dog, still too competent (second run).** Light and long,
floppy ears, long blunt muzzle, tongue out: the description was
right, the photo held the likeness, and the drawing was a golden
retriever — the owner's best so far, and "still a bit realistic":
both eyes level, both ears the same length, tidy fur strokes. Two
things were tried the same hour and both were wrong. A WARP in the
ink pass (one slow wave across the drawing so the head is lopsided)
read on five real drawings as a tilted picture, not a clumsy hand;
a kid's drawing is lopsided in its shapes, not rotated as a whole.
And more prompt — "a low-effort, low-detail sketch", "one eye higher
than the other" — made the five drawings thinner and sketchier than
the one before: "sketch" is a loaded word for an image model, and
the asymmetry line was ignored. The prompt had grown to three hundred
words of rules, and the model followed perhaps three of them. The
daily cap went from 5 to 100 the same day: the owner tuned through
three accounts in an afternoon, and the number left is a guard
against a script, not a person.

**Fewer instructions (the owner's call, same evening).** "We give
him too much instructions instead of asking him to: not make
realistic and not copy the photo; copy the style and concept of the
reference drawings — hand drawn, childish, fast, fat uneven lines,
weird, low effort, draft." So the default recipe is `reference`
again, with a prompt of about eighty words that says exactly that
plus the three things that keep an avatar usable: the same animal
(coat, ears, muzzle, markings), head and shoulders facing the
viewer, black on white and nothing else. The photo and the eight
samples do the rest. The describe recipe stays behind the env switch
for comparison; the warp is off.

**Fewer lines in, fewer lines out.** The short prompt drew the
retriever in the illustrator's hand — "good but need less detail and
more mistakes". The detail was fur strokes on the chest and ears,
and they came from the samples, not the prompt: the eight in the
request were the fur-heavy ones. The model copies what the samples
do. So the set is now the four most abstract of the ten, the owner's
pick — the poodle with the loopy ears and the terrier ("like these
two"), the mop scribble, the spaniel — not the bulldog (a tidy head)
and not the dachshund (a clean side profile, the only one not facing
the viewer). The prompt gained two lines:
as few lines as you can, fewer than the drawings, no fur strokes;
leave the mistakes in. Then the owner's pick of samples: the four
most abstract — the loopy poodle, the terrier, the mop, the spaniel.

**"Not bad" (four-sample round, same evening).** A retriever, a
bulldog, a poodle and a cat, all plainly in the illustrator's hand
and all plainly themselves. The asks: eyes too black, half the
detail, more approximate lines, a thinner stroke — and the pet
bigger in the frame. The ink pass took the ones it can: weight 3 →
2 (the dilation was fattening the eyes as much as the line), wobble
5 → 8, and a FIT step that crops to the ink and rescales so the pet
fills 80% of the frame — a rescale only, the geometry untouched. An
eraser for small loose blobs (freckles, whisker lines, fur ticks) was
built, measured and dropped the same hour: the retriever drawing is
eight blobs, and the outline, ears, mouth and most of the chest
strokes are one of them, so it could only nibble at the edges; and
the owner's call was that less detail belongs at generation, because
detail dictates the geometry of the whole picture, and erasing after
the fact breaks the simple drawing's charm and skeleton. So the pass
never removes ink. The detail ask went to the prompt, said plainly:
half the lines, an outline, ears, two small dot eyes, a nose, a
mouth, and that is all — and, the owner's last note, a funny
character out of a children's picture book, a cartoon, not a
portrait.

**Four for the poster (same evening).** A retriever, a cat, a
bulldog and a poodle: dot eyes, one outline, a dozen lines, the pet
filling the frame, each plainly itself. "Look at those." The owner's
next experiment: only the two most chaotic samples, the loopy poodle
and the terrier, and nothing else changed, so what it does is
legible. The risk is that two samples pull the model toward those
two animals. It held: the retriever and the bulldog came out cleaner
than with four, the poodle wore the sample's ear loops (right for a
poodle, not a copy), the cat picked up a few more forehead ticks —
the one species with no sample of its own, which is a request to the
illustrator, not a code change. Two stays. "We already got the really
strong result"; the owner validates with the art director. One last
lever, tried as the last change: a chaos line in the prompt, "draw it
in five seconds without looking at the paper". It made the four
drawings MORE detailed — the bulldog's freckles came back, the cat
grew fur. To this model a five-second sketch is a gestural scribble,
more marks, not fewer: speed words add lines. Replaced by a
simplicity line that hands it a shape vocabulary instead of a mood —
a wobbly blob for the head, the ears, two dots, a blob nose, one line
for the mouth, one more thing only if it is what makes this dog this
dog; if a line is not needed to tell it is this dog, do not draw it.
"Simplicity works, I love these": the cleanest retriever of the day,
dot eyes, one outline, a tongue. Kept. Then, for "a bit of
craziness", the owner's line, "draw like you're drunk", written so
it reads as geometry and not as texture (the speed line taught that a
mood word alone becomes "sketchy", which is more marks): the hand
wobbles, the proportions come out wrong, lines land in the wrong
place, and you do not fix any of it. Dropped: "drunk" landed on the
pet, not on the hand — the retriever got a raised eyebrow and a
lolling tongue, the bulldog a cocked brow, drawn with a steady hand —
and whiskers and freckles came back with it. The prompt the art
director sees is the simplicity round: the two samples, the photo,
the shape vocabulary, and nothing about speed or mood. The line
itself has a little room and not much: the same drawings re-inked at
a shakier setting read as a nervous hand at one step up and as
static at two. One more framing, the owner's, tried on its own:
CARICATURE, said as what to do with the drawing rather than as the
word alone — wildly out of proportion, whatever is big on this dog is
huge, whatever is small is tiny, the one thing that makes it this
dog is the biggest thing in the drawing. A property of the drawing,
which is what lands; not a funhouse mirror, which the model would
take literally and photographically. It landed, too literally: the
model picked one feature per pet and blew it up — saucer eyes on the
cat, a tongue the size of the head on the retriever — a caricature
by instruction. "Maybe not so precise a guide": cut to the bare
idea, "a caricature: exaggerated, wildly out of proportion", so the
model chooses how. That one held: the cat's eyes two sizes, the
retriever with a chin, the bulldog the cleanest of the day, nothing
blown up on instruction — "very interesting". Kept. Then the owner
recalled the crayon trend (photos "crayonised" with a prompt: "simple
shapes, uneven lines, rough wax strokes, bright playful colours,
looking like a 4-year-old's fridge art"). Fridge art is a genre the
model has seen thousands of times, the same kind of handle as
caricature — it names the drawing, not the artist. Taken minus the
wax and the colour, which the ink pass would turn to blobs: "a
4-year-old's fridge art: simple shapes, uneven lines, drawn with a
fat black marker, no crayon, no colour". One line on top of the
caricature round. No effect: the four drawings were the caricature
round's four within the model's own spread — the prompt already said
everything the line said, and a synonym added nothing. Dropped, by
the rule that a line stays only if it earned its place. That is the
plateau: four rounds in a row look about the same and all look good.
Words have done what words can do with this model and these two
samples; the next lever is the illustrator's own — a cat drawn by
them is still the one thing that would move the cat. The build for
the art director is the caricature round: two samples, the photo,
the shape vocabulary, "a caricature: exaggerated, wildly out of
proportion", and nothing about speed, mood or genre. If this still
polishes past the
samples, what is left is the style adapter trained on all ten
drawings (with the illustrator's agreement, since it clones their
line).

**A person becomes their dog.** The owner drew themselves (14 Sep)
and the recipe drew a person — a good one, curls and grin, and the
one thing the map should never show. Their idea, one line in the
prompt: if the photo is of a person and not an animal, draw the dog
(or cat, by the profile) this person would be, the breed that suits
their face, keeping one thing of theirs so they recognise themselves.
Funny, shareable, and every chip on the map is an animal. Tested
the same morning on the owner's own face: a scruffy grinning terrier
with the curls, unmistakably them. So that nobody is surprised, the
dog says so when it asks for the photo ("у нас звірячий всесвіт —
якщо на фото людина, перетворю її на звіра, який їй пасує"), and the
studio's privacy note repeats it.

**What would change it.** The model: the endpoint and prompt are one
file, and `FAL_API_URL` already stands in for it in the local e2e
stack. The storage: if photos ever leave Telegram, this leaves with
them. The cap: `AVATAR_DAILY_CAP` in routes/auth.ts, one number.

### D-73 · Other walkers are chips, and a tap opens their card ✅

The owner's mock (13 Sep) shows the people on the map as small
round portraits with a thin ink ring, not as the shared dog sprite,
and a tap on one opening a sheet: the portrait big and unframed, the
name, the level, a miniature of their territory with its size, and a
«помахати» button — "without msg button right now only poke button".
Three things follow.

**The chip is the portrait; the sprite stays one constant away.**
`OtherWalker` draws a 40px white disc with a `HandDrawnFrame` at
stroke 1.25 (the profile card's ring is 2 — "check the chips border
so its thin like here and not fat like we have now in profile") in
plain ink (the first cut coloured it by territory; on the map that
read as a badge, and the owner asked for black "as everywhere") —
the chip instead GLOWS in the owner's colour, a soft halo behind
the paper — full in the territory view, gentler on a walk (halved
again on 14 Sep, PR #629: on a plain map the halo is a tint at the
paper's edge that says "someone", and "whose" waits for the painted
ground) — so
"whose zone is that" is still answerable by the chip standing on it — and the drawn portrait
(D-72) inside it; a walker without a portrait gets the sitting dog sprite in the
disc, so a chip is never blank. The old rendering — sprite plus name
tag — is not deleted: `OTHER_WALKER_STYLE` in
`app/constants/experiments.ts` is `'chip' | 'dog'`, one word to flip
back "if we dont like chips". The tap on a chip opens the card; the
tap on a dog still pokes directly, as before.

**The card reads from presence first and asks the server second.**
Presence (`mp:meta`) carries the portrait URL now (`a`), so the chip
and the card's header render from what the map already has; the
sheet then fetches `GET /players/:id` for the level and the
territory — the largest piece of their ground, decimated to the same
48 points the map's own polygons use, and the area — so the map
poll does not grow by a polygon per walker. The miniature is the
leaderboard's own `TerritoryMini` at the board's 92px — the same
simplification, the same dashed edge over a wash — so the piece a
walker recognises in the standings is the piece on the card, not a
cousin of it (the first cut drew its own solid-edged polygon; the
owner asked for the board's recipe, for consistency). A person's level is
`xpProgress(companion_state.xp)`; a walker without ground shows
«ще без території». The poke button is the existing `POST /poke`;
pokes at bots are still swallowed server-side (the wave is local).
The portrait cache in `selfMeta` is forgotten when a portrait is
drawn, kept or removed, so the next poll carries the new one rather
than the hour-old null.

**The bots have breeds, portraits and a level, and none of it is
real.** Thirty names in `services/botAvatars.ts`, each with a breed
and a one-line description written by hand in the shape
`petDescription.ts` produces; `pnpm bots:avatars` draws each through
the D-72 recipe (the two samples, no photo) and the ink pass into
`server/assets/bot-avatars/<i>.png`, served at `/bot-avatars/:n.png`
with a day's cache and committed to the repo like any asset. The
level is `2 + (i·7 mod 11)`, a stable fiction so a bot's card does
not say «рівень невідомий» beside a portrait. Until the files are
drawn — it needs `FAL_KEY` in the session that runs it — the chips
show the sprite and the card shows no portrait, which is the honest
state, not an error. The first twenty names are the old `NAMES`
list in the same order so the `bot:N` rows keep their names.

**The face travels.** The same night the board rows (the profile's
«хто тримає цей район» and the full sheet) got the portrait beside
the name — 88px, twice the profile card's, ringless, first after the
rank with the silhouette moved to the row's end — from a new
`avatarUrl` on each leaderboard entry — a person's by stored file id, a bot's from the
roster — with a blank paper disc where nobody has drawn one so the
names stay in a column; and the card's territory row became a tap
that makes the standing's jump (`onPickOwner`: into the territory
view, then the flight onto the dog), closing the card so the flight
is seen; no link text says so — the section is the tap, like a board
row.

**The name on the map is the dog's.** The owner asked (14 Sep)
what the card and the chip show — the nickname, it turned out, while
a bot showed a dog's name and a person's own dog's name showed
nowhere but on their profile. An animal world names its animals:
presence, the card and the board now say the dog's name when the
account has a pet, with the nickname beside it as `owner` («рівень
8 · господар pavlovski» on the card, «0.51 кв. км · pavlovski» on
the board) so a friend can still find a person; a walker without a
pet keeps their nickname as the name, which after the person-to-dog
portrait is a dog with a human name, and that is part of the joke.
The presence cache is forgotten on a profile save so a renamed dog
is renamed on the map within a poll.

**What would change it.** A message button: the card is the place
for it, and the sheet's `Primary` is the only button now on purpose.
The chip size and stroke are two constants at the top of
`OtherWalker.tsx` (48px since the first night on a phone: 40 read as
small; and the profile card's and edit sheet's portraits lost their
drawn ring the same night — the marker line is the edge, as on the
card). If presence ever carries the level, the second
fetch goes.

### D-74 · A GPS fix outside the city is not a position — the app holds where it last knew you ✅

Kyiv's air defence jams and spoofs GPS whenever drones are up. The
phone does not report an error: it reports Lima, or a village sixty
kilometres south-west, at full confidence, once a second. The owner's
phone did both on 14 Sep. Measured on production that afternoon: 60
paws, 16 bones and 3 territory marks written at 50.0 / 29.8, outside
any map anybody will open.

What an accepted Lima fix did to the client: the dog (and the gate's
buttons, which are children of its marker) went to Peru, the map clamped
its camera to the Kyiv bounds' south-west corner, and every follow tick
eased toward Lima and was clamped again — a bare green field over
Boyarka, no HUD, no way back, and the lag of a camera fighting its own
bounds. D-67's teleport snap handled the case where the fix jumps
*within* the city; it could not handle a fix the map cannot show.

**The rule.** A fix outside the served area is not believed. The
location hook stands on the last believable fix — the walker's real
street, so the map stays where they are — or on the Maidan fallback if
there never was one, exactly as no-GPS does. The watch keeps running;
the first believable fix resumes everything with no reload. The hook
reports `held: 'jammed'` and nothing else changes shape: every consumer
already reads `position`, and the position is now one worth acting on.
A jammed phone repeating Lima returns the same state object, so it no
longer re-renders the map screen once a second either; the same
dedupe drops a fix identical to the last one.

**The dog says why.** Once on the way in — «gps зараз глушать, тож я не
бачу, де ми. постоїмо тут, поки не повернеться — все інше працює» —
and once on the way out. A HUD pill («gps глушать — стоїмо тут») stays
up while held, so a person coming back to the phone sees why nothing
moved. A status, not a button: there is nothing to do but wait.

**The server refuses too.** `/sync/map` answers 400 to a position
outside the box (no spawn, no home-ground note), `/presence` publishes
nothing and shows nobody, `/collect/path` sweeps nothing, marks nothing
and leaves the anchor where the walker really was, so the segment that
resumes when GPS returns is the one they walked. The current client
never sends such a position; an older one gets a clear answer instead
of a world it cannot see.

**One box, two copies, one check.** `SERVED_AREA` in the shared package
is the client's; `KYIV_BBOX` in `server/src/lib/servedArea.ts` is the
server's — the same four numbers the ingest gate and the Places spend
gate already used. The server cannot load the shared package at runtime,
so `check:served-area` reads the shared file and fails the build the
moment they differ. Generous on purpose: Boyarka, Brovary and Boryspil
are inside; what it excludes is not "outside Kyiv" but "not a place this
person could be standing".

**What it does not catch, on purpose.** A spoof that lands *near* the
walker and stops moving — the "mildly spoofed" afternoon before the
Lima one — is indistinguishable from a person on a bench. A heuristic
that guesses wrong grounds real walks. Left alone, and noted.

The junk rows are left in place: paws and bones expire on the janitor's
schedule, three marks sixty kilometres out can never close a shape, and
nothing draws them. PR #628.
### D-75 · The happiness index: whose dog lives the happiest life ✅

The owner asked (14 Sep) for a second standing beside territory —
"whos dog lives the most time with high happiness levels" — and
proposed the shape: snapshot the meter while the person is online,
derive a score, fold it into the account's running average, so the
number is honest, all-time, and moves with how the person plays.
Built that way, with two corrections and one consequence.

**Time-weighted, not session-weighted.** Two running totals on the
companion row — happiness × seconds, and seconds — and the index is
the ratio, 0–100. A forty-second feed-and-leave at 100 then weighs
forty seconds, not one session. **The poll is the snapshot.** There
is no logout on a phone web app; the 15-second `/state` poll from any
screen touches `last_poll_at`, and the decay cron — which already
walks every companion row every 8 seconds — sums both totals for the
rows polled within the online window (90 s), from the pre-decay
value, elapsed capped at ~4 minutes. A closed tab adds nothing, a
crash loses at most one poll. **A dog ranks after ten minutes** of
counted life (`balance.happinessIndex.minActiveS`), so three perfect
minutes on a fresh account are not a life; until then your own row
shows a dash and the minutes. (It was an hour for a day: nobody saw
themselves on the board on the day they tried it, and a bot's first
session is shorter than that.)

**The drain now pauses while the person is away.** Happiness used to
fall to zero within a quarter of an hour of closing the app, so every
session began with a grumpy dog climbing back — and an average over
sessions would have measured how fast you feed after opening, not how
you play. The same online gate that counts time is the gate on the
drain: a dog its person is not with does not drain, and coming back
after a gap restarts the decay clock, so it wakes as it was left.
Hunger is gated the same way, as the two live in one UPDATE; the
bones economy is untouched while you are there.

**Bots were a fiction here for a day.** The first cut gave each a
seeded index with a weekly drift and a fake active time; D-76 gave
them a meter, and the fiction went with it.

**The board.** `GET /happiness/leaderboard` mirrors the territory
one (people past the guard plus every bot, best index first, and
your standing), and the profile tab draws it under the standing with
the same `BoardRow` — portrait, name, «N год разом», the index where
the silhouette would be — and a one-line hint of what the number is.
No "see all" yet; ten is the board.

**What would change it.** The window and the guard are two numbers
in balance.ts. If the index should forget — a rolling month instead
of a life — the totals become a per-day ledger; the read side does
not change. If the offline pause proves too kind (a dog never hungry
on return), gate only happiness and let hunger run.

### D-76 · Bots live by the player's rules ✅

The owner asked (14 Sep): "what if we route bots through same rules
as humans … so they come and spawn food and paws for them and let
them go through everything as players would and measure that nicely
and see how systems work and tune balances?" Yes. Until now a bot was
a user row, a spot in presence and territory marks — no companion, no
hunger, no happiness, nothing to eat, and a made-up level and
happiness index on its card. That made the bots scenery, and it made
every balance question answerable only by one person walking one dog.

**A companion row each, and the same crons.** `ensureBotCompanions`
gives every bot the row a person's dog has, with the roster name and
the starting meters. The walker sim already had sessions — a bot goes
offline after a dwell and comes back — so ONLINE is the person being
there: each multiplayer tick touches the online bots' `last_poll_at`
in one statement, the same touch `/state` makes for a phone, and the
decay cron (D-75) then drains their happiness while they are out and
counts their time toward the happiness index, and freezes them while
they are away. Nothing in decay.ts knows a bot from a person.

**Food and paws spawn for them, and they pick them up.** On its turn
(every ninth tick, ~30 s, staggered) a bot makes the spawn a phone's
map sync makes — `ensureTokensForUser` and `ensureFoodForUser`,
unchanged — with the hotspots within 700 m standing in for the parks
a phone would have sent, so bones land in the same parks people find
them in. Every tick, one read for all online bots' live paws and one
for their bones, and anything within `collectMaxDistanceM` (the reach
a tap has) goes through `services/collect.ts` — the transaction lifted
out of the two routes so a tap and a bot make literally the same
write: item consumed, points, hunger, happiness, XP with the lucky
paw, decay clock reset, a `collect_events` row. Level is then earned:
the card reads the bot's XP through the same curve.

**Marking costs and refuses the same.** `placeMark` already charged
the companion; with a row to charge, a bot's mark now costs it hunger
and earns it happiness like a person's. Before marking, one query
reads the online markers' meters and a grumpy or hungry dog is refused
for the same thresholds as `markIfDue`. The bots' own cap logic
(`markAsBot`) stays — it corrects a leak the person path cannot have.

**Closed to bots, on purpose:** quests and lore (paid model calls that
mean nothing without a person reading them), pokes and chat.

**Measured.** Every five minutes the cron logs one line — bones eaten,
paws taken, marks made, refusals by reason — and the `collect_events`
table holds the ledger per bot, so a report can answer the owner's
questions from the database. `GET /admin/bots/report?format=text`
(the report token) is that report: per bot the meters, level, counted
hours, index, bones and paws and marks; and the same per-online-hour
rates for the people, on one screen with the balance rules in force —
so "the bots eat twice what a person finds" is a line to read, not a
guess. The first ten minutes in production said: ~15 bones, ~110 paws
and ~280 marks per five minutes across thirty bots, zero refusals —
and the report shows why the last number is zero: `minHappiness` and
`minHunger` for a mark are both 0 in balance.ts, so the gate is open
for everyone. That is a balance decision to make with the report in
hand, not in this PR.

**Cost.** Per tick: one UPDATE, two SELECTs, and a transaction per
item picked up; per bot every ~30 s: the spawn a phone would have
asked for anyway. On one shared vCPU the tick was ~1.1 s before this;
watch `cron_slow` after the deploy.

**What would change it.** `SYNC_EVERY_TICKS` and `PARKS_NEAR_M` at the
top of bots.ts. If the bots' collecting proves too greedy — a bot
walks over its own spawn radius constantly, a person does not — the
reach is the lever, or a per-bot appetite. If quests should be open to
them for the numbers alone, the model call is the only thing in the
way.

### D-77 · Bots keep an owner's hours ✅

The owner asked (14 Sep) what the bots' online/offline ratio was. It
was 14% chance to log off for one to four minutes after each stop —
about 22 hours a day online per bot, 27 of 30 on the map at any
moment. Fine for making a map look lived in; as a picture of how the
game plays it is wrong in the one place that matters: a dog that is
never left alone never gets hungry, never decays, and its owner's
"time together" is the whole day. Every number the bots exist to
measure (D-76) sits on that rhythm. "id do it so we see close to real
picture, than scale these tests to bigger bot quantities."

**A timetable per bot per day** (`services/botDay.ts`). Three start
windows on the Kyiv clock — morning 06:30–09:30 nearly always, midday
12:00–16:00 half the days, evening 18:00–22:00 nearly always — each
walk 20–45 minutes. That comes to 2.35 walks and 76 minutes a day, a
5% online share: on average 1.6 of 30 bots out, peaking at about five
around 08:45 and again in the evening (`pnpm check:bot-day` prints
the measured figures from 30 bots × 60 days and fails if the share
drifts out of a few percent). Between walks a bot is offline: not in
presence, not polled, its meters frozen exactly as a person's are with
the app closed. The random log-off is gone; the in-walk state machine
(walk, dwell, raid) is untouched.

**Deterministic on (bot, day).** The plan is a seeded draw, so a deploy
or a restart puts every bot back where its day says — before, a
restart marched all thirty online at once. Kyiv time via `Intl`, not a
fixed offset, because Ukraine keeps summer time. Nothing is stored.

**What it costs the map.** Thirty bots on these hours show two to
five dogs at a time instead of twenty-seven. That is the honest
number, and it is what the owner wants to see first; the count is
the lever for a fuller map (`MULTIPLAYER_BOTS`, a Fly secret), and
each one now costs a fraction of the ticks it used to.
`MULTIPLAYER_BOTS_ALWAYS_ON=1` restores the round-the-clock pool for a
local stack, where a test at three in the morning still needs dogs on
the map.

**Measured.** The `mp_bot_life` line now leads with how many are out
and how many went out in the window, and `mp_bots` at boot says which
regime is on.

**What would change it.** `BOT_DAY` at the top of botDay.ts: the
windows, their chances, the length. A "check-in" — the owner opening
the app at home for a minute to feed the dog — is the one thing real
owners do that the bots still do not; add a fourth, short window if
the hunger numbers say it matters.
