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
parse (~$0.001/call). Opus is the priciest call in the app and is reachable
by anonymous device-id users at 30/min — see [`08-open-issues.md`](08-open-issues.md).

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

### D-30 · The CI gate blocks the server deploy, not the frontend ✅⚠️
*PR #274, 4 Jul 2026*

`deploy.yml` runs typecheck + lint as a `checks` job and the Fly deploy
`needs: checks`. `react-hooks/rules-of-hooks` is an **error** — that is the
class of bug that white-screened prod. `exhaustive-deps` is a warning; there
are 21 and that is the baseline.

**The frontend is still ungated.** Vercel deploys on the same push with no
check, so a hook-order bug still reaches the web app first.

### D-31 · Boot-seeding of lost pets was removed ✅
*`index.ts` · "pilot now runs on real scraped pets only"*

The `seedLostDogs()` CLI in `db/seed-dogs.ts` still works for local dev, but
production has no synthetic pets. Everything in `lost_dogs` came from a real
post.
