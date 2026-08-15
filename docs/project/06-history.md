# 06 — How we got here

430 merged PRs between 20 April and 14 August 2026, on a repo built from a
single-file HTML prototype (`reference/shukajpes-demo.html`, still in-tree,
read-only). Almost all of them are one-idea PRs merged within minutes of
opening — the working rhythm is small change, preview URL, look at it, merge
or iterate.

This is the arc, the pivots, and what each era left behind.

---

## Era 1 — Phases 4 and 5: the product exists
**#1–#12 · 20–22 Apr · 3 days**

The repo arrives with Phases 1–3 already done (scaffold, map + companion
overlay, Postgres + Redis + server-authoritative state). These PRs finish
the two phases that make it a product rather than a toy.

- **#1** Phase 4: the Claude chat proxy and the companion's voice.
  **#4, #5** immediately expand the CORE prompt past the model's cache
  minimum so prompt caching actually engages.
- **#7–#12** Phase 5 in four slices: seed Kyiv lost dogs → the ingestion
  pipeline and admin sideload → the OLX scraper as the first automated
  source → lost dogs on the map.

By #12 the whole shape of the product is present: a companion, a map, and
real lost pets arriving from a real source.

## Era 2 — Making the map behave
**#13–#92 · 22–28 Apr · 6 days**

The longest stretch of pure iteration in the project. Clustering
(#16–#20, #26), the spiderify-on-tap that replaced it (#18), pets that roam
their zones instead of bobbing (#22, #27–#29, #34), keeping pets out of the
Dnipro (#23, #24), the token economy found by feel across a dozen PRs
(#56–#67), and the whole HUD/branding language (#30–#54).

**#14** widens the pipeline from dogs to cats — the type name `ParsedDog`
survives to this day because renaming it cascades through too many callers.

**#13** rejects rehoming posts at both filter stages, the first of many
passes at the hardest classification problem in the pipeline: an adoption ad
and a lost-pet ad look almost identical.

Detective quests land as a four-part series (#71–#75), including Claude
narration on start / waypoint / complete and a real walking route through
waypoints from the Directions API.

**Sources widen:** Telegram via the public web preview (#78, env-gated from
day one), Facebook via an rsshub bridge (#79, #84) and then via `mbasic`
with saved cookies (#85). **#80, #83** add `/stats` and in-memory tick
history to diagnose silent sources — the first admission that a source can
fail without saying so.

## Era 3 — The companion becomes a character
**#93–#212 · 28 Apr – 5 May · 8 days**

Pixel-art sprites replace the glowing orb (#155), the dog runs when hunting
and sniffs on collect (#156, #157), and the profile tab grows a whole live
scene — a walking dog on parallax pixel ground with clouds, birds, trees, a
day/night cycle and tap reactions (#165–#183). Icons go through a full
redesign cycle: pixel SVG → hand-drawn → traced PNG → tight viewBoxes
(#191–#208).

PWA plumbing lands (#154, #158), daily-task progress is promoted from
localStorage to the server (#161), and a tech-debt sweep (#159) introduces
the bulk `/sync/map` endpoint that four separate calls used to do.

**Three Rules-of-Hooks crashes ship to prod in this era** (#124, #136,
#212) — all fixed within minutes, and all of them the reason PR #274 later
made `rules-of-hooks` a CI error.

## Era 4 — Sniff mode, and the crayon map
**#213–#253 · 5 May – 2 Jun · 4 weeks**

"Sniff mode" is a logo-toggled awareness view: dark map, inverted markers,
off-screen lost-pet edge chips that point at pets beyond the viewport. It
takes about twenty PRs to build and tune (#214–#240).

**The pivot:** #242–#253 rebuild the map itself. Google Maps → MapLibre with
OpenFreeMap vector tiles and a hand-written "crayon" style — B&W base, only
parks and water painted, hand-drawn routes via rough.js. #251 ships it at
`/preview` as a judge call before #253 makes it the map.

Then a **month of silence** — the longest gap in the project.

## Era 5 — The game render and multiplayer
**#254–#276 · 1–4 Jul · 4 days**

Two systems in four days.

**The render** (#254–#259, #269–#276): Three.js extruded buildings with true
per-distance volumetric fog, a warm off-screen sun with god rays, a daylight
cycle, building avoidance for markers, and gradient ground shadows. WebGL2-
gated with a clean fallback to MapLibre buildings + screen fog.

**Multiplayer** (#260–#266): Redis GEO presence, bot walkers, poke with
haptics, an 8km radius. **#261 is a hotfix for a white-screen crash** — a
Rules-of-Hooks violation in the multiplayer PR, shipped and reverted within
eleven minutes.

**#265** is the Redis resilience PR: eager boot-connect, status guards,
throttled error logs, written after a free Upstash database was idle-reaped
for having nothing connecting to it.

**Then the audits.** #267 adds `AUDIT_BRIEF.md`, #274 stands up real ESLint
and gates the Fly deploy on typecheck + lint (the first genuine quality
gate), #275 adds `PILOT_ROADMAP.md`. `AUDIT_FINDINGS.md` lands alongside.

Their finding, in one sentence: *the game is genuinely playable and pretty,
the lost-pet product is built end-to-end but under-validated, and the pilot
is undefined.*

## Era 6 — Detective quests, sprites, and the dog-cam
**#277–#327 · 12–26 Jul · 2 weeks**

#277 overhauls detective quests into a local scent-trail through real
places. #278–#284 cycle through three sprite sets from the designer before
settling on no stroke at all.

**#286 starts the dog-cam** as a prototype on a deactivated button: a low,
close chase camera heading-locked to the dog's travel. Over the next forty
PRs it becomes **supersniff** — the app's second mode.

The problem it kept hitting is buildings. A low camera behind a dog in a
dense city looks at walls. #288, #292, #295, #317, #320, #321 are six
successive attempts at seeing through them: fog-tint, then real alpha, then
a stipple, then a smooth "invisibility orb", then always-on, then a
world-metre corridor along the camera-to-dog sight line. The last one is
what shipped.

**#290–#300 are the search flow's first real shape**: the dog leads you
along a drawn route to search spots, a swipeable lost-pet carousel replaces
the map pins, swipe previews a zone for free and tap commits the route.

**#322–#327** build the cinematic lost-pet view — a zone shot, a big photo
pin, an explore-style bottom card, in the sniff voice.

## Era 7 — Territory
**#328–#392 · 28 Jul – 6 Aug · 9 days · 65 PRs**

The largest single push in the project, and a genuine product pivot: the app
acquires a competitive spatial mechanic that did not exist in any spec or
roadmap.

It is built **three times**.

**Model 1 — the cell grid (#328–#332).** ~110m quantised cells with a
`strength` that decays 25/day on read, rendered as a heatmap so it reads as
scent rather than a boardgame. Marks at most one per 150s, never within
140m, gated on the dog's mood, costing hunger and paying happiness. Hangs
off `/collect/path` so it inherits the anti-cheat — a constraint that
survives every rebuild.

**Model 2 — the hull of your marks (#333–#362).** Real polygons instead of
rectangles. Territory is the shape between your dots, recomputed on every
read with rival overlaps subtracted at draw time. #338 retires the ownership
cells entirely: *marks are the only truth*.

This is the elegant version, and it spends thirty PRs failing. The failures
are instructive and all of the same kind: a shape derived from dots cannot
remember a bite taken out of it (#357 — a new mark hands over ground nowhere
near it; #356 — a dog stranded on ground it no longer holds; #359 — dogs
claiming territory in the Dnipro). And it is ruinously expensive: #349,
#351, #352, #353 are four consecutive performance PRs about a partition
computation that cost 2.47s of a 3.57s sync.

**Model 3 — stored ground (#363).** Ground lives in `territory_ground`; a
mark grows the owner's union and cuts every rival piece it covers, both once
at mark time. Two owners can never overlap. A loss is permanent. A sync
becomes two indexed queries and no geometry — 3.5s to under 20ms. The
partition cache, its cell grid, its single-flight guard, the event-loop
yielding, a kill switch and ten balance knobs all go in the same PR.

Then the tuning: local claims (#364), a cadence of 20s/40m instead of
150s/140m so borders follow the walk instead of spanning it (#365), the
standing moved into the quests tab (#366), zones with no borders at all
(#377), and a leaderboard that goes through six passes of visual design
(#374–#389).

**Territory is wiped from production five times** across this era — #358,
#362, #368, #372, and the truncate in #363 — each time because every claim
in the database had been made under a rule that no longer existed.

**#381** is the era's quiet lesson: the *old* sniff mode had been dead code
for weeks. `setSniffMode` was called from nowhere, so the flag was
permanently `false` and every branch behind it — the dark map, the inverted
markers, the 380-line edge-chip layout — was unreachable. 777 lines net
removed. It was found because a building tint gated on `sniffMode` in #379
never fired.

## Era 8 — Back to the pets
**#393–#412 · 10–11 Aug · 2 days**

After nine days of territory, attention returns to the search layer, and
what it finds is the reason this documentation exists.

**The product half (#393–#399):** supersniff asks whether you saw the pet
and **both answers count** (#393); the dog speaks through its own bubble,
the chosen pet stays on screen, and the reward is paid in paws rather than
points (#394); a running search looks like navigation (#397).

**The data half (#400–#412)** is a sequence of things that had been failing
silently:

| PR | What it found |
| --- | --- |
| #395, #409 | Pets from other cities were being ingested, and 17 were already in the table — nine of them **drawn on the map** |
| #400 | Three bugs in the lost-pet sweep, two of them silent |
| #401 | **89 of 261 active pets cannot be drawn** — they sit on the ungeocoded fallback pin |
| #402, #403 | A tick that discovered items, ingested none, and errored was logging as a *complete tick*. OLX had been 403'd off the internet and it looked healthy |
| #404 | Measured what the 89 actually are (56 medium, 33 urgent, 0 rehoming) |
| #405, #406 | The audit moved from SSH-only to an HTTP endpoint with a read-only key |
| #407 | A proxy seam for the blocked scraper, plus the first written handoff |
| #408 | The report token retired rather than rotated |
| #411 | "Both Telegram sources are dead" was **wrong** — one is the owner's test chats, the other has simply never been configured |
| #412 | Something finally says so when pets stop arriving |

## Era 9 — The beta-readiness pass
**#413–#430 · 11–14 Aug · 4 days**

The pilot question finally acquires a shape — a **closed beta of 50–150
strangers** — and a phased plan behind it. This era is Phase 1 of that
plan ("safe to hand to a stranger") plus the first pieces of its metrics
and trust phases. It also produced this documentation set (#414).

The recurring silence pattern doesn't just continue — it escalates to
things that had *passed review*:

| PR | What it found |
| --- | --- |
| #416 | Dedupe was **over-merging, not under-merging**: three of the four pairs the rule called duplicates were different animals. The planned fix (widen the search) was inverted by measuring first. And the fixture checks that would have guarded the rule existed — **nothing ran them**. `pnpm check` enters CI. |
| #417 | Rate limiting was **inverted, not loose** — the keyGenerator ran before auth set `userId`, so every key fell to the proxy's IP: one bucket for the whole service. "Reads completely correct in review." Same PR: `/stats` was serving private Telegram DMs unauthenticated; one crafted Places request could cost ~$30; LLM spend had no ceiling; and the open device-id door got an invite gate, shipped dormant. |
| #419 | No error boundary, no `onerror`, no `unhandledrejection` — all four white-screen incidents on record were found by a human noticing. Crash reporting, self-hosted. |
| #420 | `?sim=1`, `?terrReset=1`, `?terrRaid=1` and `/preview` shipped in the public build. Gated behind `/dev` + a server-checked password. |
| #421 | "Zone walked, nothing there" — the majority search outcome — had never been written anywhere but a log line, so "how many searches were completed" was uncomputable. `search_results` starts recording 14 Aug. |
| #422 | The data-cost blame was measured and moved: the roadmap accused the rival dials and the `/state` poll; the real cost was the **pets list at 49.3% of every sync**, re-sent byte-for-byte every 15s. Fingerprinted, `/state` de-duplicated, hidden-tab pause: −49.5%. |
| #424 | A takedown tool for when an owner asks — the obligation that comes with republishing people's posts. The contact route for them to ask through still doesn't exist. |
| #425 | Three things that quietly never ran: the lost-pet cleanup cron (no boot run — a deploy-per-day cadence meant it likely **never fired in production**), two quest effects (dead on the cold-start path for a quest's whole duration), and the Vercel build shipping without a typecheck. |
| #427, #428 | `/admin/metrics` + the console — DAU, retention, funnel, spend, bots excluded structurally "because these numbers are going into a fundraise". Plus a regression from the same session: `setErrorHandler` had been turning every 401/403 into a 500, which would have silently broken the invite-gate door screen the moment it was turned on. |

Era 9's own lesson, stated in #416's body: *the checks existed and nothing
ran them.* The era's answer was to wire every fixture check into CI and to
grow the habit of measuring before building — the dedupe fix, the data-cost
fix and the chat-budget sizing all started with a measurement that
contradicted the plan.

---

## The pivots, in one list

| # | Pivot | When | From → to |
| --- | --- | --- | --- |
| 1 | **Dogs → pets** | #14, 22 Apr | Dogs only → dogs and cats. The `ParsedDog` type name is the fossil. |
| 2 | **Google Maps → MapLibre** | #253, 2 Jun | A renderer you cannot repaint → a vector style you can. |
| 3 | **Flat map → game render** | #254, 1 Jul | MapLibre extrusions → Three.js city with true volumetric fog. |
| 4 | **Single-player → multiplayer** | #260, 1 Jul | Alone → presence, bots and pokes on a polled Redis GEO set. |
| 5 | **Map pins → supersniff** | #286–#327, Jul | Discovering pets by scanning a map → meeting them through the companion and a carousel. `LOST_DOG_PINS = false`. |
| 6 | **No territory → territory** | #328, 28 Jul | A walking game with collectibles → a competitive spatial game. |
| 7 | **Grid → hull → stored ground** | #328 → #338 → #363 | Three ownership models in seven days. |
| 8 | **Global claims → local claims** | #364, 3 Aug | Every mark re-claiming everywhere the dog ever walked → a claim covering the ground around the mark that made it. |
| 9 | **Points → paws** | #394, 10 Aug | An abstract score → the currency people already pick up off the pavement. |
| 10 | **Seeded pets → real pets only** | `index.ts` | Boot-seeding removed; production runs on scraped posts. |
| 11 | **Undefined pilot → closed beta** | #416–#430, Aug | "What is the pilot" answered in shape: 50–150 invite-gated strangers on real data, with a phased readiness plan driving the work. |

## What the history is trying to tell you

Three things show up repeatedly enough to be structural rather than
incidental.

**Silence is the recurring failure mode.** A source 403'd off the internet
logging as a complete tick. A sniff mode nobody could enter, kept for weeks.
Eighty-nine pets that were active, correct and invisible. A filter audited
through the filter it was testing. A rate limiter whose per-user keys all
fell to one shared bucket while reading completely correct in review. A
cleanup cron that likely never fired because every deploy reset its timer.
Fixture checks that existed while nothing ran them. The pattern is always
the same: the system had no way to say that nothing had happened, so
nothing looked like fine.

**Reasoning was repeatedly beaten by counting.** "0 pets on the fallback
pin." "The 89 are probably rehoming ads." "OLX ingestion is dead." "~25% of
pets have no permalink." "The gazetteer resolves none of the 88 titles."
Every one was confidently wrong, and every one was a single query away from
being right. `CLAUDE.md` now leads with this and `HANDOFF.md` §5 is a
standing list.

**Atmosphere outcompetes the core loop for attention.** The render, the
camera, the fog, the leaderboard's six design passes and sixty-five
territory PRs are all real work that made the app distinctive. But the
engine that feeds the actual product — a lost pet reaching a walker who is
near it — has still never had a validation pass on real posts, and the last
time anyone looked closely, a third of the table was undrawable and the
primary source had silently lost half its coverage to a WAF (first
reported as fully dead — "too strong", twice, per the handoff's own
corrections). Era 9 bent this curve — the beta-readiness pass was aimed at
exactly the neglected half — but the two oldest engine gaps (degraded
sources, unmeasured parse accuracy) survived it.
