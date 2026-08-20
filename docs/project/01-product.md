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

## The front door

Until 20 Aug the app opened straight onto the map with a six-verb radial
menu (`search / walk / visit / meet / chat / about`) and nothing anywhere
saying what it was for. **Now the dog asks first** — «нюх-нюх! шо ти?» —
and the answer picks a mode. Four intents at the top level:

| | |
| --- | --- |
| **загубив друга** | I've lost a pet → an honest sheet pointing at the Telegram group (the in-app report form is a later piece) |
| **я шукайпес!** | I want to help search → supersniff |
| **хочу погуляти** | I just want a walk → the old verbs, one level down |
| **хто тримає цей район?** | Who holds this district? → the territory lens |

The corner logo became a **mode switch**, rotating explore → district →
supersniff, and it is the first thing the dog points at once the screen
goes idle. Every menu level speaks its own line, so the icons stopped being
a guessing game.

This matters beyond navigation: it is the first version of the app that
*explains itself* to somebody who arrives knowing nothing — which is the
condition every beta tester will be in.

## The loops

### The walking loop (every session)

Walk → the dog follows → paws and bones spawn around you → you collect them
→ hunger and happiness move → the dog marks territory as you cover ground →
your ground grows and shows up on the standing.

This is the loop that produces *time spent walking*, which is the input the
search layer needs.

**A planned walk is a small local tour, not an errand.** Ask the dog to go
for a walk and it picks a destination — a park, square, museum or landmark
— and routes you *through* two to four Kyiv landmarks on the way, each with
a sentence of story the dog tells when you tap its numbered disc. The
destination pool deliberately excludes businesses: cafés, vets and pet
shops were live walk destinations until PR #493, which meant "take me for a
walk" could answer with the vet. Going somewhere named is a different
mechanic with its own three entry points.

Both halves now run **without Google**. Destinations come from our own
tables (307 parks and 82 squares in the gazetteer, plus museums, churches
and attractions in the lore corpus); with the Routes key off the line is
drawn dashed and straight between the walk's own points, keeping the stops.
A solid line would claim knowledge of streets we do not have. Before this,
a missing Places key meant the radial menu answered "sniffing out spots…"
forever — a core loop hostage to a billing account.

### The search loop (the point)

A lost pet is ingested from a public post → parsed into a structured record
with a location → surfaced to walkers near it → a walker enters
**supersniff**, picks a pet from the carousel, and the dog leads them along
a drawn route to the search zone → **mid-search they can read the owner's
actual ad** («читати оголошення»), which is what answers "is this the dog?"
— red collar, scared of men, answers to Мухтар → at the end the dog asks
whether they saw the pet → the answer is recorded and paid in paws.

Both answers count. "I walked the zone and it was empty" is worth 10 paws;
"I saw them" is worth 20 and writes a sighting that can move the pet's pin.
Negative information is information — a zone confirmed empty is a zone the
next walker does not need to cover.

**Contact details are gated behind the sighting.** During the search the ad
body is shown with phones, e-mails and handles replaced; report a sighting
and the phone appears. The link to the original post is gated the same way,
because a mask you can walk around with one tap is decoration. The effect
is that an owner's phone rings when somebody has actually seen their
animal, rather than every time a stranger opens a pin.

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
| Map + GPS companion follow | ✅ | The core screen. `MapView.tsx` — the highest-risk file in the repo. |
| **Mode switcher front door** | ✅ | The dog asks what you're here for; the logo rotates explore → district → supersniff. Replaced the six-verb radial menu (PR #494). |
| **Read the owner's ad in-app** | ✅ | `PostModal.tsx` — the real ad text mid-search, contacts and the OLX link both gated behind reporting a sighting. |
| **Landmark walks** | ✅ | A walk routes *through* 2–4 lore landmarks with tappable stories; needs no Google for either destinations or the line. |
| Paw / bone collect, hunger + happiness | ✅ | Decay and refill work. Collect distance is still bypassable by a client `force` flag — **the owner decided to keep tap-to-collect** while the animation is tuned, so beta collection counts will not prove anybody walked; `search_results` and distance still will. |
| Connection banner | ✅ | The app now tells the walker when it cannot reach the server. Failures were written to `lastSyncError` at 19 sites and read by none. |
| Error boundary | ✅ | A root boundary with a reload button — a render throw no longer unmounts into a blank white page. The only class component in the codebase, dependent on almost nothing by design. |
| **Territory marking, ground, standing, raids** | ✅ | The dominant mechanic since late July. Rebuilt three times; the model is stable and the render was reworked into a soft "scent field" in August. |
| Companion chat (Claude agent) | ✅ | Opus active / Haiku ambient, 4-layer prompt, memory summarisation. |
| **Supersniff → search → sighting** | 🟡 | **The core.** End-to-end and coherent since PRs #393–#397. Never validated against a batch of real posts. |
| Quests / daily tasks / lore / spots | 🟡 | Present and wired. Content volume and tuning unvalidated at any real scale. |
| Game render (Three.js city, fog, sun, shadows) | 🧪 | `GAME_RENDER = true`. WebGL2-gated with a clean MapLibre fallback. Perf and battery on low-end Android still unmeasured. |
| Multiplayer presence + poke | 🧪 | `MULTIPLAYER = true`. 30 bots populate the map (`MULTIPLAYER_BOTS=30` in `fly.toml`). |
| Lost-pet pins on the main map | ⛔ | `LOST_DOG_PINS = false` — deliberately off. Pets are still fetched and still drive supersniff, the carousel and the cinematic pet view. |

### Backend / data

| Area | State | Notes |
| --- | --- | --- |
| Lost-pet ingestion | 🟡 | Hourly cron over OLX + Telegram + Facebook, plus real-time Telegram bot ingest. **OLX was never blocked** — the 403s were a coin flip a retry fixes, and a separate saturation bug (relevance-ordered page one) was why nothing new arrived. Both fixed. Telegram unconfigured, Facebook parked. See [`03-lost-pet-engine.md`](03-lost-pet-engine.md). |
| Ad bodies + contact gating | ✅ | The real ad text stored and served one pet at a time; contacts redacted until a sighting is reported, enforced by a source-level fixture check. |
| Territory service | ✅ | `services/territory.ts`. Grow/cut at mark time; syncs are box queries. Render reworked into a soft scent field (`territoryHeatLayer.ts`) with the flat fill kept as a fallback. |
| Auth | 🟡 | Telegram initData is strong. `x-device-id` is unverified and spoofable. An invite gate is built and dormant (`INVITE_REQUIRED` unset) — existing accounts can never be gated out. |
| Spawn / mapData / decay / cleanup crons | ✅ | All in-process on one machine. The lost-pet cleanup now runs at boot too — a bare 24h interval meant it had probably **never fired in production** (every deploy reset the timer). |
| Walk destinations + landmark routing | ✅ | `/walk/destinations` and `POST /lore/route`, both served from our own tables. Google is optional for the whole walk loop. |
| Postgres (no PostGIS — hand-rolled haversine + bbox) | 🟡 | Deliberate, documented, and a scaling ceiling later. |
| Redis (presence, cooldowns, path anchor, lang, chat budget) | ✅ | Eager-connects at boot; silent-degrades if down. No uptime alert. |
| Rate limiting | ✅ | **Per-user and real since PR #417/#418.** It had been silently *global* — one bucket for the whole service behind Fly's proxy. Now 48 routes covered (45 limited, 3 knowingly exempt), enforced by a CI fixture check. |
| LLM spend controls | ✅ | Per-user daily budget, global daily backstop, `CHAT_DISABLED` kill switch. Fails open on a Redis outage, loudly. |
| Client crash reporting | ✅ | Root `ErrorBoundary` + global handlers → `POST /client-errors`, self-hosted. There was none; four white-screen incidents were all found by humans noticing. |
| Search analytics | ✅ | `search_results` records **every** completed search, found or not (history starts 14 Aug 2026). |
| Admin console + metrics | ✅ | `/admin/console` (read-only, self-contained page) + `/admin/metrics` (`?format=text`). DAU/WAU/retention/funnel/spend, bots separated structurally. Needs `DASHBOARD_TOKEN` — **unset**, so it 401s for everyone today. |
| Takedown path | 🟡 | `expire:pet` CLI — the operator half. **No way for an owner to reach us yet** (no contact route anywhere). |
| Ingest alerting | 🟡 | Built (`services/ingestAlert.ts`) but **dormant — `ALERT_CHAT_ID` is unset.** |
| CI gate | ✅ | Fly deploy gated on typecheck + lint + `pnpm check` — now **12 fixture checks**. Vercel is gated too; its build command runs typecheck + lint first and fails on either. |
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

**Update, 12–20 Aug: the correction happened.** Two weeks of work went
almost entirely into the neglected half.

PRs #416–#430 were the beta-readiness pass — the dedupe rule measured and
fixed (three of its four "duplicates" were different animals), every
completed search recorded, a takedown path, crash reporting, real rate
limits, spend ceilings, the metrics a beta will be judged by.

PRs #448–#492 then went at the engine itself and found that **the story
about OLX had been wrong the whole time**: not blocked, just refusing every
second request, with a retry sitting disabled in the code that fixed it.
And underneath that, a saturation bug — page one ordered by relevance meant
the scraper had literally run out of new ads to see. Both fixed. Then the
corpus was checked against reality for the first time (221 active → 78,
with a deleted ad taken as the best available found-signal), ad bodies were
stored and served, and contacts were gated behind a sighting.

**What remains is one gap, and it is the oldest one: parse accuracy on real
posts has never been measured.** Everything needed to measure it now exists
— the ad text is stored, and `/admin/metrics` is one secret away from
readable.
