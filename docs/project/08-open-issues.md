# 08 — Open issues

What is wrong right now, ranked. Where an item came from `AUDIT_FINDINGS.md`
its original ID is kept so the two can be read together.

Verified against the code at `f421b7e` on 11 Aug 2026 — several audit
findings have been fixed since July and are listed as closed at the bottom
rather than left to rot at the top.

---

## The blocking question

### Q-1 · "Pilot" is still undefined
*`PILOT_ROADMAP.md` §4, written 4 Jul, still open five weeks later.*

Everything downstream forks on this and none of it is a technical decision:

- **Audience and size** — founders and friends? A closed group of 20–100
  Kyiv dog owners? An open Kyiv soft launch?
- **Surface** — Telegram Mini App first, or web/PWA first?
- **Data mode** — real ingested reports (real owners, real stakes, real
  trust/safety obligations) or seeded data for a mechanics-only test?
- **Bots** — keep 30 for density, or off for an authentic small-group test?
  (`MULTIPLAYER_BOTS=0` is a one-line switch.)
- **What is being validated** — that the walking game retains people, or
  that the search network helps find a pet? Different instrumentation,
  different minimum bars.
- **Success criteria** — retention %, reports ingested and accurate,
  sightings submitted, one real reunion, qualitative delight?

The roadmap's own default recommendation, absent other input: a small closed
Telegram-first pilot in one or two Kyiv districts, on real data, bots off or
clearly labelled, instrumented for both retention and the report→sighting
loop.

---

## P0 — do before anyone outside the team touches it

### P0-1 · The lost-pet engine has never been validated end to end
*`AUDIT_FINDINGS` had no equivalent; `PILOT_ROADMAP` §5.1 called it the
pilot blocker, and it still is.*

There is no evidence the full loop has been walked with real data: a real
owner's post parsed correctly (species, last-seen location, photo), shown in
the right place, a walker submitting a credible sighting, the owner
notified. **Parsing accuracy and location correctness on real posts are the
single biggest unknown in the product**, and no measured numbers exist.

The 10–11 Aug work made this worse-looking and better-understood: 89 of 261
active pets could not be drawn at all, and 17 were in other cities. Both are
now partly addressed, and neither was known before somebody counted.

**What it needs:** a manual pass over a batch of real Kyiv posts —
parse output vs source post, pin vs reality, dedupe across reposts — with
the numbers written down.

### P0-2 · No source is currently producing pets
*See [`03-lost-pet-engine.md`](03-lost-pet-engine.md).*

- **OLX** — blocked by CloudFront's WAF. The only source that has ever
  inserted a real pet. A `SCRAPE_PROXY_URL` seam exists and is unset;
  choosing a provider is a purchasing decision.
- **Telegram channel scrape** — never configured. Free, unblocked from the
  Fly host, one env var. Needs a curated channel list, which is human
  judgement.
- **Facebook** — parked; needs a burner account.
- **Telegram bot ingest** — works, but has only ever been pointed at the
  owner's test chats.

**Cheapest first:** set `TELEGRAM_CHANNELS`. It costs nothing and it is the
only thing that stops OLX being a single point of failure.

### P0-3 · The ingest alert is dormant
*`services/ingestAlert.ts`, PR #412.*

Built, tested, shipped — and silent, because `ALERT_CHAT_ID` is unset. One
value, no purchase. Until it is set, a source dying is invisible until
somebody reads the heartbeat by hand, which is exactly how OLX sat blocked
unnoticed.

This is the highest value-per-effort item on the whole list.

### P0-4 · Compromised Google Maps key still committed
*`AUDIT_FINDINGS` §1.1 · `docs/TECHNICAL.md:236`,
`reference/shukajpes-demo.html:147`*

Still present at HEAD in two tracked files, and in history. Known
compromised. Rotation was deferred in July and has not happened.

**The fix, in order:** rotate the key in Google Cloud → restrict the new one
(HTTP referrers = the Vercel origins only; enable only the Routes API, since
Places moved server-side) → set a billing quota and budget alert → purge the
value from history (`git filter-repo --replace-text` or BFG) and force-push
→ delete or placeholder the demo HTML, which is a 380KB artifact with no
build role.

The rotation is the urgent part and is a ten-minute Google Cloud task, not
code. The history purge can follow.

### P0-5 · No trust-and-safety path for republished reports
*`PILOT_ROADMAP` §5.3*

You are republishing real people's posts and photos. There is no human
review of ingested reports, no kill switch, no takedown path, and no
moderation of user-submitted sightings.

Minimum floor before a real-data pilot: a way for a human to review or kill
an ingested report, and a way for an owner to ask for theirs to be removed.

---

## P1 — before the pilot opens beyond the team

### P1-1 · Live walker positions are broadcast with no consent surface
*`AUDIT_FINDINGS` §2.4 · `services/presence.ts`*

Every active walker's position is written to a shared Redis GEO set and
returned to anyone within **8km** who asks. Jitter is a stable per-id offset
of ≤25m — good, in that averaging many reads will not de-jitter it, but 25m
in a residential block is identifying. **There is no opt-in, no opt-out, and
no in-app disclosure.**

**Fix:** a toggle that stops the client sending `mp=1` and the server
writing presence. Or presence off entirely for the pilot. Plus a basic
privacy note.

### P1-2 · Mutating routes are unthrottled
*`AUDIT_FINDINGS` §2.2 · `index.ts:50` registers rate-limit with
`global: false`*

**Verified still open.** Only `chat`, `admin` and `sightings` opt in via
`config.rateLimit`. `/collect/token`, `/feed`, `/collect/path`,
`/quests/advance`, `/tasks/tick`, `/poke` and `/sync/map` register nothing —
so `balance.collectRateLimitPerMin` (120) is the plugin default applied to
nothing.

`/sync/map` triggers the whole spawn pipeline, so it is also the DB-cost
lever. `/poke` unthrottled means poke-spamming another walker's screen.

**Fix:** add `config: { rateLimit: { max, timeWindow } }` per route —
`/sync/map` ~30/min, `/poke` ~10/min — keeping the `userId || ip`
keyGenerator. Or flip the plugin to `global: true` with a sane default.

### P1-3 · `force: true` still bypasses every distance check
*`AUDIT_FINDINGS` §2.3 · `tokens.ts:131`, `food.ts:114`, `quests.ts:245`*

**Verified still open.** A client-supplied boolean gates the distance check
on collect, feed and quest advance. The UI sends `force: true` on taps.
`quests.ts` still carries the comment "Testing flag … Gate this later if it
ever ships to non-dev builds" — it shipped.

Scope is self-farming: items are per-user owned, so this corrupts the
economy and any future leaderboard rather than harming other users. Combined
with P1-2 it can be done at machine speed.

The owner has said tap-to-collect is test-only and goes away at launch. That
resolves it if it actually happens.

### P1-4 · No spatial index on `lost_dogs`
*`AUDIT_FINDINGS` §3.1*

`fetchNearbyLostDogs` filters `status='active'` then computes haversine over
every survivor, on every `/sync/map`, per user, every 15s. Cost grows with
(active pets × concurrent walkers).

Note that territory solved the same problem differently and well — bbox
columns plus a composite B-tree, no extension needed. The same shape would
work here.

### P1-5 · The spawn pipeline runs on the 15s hot path
*`AUDIT_FINDINGS` §3.2 · `syncMap.ts` awaits `ensureTokensForUser` +
`ensureFoodForUser` before every read*

A single `ensureTokensForUser` can issue an expire UPDATE, a load SELECT, a
user-area count and insert, a nearby-dogs SELECT, then a count and insert
per nearby dog and per park, and a final cap UPDATE with `OFFSET`. Easily
8–15 round trips per sync per user, on a default pool of ~10 and one shared
vCPU. The Redis cooldowns throttle the *inserts*; the probing still runs
every tick.

**Fix:** gate the whole spawn attempt on the Redis cooldown *before* any
probing query.

### P1-6 · `x-device-id` is unverified identity
*`AUDIT_FINDINGS` §2.1*

Any string of 8–128 chars is accepted as an identity and resolves or creates
a `users` row. Presenting somebody's device id **is** logging in as them.

Mitigating: device ids are client-generated random hex, so this needs the id
to leak (shared device, XSS, logs), and there is no cross-user IDOR — every
mutating route re-checks `ownerId === req.userId`. The Telegram path is
properly signed and fine.

**Fix:** treat device-id accounts as throwaway (they already cannot merge),
and require the Telegram-signed identity for anything with real value. If
device-id must stay first-class, issue an HMAC token on first contact.

### P1-7 · No client error tracking
*`PILOT_ROADMAP` §5.7*

Crashes surface when a human notices. Four white-screen incidents in the
history say this is not hypothetical. Cheap, high value, and it should land
before real users touch the Three.js render.

### P1-8 · The frontend deploy is ungated
*`AUDIT_FINDINGS` §4.2, partially fixed*

The Fly deploy now gates on typecheck + lint (PR #274). Vercel's git
integration deploys on the same push with no check, so a hook-order bug
still reaches the web app first.

---

## P2 — worth doing

| ID | Issue | Where |
| --- | --- | --- |
| P2-1 | **81 active pets sit on the fallback pin and cannot be drawn.** The genuine geocoding-failure population. Rescuing them needs precision work on the gazetteer *measured before anything is written* — see the trap in [`03-lost-pet-engine.md`](03-lost-pet-engine.md) | `pipeline/parser.ts` |
| P2-2 | **No uptime monitor on `/health/deep`.** It exists and returns 503 correctly; nothing watches it | ops |
| P2-3 | **Redis has no uptime alert** and silently degrades everywhere. Also unconfirmed whether the current tier is persistent or another idle-reapable free database | `AUDIT_FINDINGS` §4.1 |
| P2-4 | **`spawnCooldown` fails open when Redis is down** → every 15s sync re-spawns, no cooldown, no claim lock. Global caps bound the on-screen count but not the write churn | `AUDIT_FINDINGS` §3.4 |
| P2-5 | **Public `/stats` leaks pipeline internals** — source breakdowns, post titles, skip reasons, dog ids, unauthenticated. `/admin/lost-dogs/scrape-log` returns nearly the same data *with* auth | `AUDIT_FINDINGS` §2.5 |
| P2-6 | **Open Telegram photo proxy**, unauthenticated and unthrottled. Any `file_id` the bot can resolve is fetchable, not just ingested ones. Bounded (ids are opaque and bot-scoped) but it is an open egress path under your bot token | `AUDIT_FINDINGS` §2.6 |
| P2-7 | **Untrusted scraped text reaches the companion's LLM context.** Rendered in RN `Text` so no XSS, but indirect prompt injection is possible. Worst case is the companion saying something off-script | `AUDIT_FINDINGS` §6.1 |
| P2-8 | **Opus chat is reachable by anonymous device-id users at 30/min.** The most direct cost-abuse lever in the app. No global spend cap on the Anthropic key | `AUDIT_FINDINGS` §6.2 |
| P2-9 | **Single machine, in-process crons, no leader election.** A second replica would double every cron and run 2×30 bots. A Redis leader lock is the one change that unblocks it | `AUDIT_FINDINGS` §3.3 |
| P2-10 | **`MapView.tsx` is 3,429 lines** — up from 2,665 at the audit. The highest-risk file in the repo, mixing map init, marker layout, territory render, multiplayer culling, supersniff and camera control | `AUDIT_FINDINGS` §5.3 |
| P2-11 | **Territory decay is undesigned.** Ground only ever ratchets upward. Deferred by the owner; the motive is real — with no decay a city eventually saturates | [`04-territory.md`](04-territory.md) |
| P2-12 | **Sync payload is ~215KB with every nearby owner drawn** (~52MB/hour on cellular). `rivalPiecesDrawn` is the dial | `config/balance.ts` |
| P2-13 | **Render flags are compile-time constants.** `GAME_RENDER` / `MULTIPLAYER` cannot be turned off without a rebuild and redeploy. The server has a `MULTIPLAYER=off` kill switch; the client cannot match it | `AUDIT_FINDINGS` §5.1 |
| P2-14 | **Perf and battery of the Three.js render on low-end Android is unmeasured.** WebGL2 fallback is handled well; the cost of the continuous fog repaint in the field is not known | `PILOT_ROADMAP` §5.6 |
| P2-15 | **CORS reflects any origin** (`origin: true`). Low risk — auth is header-based, so a malicious site has neither the device id nor the initData — but pinning is free | `AUDIT_FINDINGS` §2.7 |
| P2-16 | **`groundIn` takes 240 pieces with no `ORDER BY`.** Harmless at current fragmentation; will bite eventually | `services/territory.ts` |

## P3 — cleanup

| ID | Issue |
| --- | --- |
| P3-1 | **Large binaries committed to the repo** — `8-Bit Dogs.rar`, `SHUKAYPES_SVG_ICONS.zip`, `kalam.zip`, a 929KB HTML file, `reference/shukajpes-demo.html` (380KB), the product `.docx`. No build role. Best removed alongside the P0-4 history rewrite so there is only one force-push. |
| P3-2 | **Third-party pixel-art asset licensing unconfirmed.** The README claims free-for-commercial with no attribution required — verify and keep the license text in-repo before a public launch. |
| P3-3 | **Scrape tick history is in-memory only.** Gone on every restart. |
| P3-4 | **Stale schema comments.** `tokens` claims "PostGIS point added via raw SQL migration"; there is no PostGIS. `lost_dogs.source` says `scrape | in_app`; the column actually stores `olx`, `telegram:<channel>`, `admin-sideload`. |
| P3-5 | **`shared` types are duplicated at runtime.** The server never resolves the package and defines its own copies of the wire types, so a wire change has to be made twice. |
| P3-6 | **Territory mood gates are off** (`minHappiness: 0`, `minHunger: 0`). Restoring them to ~30/15 re-wires territory into the bones economy; the code that reads them is untouched. |

---

## Closed since the July audits

Kept so nobody re-files them.

| Was | Now |
| --- | --- |
| `AUDIT_FINDINGS` §5.2 — ESLint referenced but not installed or configured | ✅ Fixed by PR #274. Root `eslint.config.mjs`, `eslint-plugin-react-hooks`, `rules-of-hooks` as an **error**. Verified: 0 errors, 21 warnings. |
| `AUDIT_FINDINGS` §4.2 — `deploy.yml` does not gate on typecheck | ✅ Fixed for the server by PR #274 (`server` job `needs: checks`). Still open for the frontend — see P1-8. |
| `AUDIT_BRIEF` §10.4 — Redis idle-reap | ✅ Fixed by PR #265 (eager boot connect + status guards + log throttle). Uptime alerting still missing — P2-3. |
| `AUDIT_BRIEF` — "PostGIS is in use" | ✅ Corrected. There is no PostGIS and that is now a stated decision, not an oversight — see D-06. |
| `AUDIT_FINDINGS` §1.2 — Google Places called from the client | ✅ Fixed. `services/placesCache.ts` proxies and caches server-side. Only Routes is still called from the browser. |
| "Both Telegram sources are dead, nobody has looked at why" | ✅ Wrong on both counts. Corrected by PR #411 — one is the owner's test chats behaving as expected, the other has never been configured. |
| "Rotate `REPORT_TOKEN`" filed as top priority | ✅ Resolved by removing it (PR #408). A lesser key is only a boundary against a holder who lacks the greater one. |
| Silent scrape ticks | ✅ Fixed by PRs #402/#403. A tick that discovered items, ingested none and errored no longer logs as complete. |
| Out-of-city pets entering the table | ✅ Gate closed at parse time by PR #409, and 17 existing rows swept. Two ambiguous rows deliberately left alone. |
| Eleven-hour silent outage with no detection | ✅ `services/watchdog.ts`. Converts a silent permanent outage into a visible restart loop. |
| Territory leaderboard timing out and taking `/health` with it | ✅ Fixed by PR #363. It is a `GROUP BY` now. |
