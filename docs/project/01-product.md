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

The pilot audience has **not been decided**. `PILOT_ROADMAP.md` §4 lays out
the axes — founders-only vs a closed group of 20–100 vs an open soft launch;
Telegram-first vs web-first; real data vs synthetic; bots on or off; and
what "successful" would mean. That decision is still open and still blocks
sequencing. See [`08-open-issues.md`](08-open-issues.md).

## What is actually built

Legend: **✅ works** · **🟡 built, under-validated** · **🧪 live in prod
behind an always-on flag** · **⛔ not real yet**

### Frontend surface

| Area | State | Notes |
| --- | --- | --- |
| Map + GPS companion follow | ✅ | The core screen. `MapView.tsx`, 3,429 lines — the highest-risk file in the repo. |
| Paw / bone collect, hunger + happiness | ✅ | Decay and refill work. Collect distance is still bypassable by a client `force` flag. |
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
| Auth | 🟡 | Telegram initData is strong. `x-device-id` is unverified and spoofable. |
| Spawn / mapData / decay / cleanup crons | ✅ | All in-process on one machine. |
| Postgres (no PostGIS — hand-rolled haversine + bbox) | 🟡 | Deliberate, documented, and a scaling ceiling later. |
| Redis (presence, cooldowns, path anchor, lang) | ✅ | Eager-connects at boot; silent-degrades if down. No uptime alert. |
| Rate limiting | 🟡 | Applied to chat, admin and sightings only. Collect / feed / quests / poke / sync are unthrottled. |
| Ingest alerting | 🟡 | Built (`services/ingestAlert.ts`) but **dormant — `ALERT_CHAT_ID` is unset.** |
| CI gate | ✅ | `deploy.yml` gates the Fly deploy on typecheck + lint. Vercel is still ungated. |
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
