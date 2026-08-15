# 01 — The product

## What it is

**шукайпес** ("shukaypes" — "search-pets" in Ukrainian) is a Kyiv lost-pet
search network that presents itself as a walking game.

You walk your real city with a pixel-art companion dog on a stylised 3D
map. The dog follows your GPS, marks territory as you go, eats bones, picks
up paws, talks to you, and takes you on searches for pets that real people
have actually lost. The game mechanics are not decoration on the search —
they are the recruitment and retention layer for it. Somebody who walks
every day because their dog is fun to walk is a searcher who covers ground
every day.

Two surfaces: a **PWA** (browser or installed) and a **Telegram Mini App**.
One market: **Kyiv**.

- Web: `https://shukaypes.vercel.app`
- API: `https://shukajpes-api.fly.dev`

## The stakes

The lost-pet table is not test data. Rows in `lost_dogs` are real posts by
real owners, republished; rows in `sightings` are reports from people who
walked real streets and looked. This shapes everything downstream — data
changes get a dry run, reversible operations are preferred over destructive
ones, and a wrong pin is worse than no pin because it sends a searcher to
the wrong neighbourhood.

## The loops

### The walking loop (every session)

Walk → the dog follows → paws and bones spawn around you → you collect them
→ hunger and happiness move → the dog marks territory as you cover ground →
your ground grows and shows up on the standing.

This is the loop that produces *time spent walking*, which is the input the
search layer needs.

### The search loop (the point)

A lost pet is ingested from a public post → parsed into a structured record
with a location → surfaced to walkers near it → a walker enters
**supersniff**, picks a pet from the carousel, and the dog leads them along
a drawn route to the search zone → at the end the dog asks whether they saw
the pet → the answer is recorded and paid in paws.

Both answers count. "I walked the zone and it was empty" is worth 10 paws;
"I saw them" is worth 20 and writes a sighting that can move the pet's pin.
Negative information is information — a zone confirmed empty is a zone the
next walker does not need to cover.

### The territory loop (the reason to come back)

Every mark you lay claims the ground around it and cuts it out of any rival
who held it. Ground is permanent unless somebody walks in and takes it.
Holding ground pays passively: denser paws on your own streets, half-rate
happiness decay. There is a city-wide standing, and a raid notification when
someone takes a piece of yours.

See [`04-territory.md`](04-territory.md) for the full model.

### The companion loop (the texture)

The dog is a Claude agent, not a scripted chatbot. It talks in the chat tab
(Opus for active turns, Haiku for ambient), it has memory notes summarised
across sessions, it narrates quests, it comments on Kyiv landmarks you walk
past from a curated lore corpus, and it can act — routing you to a named
spot, starting a walk, reacting to a tap.

## Who it is for

Kyiv dog owners and dog people who already walk daily. The Telegram Mini App
path exists because that is where the Kyiv audience is and because it gives
a real signed identity for free.

The pilot question has been decided in shape if not in every detail: the
next step is a **closed beta of roughly 50–150 testers**, invite-gated, on
real data. A phased closed-beta plan drove the 12–14 Aug work, and its
Phase 1 — "safe to hand to a stranger" — is complete on the server side.
What remains before invites go out is the owner's checklist in
`HANDOFF.md` §0.2 (Maps key, flipping `INVITE_REQUIRED`, tokens for the
console and dev tools, a contact route, presence consent). See
[`08-open-issues.md`](08-open-issues.md).

## What is actually built

Legend: **✅ works** · **🟡 built, under-validated** · **🧪 live in prod
behind an always-on flag** · **⛔ not real yet**

### Frontend surface

| Area | State | Notes |
| --- | --- | --- |
| Map + GPS companion follow | ✅ | The core screen. `MapView.tsx`, 3,429 lines — the highest-risk file in the repo. |
| Paw / bone collect, hunger + happiness | ✅ | Decay and refill work. Collect distance is still bypassable by a client `force` flag — **the owner decided to keep tap-to-collect** while the animation is tuned, so beta collection counts will not prove anybody walked; `search_results` and distance still will. |
| Connection banner | ✅ | The app now tells the walker when it cannot reach the server. Failures were written to `lastSyncError` at 19 sites and read by none. |
| Error boundary | ✅ | A root boundary with a reload button — a render throw no longer unmounts into a blank white page. The only class component in the codebase, dependent on almost nothing by design. |
| **Territory marking, ground, standing, raids** | ✅ | The dominant mechanic since late July. Rebuilt three times; the current model is stable. |
| Companion chat (Claude agent) | ✅ | Opus active / Haiku ambient, 4-layer prompt, memory summarisation. |
| **Supersniff → search → sighting** | 🟡 | **The core.** End-to-end and coherent since PRs #393–#397. Never validated against a batch of real posts. |
| Quests / daily tasks / lore / spots | 🟡 | Present and wired. Content volume and tuning unvalidated at any real scale. |
| Game render (Three.js city, fog, sun, shadows) | 🧪 | `GAME_RENDER = true`. WebGL2-gated with a clean MapLibre fallback. Perf and battery on low-end Android still unmeasured. |
| Multiplayer presence + poke | 🧪 | `MULTIPLAYER = true`. 30 bots populate the map (`MULTIPLAYER_BOTS=30` in `fly.toml`). |
| Lost-pet pins on the main map | ⛔ | `LOST_DOG_PINS = false` — deliberately off. Pets are still fetched and still drive supersniff, the carousel and the cinematic pet view. |

### Backend / data

| Area | State | Notes |
| --- | --- | --- |
| Lost-pet ingestion | 🟡 | Hourly cron over OLX + Telegram + Facebook, plus real-time Telegram bot ingest. **OLX is currently blocked, Telegram is unconfigured, Facebook is parked.** See [`03-lost-pet-engine.md`](03-lost-pet-engine.md). |
| Territory service | ✅ | `services/territory.ts`, 1,021 lines. Grow/cut at mark time; syncs are box queries. |
| Auth | 🟡 | Telegram initData is strong. `x-device-id` is unverified and spoofable. An invite gate is built and dormant (`INVITE_REQUIRED` unset) — existing accounts can never be gated out. |
| Spawn / mapData / decay / cleanup crons | ✅ | All in-process on one machine. The lost-pet cleanup now runs at boot too — a bare 24h interval meant it had probably **never fired in production** (every deploy reset the timer). |
| Postgres (no PostGIS — hand-rolled haversine + bbox) | 🟡 | Deliberate, documented, and a scaling ceiling later. |
| Redis (presence, cooldowns, path anchor, lang, chat budget) | ✅ | Eager-connects at boot; silent-degrades if down. No uptime alert. |
| Rate limiting | ✅ | **Per-user and real since PR #417/#418.** It had been silently *global* — one bucket for the whole service behind Fly's proxy. Now 45 routes covered (named tiers), enforced by a CI fixture check. |
| LLM spend controls | ✅ | Per-user daily budget, global daily backstop, `CHAT_DISABLED` kill switch. Fails open on a Redis outage, loudly. |
| Client crash reporting | ✅ | Root `ErrorBoundary` + global handlers → `POST /client-errors`, self-hosted. There was none; four white-screen incidents were all found by humans noticing. |
| Search analytics | ✅ | `search_results` records **every** completed search, found or not (history starts 14 Aug 2026). |
| Admin console + metrics | ✅ | `/admin/console` (read-only, self-contained page) + `/admin/metrics` (`?format=text`). DAU/WAU/retention/funnel/spend, bots separated structurally. Needs `DASHBOARD_TOKEN` — **unset**, so it 401s for everyone today. |
| Takedown path | 🟡 | `expire:pet` CLI — the operator half. **No way for an owner to reach us yet** (no contact route anywhere). |
| Ingest alerting | 🟡 | Built (`services/ingestAlert.ts`) but **dormant — `ALERT_CHAT_ID` is unset.** |
| CI gate | ✅ | Fly deploy gated on typecheck + lint + `pnpm check` (7 fixture checks). **Vercel is gated too now** — its build command runs typecheck + lint first and fails on either. |
| Watchdog | ✅ | Dead-man's switch on the event loop, added after an 11-hour silent outage. |

## The imbalance, stated plainly

`PILOT_ROADMAP.md` made this point in July about the render and multiplayer
work, and it is worth restating because it happened again with territory:
**the last several months of engineering went into atmosphere and the
territory game, not into the find-a-pet loop.**

PRs #254–#276 were the render. #286–#327 were the camera and search
presentation. #328–#392 — sixty-five PRs across nine days — were territory.
The lost-pet engine got sustained attention only at the very end, in
#393–#412, and what that attention found was that OLX had been silently
blocked, that 89 active pets were invisible on the map, and that 17 of them
were in other cities.

That is not an argument against the territory work, which is genuinely good
and is the retention mechanic the search layer needs. It is an argument that
the engine feeding the search layer has never had a validation pass, and
that a pilot on real data cannot start until it does.

**Update, 12–14 Aug:** the correction began. PRs #416–#430 were a
beta-readiness pass aimed squarely at the neglected half — the dedupe rule
measured and fixed (three of its four "duplicates" were different animals),
every completed search recorded, a takedown path, crash reporting, real
rate limits, spend ceilings, and the metrics that a beta will be judged by.
The two engine gaps that remain are the two that were open before: **no
ingestion source is currently producing pets, and parse accuracy on real
posts has never been measured.**
