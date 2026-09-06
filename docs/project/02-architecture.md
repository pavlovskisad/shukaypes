# 02 — Architecture

Current as of `4c7459a`, 25 Aug 2026. Where this disagrees with the code,
the code is right.

## Repo layout

pnpm monorepo, three workspaces (`pnpm-workspace.yaml`).

```
app/          Expo RN app (web-first). Expo Router. ~28,700 lines TS/TSX.
server/       Fastify API. ~23,100 lines TS.
shared/       TypeScript types only (145 lines). No build step.
docs/         Documentation. docs/project/ is this set.
reference/    The original single-file HTML prototype. Read-only history.
```

`shared` is types-only and the server **does not resolve it at runtime** —
it maps the alias in tsconfig for typechecking and defines its own copies of
the wire types where it needs them. This is deliberate (no build step for
`shared`), and it means a wire-shape change has to be made in two places.

Root also carries several large committed binaries (`8-Bit Dogs.rar`,
`SHUKAYPES_SVG_ICONS.zip`, `kalam.zip`, a 929KB HTML file, the 380KB demo).
They have no build role. See [`08-open-issues.md`](08-open-issues.md).

## Runtime topology

```
Browser / Telegram Mini App  (app bundle, Vercel CDN)
   │  HTTPS. Identity: x-device-id  OR  x-telegram-init-data
   ▼
Fastify API  (one Fly machine: shared-cpu-1x / 512MB, fra, min 1)
   ├── Postgres            Supabase. Durable state. No PostGIS.
   ├── Redis               presence GEO, spawn cooldowns, path anchor, lang cache
   ├── Anthropic API       companion chat, lost-pet parsing, lore, quest narration
   ├── Google Maps         Places (server-proxied + cached) / Routes (client-side)
   │                        Both now OPTIONAL — walks fall back to our own tables
   └── Telegram Bot API    Mini App auth, webhook ingest, photo proxy
Map tiles: OpenFreeMap "liberty", heavily overridden. Glyphs self-hosted.
```

Everything runs in one process on one machine. All crons are `setInterval`
in-process. `min_machines_running = 1` exists specifically so the crons keep
ticking.

## The two hot paths

### `GET /sync/map` — every 15s

One round trip returns everything the map needs. Ordering matters and is
commented in the source:

1. **Territory first, alone.** `fetchMapTerritory` — one box query for
   marks, your shapes, rivals' shapes, rivals' recent marks, and the
   `home` flag. It has to land first because the spawn top-up branches on
   `home` (paws are denser on ground you hold).
2. **Writes next, in parallel.** `ensureTokensForUser`,
   `ensureFoodForUser`, `noteHomeGround`. Idempotent top-ups; they must
   complete before the reads or freshly-spawned rows would miss the
   response.
3. **Reads in parallel.** tokens, food, lost dogs, user state, presence
   (if `mp=1`), pokes, raids.

Response carries: `tokens`, `food`, `dogs`, `state`, `players`, `pokes`,
`marks`, `shapes`, `rivalMarks`, `rivals`, `home`, `raids`.

Area held is deliberately **not** in this payload — `/territory/leaderboard`
owns that number, because two places computing it is how they drift.

**The pets list is conditional since PR #422.** Measured against a database
seeded to production's shape, `dogs` was **49.3%** of every response —
29.3KB re-sent byte-for-byte every 15s for a list OLX changes ~17 times a
*week*. The server now fingerprints the list, the client echoes the tag
back, and an unchanged list returns as `dogs: null` — *keep what you have*.
Null rather than an omitted key, because an empty list is a real answer
("no pets near you") and the two must never be confusable. A client that
sends no tag gets the full list as before. Two companion changes in the
same PR: `/state` is no longer polled on the map tab (it duplicated the
`state` object in this payload byte-for-byte, 720 requests/hour), and
neither loop runs while the tab is hidden. Net: **54.2KB → 27.4KB steady
state (−49.5%), ~13 → ~6.6 MB/hour on a walk, zero when backgrounded.**

### `GET /presence` — every 3s

Split out of `/sync/map` in PR #351. Positions only: one Redis GEO read, no
Postgres, no territory, no partition.

The reasoning, measured on prod: other dogs' positions were 3.7KB of a
66.4KB payload (6%), while the territory in the other 94% only changes every
few minutes — and the partition behind it cost 2.47s of a 3.57s sync.
Polling the whole thing fast enough to make the dogs move smoothly would
have meant ~80MB/hour of mobile data and five times the query load, to
refresh polygons that had not moved.

3s is the floor that matters, and it is set by the simulation rather than
the transport: bots step on a 3.5s server tick and real GPS lands about once
a second.

### `POST /collect/path` — the movement-verified position

Not a read path, but the third pillar. It owns the previous position anchor
in Redis, rejects teleports, sweeps up paws and bones along a backgrounded
walk, and — since PR #328 — is where the dog decides whether to mark
territory. Hanging territory off this endpoint means the mechanic inherits
its anti-cheat: you cannot claim ground you did not walk to any more than
you can farm paws you did not walk to.

## Frontend (`app/`)

**Framework.** Expo (SDK ~52) + Expo Router + React Native Web, bundled by
Metro into a **single** web bundle (`app.json` → `web.output: "single"`).
This is why `three` cannot be code-split.

**Screens.** `app/app/(tabs)/`:

| Route | File | Lines | Role |
| --- | --- | --- | --- |
| `index` | `index.tsx` | 218 | The map. The core screen. |
| `tasks` | `tasks.tsx` | 881 | Quests, daily tasks, and the territory standing. |
| `chat` | `chat.tsx` | 714 | Talk to the dog. |
| `spots` | `spots.tsx` | 311 | Partner / POI spots from Places. |
| `profile` | `profile.tsx` | 569 | Stats, XP, and a live pixel-art dog scene. |

Floating tab bar in `_layout.tsx`.

**State.** Zustand, one large store: `stores/gameStore.ts` — map data,
companion stats, quests, spots, territory, multiplayer, dog-cam, walk
stops, the menu/mode state, daylight. `stores/langStore.ts` for language (uk / en, `i18n/strings.ts`).

**Map.** `components/map/MapView.tsx` (~3,900 lines) is the nerve centre.
MapLibre GL JS v5 with a heavily-overridden "crayon" style
(`crayonStyle.ts`, 780 lines, based on OpenFreeMap liberty). Markers are DOM
overlays via `MapLibreMarker.tsx` — companion, user dot, paws, bones, spots,
other walkers, lost-dog pins and clusters.

**Render stack**, in draw order:

- `groundFogLayer.ts` — ground/sky fog with an off-screen warm sun and god
  rays, plus a custom ground layer under the city.
- `territoryHeatLayer.ts` — territory drawn as a soft "scent field" rather
  than hard polygons: the server's shapes triangulated (`earcut`) into a
  quarter-resolution buffer, blurred by a separable gaussian whose radius
  tracks zoom so the soft edge stays a roughly constant ~22 **metres of
  ground**, then re-thresholded so borders stay exactly where the server
  put them. Two owners' ground crossfades through a gradient where they
  meet instead of butting at a hairline. `TerritoryLayer.tsx` keeps the old
  flat fill as a fallback if the GL setup fails — territory never silently
  disappears.
- `WalkStops.tsx` — numbered discs for the landmarks a walk passes through.
- `threeBuildingsLayer.ts` (1,161 lines) — Three.js extruded buildings with
  true per-distance and per-height fog, a see-through corridor along the
  camera-to-dog sight line, and gradient ground shadows.
- `fogLayer.ts` — the classic screen fog, kept as the fallback.

All layers share fog parameters so ground and buildings dissolve together.
The Three path requires **WebGL2**; on any throw during init the code tears
down partial state and reverts to MapLibre buildings + screen fog
(`MapView.tsx`, the `GAME_RENDER` init block).

**Companion.** `Companion.tsx` (756 lines) + `DogSprite.tsx`, pixel-art
sprite sheets in `app/public/dog/`. Lerps toward GPS; runs when hunting an
item; sniffs on collect.

**Build note.** `app/babel.config.js` enables
`@babel/plugin-transform-class-static-block` so Metro can bundle `three`
(ES2022 static blocks). Removing it breaks the web build.

## Backend (`server/src/`)

**Entry** `index.ts` — builds Fastify, registers routes, arms the watchdog
*first*, warms the ground geometry worker, starts crons, eager-connects
Redis, registers the Telegram webhook, listens.

**Auth** `auth.ts` (Fastify `preHandler` plugin). Resolves `req.userId`
from, in order of preference:

1. `x-telegram-init-data` — validated against the bot token. Strong,
   cross-device, keyed on `telegram_id`.
2. `x-device-id` — any client-supplied string 8–128 chars. Weak,
   browser-scoped, **unverified**.

An **invite gate** sits in front of account creation (`lib/inviteGate.ts`,
PR #417): with `INVITE_REQUIRED` set, a *new* device id must redeem an
invite code (`x-invite-code`); an **existing account is never gated** —
~543 accounts have no email, no password, no recovery, so a code checked on
every request instead of only at signup would lock all of them out
permanently. That invariant is asserted exhaustively by `check:invites`.
The gate **ships dormant** — the flag is unset today. Both auth paths use
`onConflictDoNothing` + re-select, closing a first-launch race that 500'd
cold starts. Errors carry real statuses (401/403) — a `setErrorHandler`
regression that turned every auth failure into a 500 was found and fixed
in PR #428.

Bypasses (no identity required): `/health`, `/health/deep`, `/admin/*`
(own bearer), `/telegram/webhook` (own secret header), `/photos/*` (served
to bare `<img src>` tags that cannot carry headers), `/client-errors` (a
crash report must work for somebody whose crash *is* account creation
failing, and authenticating it would mint a `users` row for every visitor
who ever throws). `/stats` is **no longer open** — it was republishing
bot-ingested users' Telegram DMs and now requires a bearer.

**Rate limiting is per-user and real** (PRs #417/#418). It had been
silently global: the plugin installed at `onRequest`, `req.userId` is set
at `preHandler`, so every key fell through to `req.ip` — and behind Fly's
proxy with `trustProxy` unset, that was *one bucket for the whole
service*. Chat's "30/min" was thirty per minute for everybody at once.
Fixed with `hook: 'preHandler'` + `trustProxy`; 45 routes now carry named
tiers sized above the client's real cadence, and `check:route-coverage`
asks Fastify what it registered (rather than grepping) and fails CI if a
new route ships unlimited.

**Routes** (`routes/`):

| File | Endpoints |
| --- | --- |
| `syncMap.ts` | `/sync/map`, `/presence`, `/territory/reset`, `/territory/raid-test`, `/territory/leaderboard` |
| `path.ts` | `/collect/path` — movement-verified sweep + the territory mark hook |
| `tokens.ts` | `/tokens/nearby`, `/collect/token` |
| `food.ts` | `/food/nearby`, `/feed` |
| `dogs.ts` | `/dogs/nearby` |
| `sightings.ts` | `/sightings`, `/sightings/search-result` |
| `quests.ts` | `/quests/start`, `/quests/active`, `/quests/advance`, `/quests/abandon`, `/quests/history` |
| `chat.ts` | `/chat`, `/chat/ambient`, `/chat/history` |
| `state.ts`, `profile.ts`, `dailyTasks.ts`, `lore.ts`, `places.ts`, `stats.ts` | state, profile, `/tasks/tick`, lore, spots, stats (bearer-gated) |
| `poke.ts` | `/poke` |
| `photos.ts` | `/photos/:fileId` — Telegram photo proxy |
| `telegram.ts` | `/telegram/webhook` + Mini App plumbing (554 lines) |
| `admin.ts` | `/admin/lost-dogs/{ingest,scrape-now,scrape-log,report}` |
| `walkDestinations.ts` | `/walk/destinations` — where a walk can end, from our own tables merged with Places parks only. Removes Google as a hard dependency of the walk loop |
| `lore.ts` | `/lore/nearby` + **`POST /lore/route`** — takes several candidate walks and answers, for each, which landmarks it passes and what the walk looks like re-plotted through them |
| `dogs.ts` | `/dogs/nearby`, **`/dogs/:id/post`** (the owner's ad text, one pet at a time, contacts redacted unless a sighting exists), **`POST /dogs/report`** (an owner posts their own lost pet — structured fields, own photo, own pin, nothing guessed) |
| `adminMetrics.ts` | `/admin/metrics[?format=text]` — DAU/WAU/retention/funnel/token spend, bots separated. `DASHBOARD_TOKEN` or `ADMIN_TOKEN` |
| `adminConsole.ts` | `/admin/console` — the read-only console: one self-contained page, no build step, served by the API that owns the data. Opens via `?k=<token>` (stripped from the URL bar, redacted in logs) |
| `clientErrors.ts` | `POST /client-errors` — crash reports, auth-exempt, capped + deduped client-side |
| `dev.ts` | `/dev` unlock — checks a typed password against `DEV_TOOLS_PASSWORD` server-side; gates the walk simulator and the destructive territory test routes |

**Services** (`services/`), the ones that carry weight:

- `territory.ts` (1,021) — the whole mechanic. See [`04-territory.md`](04-territory.md).
- `ground.ts` / `groundGeometry.ts` / `groundWorker.ts` — polygon union,
  difference, simplification, and the worker thread they run in.
- `spawn.ts` + `spawnCooldown.ts` — paw/bone spawning and per-area Redis
  cooldown locks.
- `presence.ts` + `bots.ts` — multiplayer.
- `scrape.ts` + `pipeline/*` — lost-pet ingestion. See [`03-lost-pet-engine.md`](03-lost-pet-engine.md).
- `ingestAlert.ts` — says something when pets stop arriving.
- `watchdog.ts` — the dead-man's switch.
- `chatBudget.ts` — spend ceilings on the model calls a user can trigger:
  per-user daily (50 active turns), global daily backstop (1,000), ambient
  cap (300/user), all env-overridable, plus a `CHAT_DISABLED` kill switch
  that needs no deploy. Counters in Redis; **fails open** on a Redis outage,
  logged at error level — a silently-mute companion reads as "the app is
  broken", and the rate limits still stand in front of the spend.
- `metrics.ts` — every number the console shows, computed in one place with
  one renderer for JSON and text. Bots (`bot:N`) excluded structurally from
  every user-facing figure. Retention refuses to report a percentage below
  a cohort of ten.
- `invites.ts` + `lib/inviteGate.ts` — invite codes and the pure predicate
  that decides who needs one.
- `loreWalk.ts` — the landmark-walk geometry, pure and checkable: project
  every landmark in the bbox onto the planned line, keep what sits inside a
  **240m corridor**, cut the walk into equal stretches and take the best
  candidate in each, enforce spacing, then drop stops until the added
  walking fits a detour budget. Equal stretches rather than "the N closest
  to the line" is the difference between a walk that unfolds and a walk
  with three plaques in its first block — the dense old centre wins every
  slot otherwise. 25 fixture expectations in `check:lore-walk`.
- `pipeline/redactContacts.ts` — takes an owner's contacts out of an ad and
  nothing else. Errs toward keeping the description readable.
- `pipeline/resolvePlace.ts` — resolves the place the *owner wrote* against
  `kyiv_gazetteer`: addresses beat prose, specific beats broad, and silence
  beats guessing. Handles inflected Ukrainian forms and abbreviations. This
  is what the parser should have been consulting all along instead of ~41
  hardcoded landmarks.
- `pipeline/ownerReport.ts` — validates and assembles a first-party report.
- `services/crosspost.ts` — publishes a report to the channel and copies it
  to district groups. Ships dormant; sequential and spaced, each refusal a
  log line.
- `pipeline/sources/adHtml.ts` — pure HTML in, ad text out. Pure and
  db-free *on purpose*: it used to live in `olx.ts`, which imports the db
  module, so a check for it could not run without a `DATABASE_URL`.
- `anthropic.ts`, `memory*.ts`, `quest*.ts`, `gazetteer.ts`, `lostDogsReport.ts`,
  `placesCache.ts`, `decay.ts`, `lostDogCleanup.ts`, `searchZoneExpansion.ts`.

**Crons**, all `setInterval().unref()`, all in-process, all wrapped by
`cronUtils.runCronTick`:

| Cron | Cadence | Job |
| --- | --- | --- |
| decay | 8s | Hunger and happiness. Half rate on home ground. |
| scrape | 1h (jittered 30–120s after boot) | Run every ingestion source in sequence. |
| zone expansion | — | Grow a lost pet's search radius as time passes. |
| lost-dog cleanup | 24h, **and at boot** | Expire stale reports. The boot run matters: as a bare interval it needed a machine to live a full uninterrupted day to fire once, and with several deploys a day it had probably never run in production (fixed in PR #425). |
| multiplayer | 3.5s | Step + publish bot walkers, purge stale presence. |

There is **no leader election**. A second machine would double every cron
and run 2×30 bots. `services/scrape.ts` says so in a comment. This is the
single change that blocks horizontal scaling.

**DB** (`db/`): `schema.ts` (Drizzle), `index.ts`
(`postgres(url, { prepare: false })`, default pool ~10), `redis.ts`
(`ioredis`, `lazyConnect`, throttled error log), `migrate.ts` run at
container start. 38 migrations, latest `0037_placement_source.sql`.

**Migrations `0032`+ are hand-written, and that is a rule now:**
`migrations/meta` holds snapshots for 0000–0002 and nothing for 0003–0031,
so `drizzle-kit generate` emits the *entire schema* — including
non-idempotent `ADD COLUMN`s for columns that already exist — a file that
would have failed mid-migration against the live database during a deploy.
The `0032` snapshot repaired the baseline; until it is proven trustworthy,
new migrations are written by hand, additive, and verified against a real
local Postgres before merge.

## Data model

Postgres. **No PostGIS** — this is deliberate and is stated in two migration
comments. Proximity is either hand-rolled haversine in SQL or, for
territory, a bbox range scan on plain B-trees.

| Table | Holds |
| --- | --- |
| `users` | Identity, points, totals, home coords, Telegram profile fields |
| `companion_state` | 1:1 with users. Hunger, happiness, level, XP, memory notes, last-mark position/time, `on_home_ground` |
| `tokens` | Paws — position, owner, spawn/collect timestamps |
| `food_items` | Bones — same shape |
| `lost_dogs` | The search layer. Species, breed, emoji, photo, last-seen point + time + description, urgency, search radius, source, status |
| `sightings` | User reports against a lost dog |
| `messages` | Full chat history with per-message token accounting |
| `collect_events` | Anti-cheat audit trail |
| `quests` + `StoredWaypoint[]` jsonb | Detective quest state |
| `daily_tasks` | Per user per local calendar day |
| `scrape_log` | One row per URL ever seen — the dedupe key and the ingest heartbeat |
| `kyiv_lore` | Curated geo-indexed landmark stories (OSM + Wikidata, rewritten by Sonnet). `story` is the one-liner; `detail` (2–4 sentences) and the Wikipedia handle behind "read more" are filled by `enrich:lore`, with `wiki_source` saying whether the handle came from the OSM tag, a Wikidata sitelink, or a name-matched geosearch |
| `kyiv_gazetteer` | ~16k Kyiv place names from OSM, for parser geocoding. Trigram fuzzy match |
| `places_cache` | Google Places results keyed by (cell, category). Since PR #417 the request side is bounded too: radius clamped to 2000m, coordinates must fall inside the Greater Kyiv bbox (a finite ~3,600-cell cache domain), and cell fan-out is capped — one crafted request could previously fan out to 935 Google calls (~$30) |
| `territory_marks` | Individual marks — where the dog has been |
| `territory_ground` | **The ownership record.** One row per piece: ring + holes + bbox + area |
| `territory_raids` | "Somebody took your ground" — queued in Postgres so an overnight raid still lands |
| `invite_codes` | Beta invite codes, minted by the `invite` CLI (migration `0032`) |
| `search_results` | **Every** completed search — found or not — with the paws paid. Separate from `sightings` on purpose: a sighting asserts *the pet was here* and drives pin-moving; a search result may assert nothing. History starts 14 Aug 2026 (migration `0033`) |
| `scrape_log.raw_body` | The ad text the parser actually read (migration `0034`). Served only by `/dogs/:id/post`, never in a bulk payload — enforced by a source-level fixture check |
| `lost_dogs.is_found_report` | Somebody *has* this animal and is looking for its owner (migration `0035`). Kept in the table rather than filtered at ingest so these can get their own screen later; the map query simply does not return them |
| `lost_dogs.ad_alive_at` | When we last confirmed the owner's ad is still up (migration `0036`). Age is a proxy for "is this pet still lost"; a live ad is evidence, and the staleness sweep defers to it |
| `lost_dogs.placement_source` | **How the pin got its coordinates** (migration `0037`) — `owner`, `gazetteer-marked:<name>`, `model-landmark:<name>`, `fall-through`, `sighting`. The ledger that makes placement quality answerable with a `GROUP BY` instead of an inference |

Indexes are plain B-trees: `tokens(owner_id)`, `tokens(collected_at)`,
`food_items(owner_id)`, `lost_dogs(status)`, `messages(user_id, created_at)`,
`quests(user_id, status)`, `scrape_log(source, first_seen_at)`,
`territory_marks(user_id, created_at)`, `territory_marks(lat, lng)`,
`territory_ground(user_id)`, `territory_ground(min_lat, max_lat, min_lng, max_lng)`,
`kyiv_lore(lat, lng)`, `kyiv_gazetteer(search_key)` + category.

There is **no geo index on `lost_dogs`**. `fetchNearbyLostDogs` filters
`status='active'` and then computes haversine over every survivor, on every
`/sync/map`, per user, every 15s.

## Multiplayer

Polling, not WebSockets — deliberate. It fits the existing sync cadence,
needs no stateful connections on Fly, and latency is irrelevant for a
walking game.

- **Presence** (`services/presence.ts`): each `/presence` or `mp=1`
  `/sync/map` writes the caller's **jittered** position into a Redis GEO
  set (`mp:pos`), a `seen` ZSET with a 45s TTL, and an `mp:meta` hash
  (name / photo / bot). Then `GEOSEARCH` within **8km**. Jitter is a stable
  per-id offset of ≤25m derived from an FNV hash, so averaging many reads
  does not de-jitter it. Every call guards on `redis.status === 'ready'`.
- **Bots** (`services/bots.ts`, 463 lines): `MULTIPLAYER_BOTS` (30 in
  `fly.toml`) simulated walkers on a state machine — roam, dwell at
  hardcoded hotspots, go offline and back. They write to the same presence
  set as real players and they mark territory on the same cadence rule, so
  they render and compete identically.
- **Poke** (`routes/poke.ts`): tap another walker → queued in Redis →
  delivered on their next sync → toast + haptic + camera fly-to. Cannot
  poke yourself or a bot.
- **Kill switches**: server honours `MULTIPLAYER=off`; the client flag
  `MULTIPLAYER` in `constants/experiments.ts` is compile-time and needs a
  rebuild.

## Configuration and flags

**Client flags** — `app/constants/experiments.ts`, all compile-time
constants:

| Flag | Value | Meaning |
| --- | --- | --- |
| `GAME_RENDER` | `true` | Three.js buildings + volumetric fog |
| `MULTIPLAYER` | `true` | Send `mp=1`, render other walkers |
| `DOG_CAM` | `true` | Supersniff's low chase camera |
| `LOST_DOG_PINS` | `false` | Lost-pet pins on the main map — off on purpose |

**Balance** — `server/src/config/balance.ts` (435 lines) is the canonical
source for anything that affects state transitions or reward maths;
`app/constants/balance.ts` mirrors it for animation. A handful of territory
values are env-overridable so the feel can be tuned on a live API without a
redeploy per guess: `TERRITORY_COOLDOWN_MS`, `TERRITORY_MIN_DISTANCE_M`.
A missing or unparseable var falls back to the tuned default, never to zero.

**Server env / Fly secrets**: `DATABASE_URL`, `REDIS_URL`,
`ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_PUBLIC_URL`, `ADMIN_TOKEN`, and the optional
`TELEGRAM_CHANNELS`, `FACEBOOK_GROUP_IDS`, `SCRAPE_PROXY_URL`,
`ALERT_CHAT_ID`, `INGEST_STALL_HOURS`, `MULTIPLAYER`, `REPORT_TOKEN`,
`INVITE_REQUIRED`, `DASHBOARD_TOKEN`, `DEV_TOOLS_PASSWORD`,
`CHAT_DISABLED` and the chat-budget overrides.
`MULTIPLAYER_BOTS` lives in `fly.toml [env]`.

Of those, **four are built-and-waiting**: `INVITE_REQUIRED` (the beta
door), `DASHBOARD_TOKEN` (the console), `DEV_TOOLS_PASSWORD` (the walk
simulator on a real phone), `ALERT_CHAT_ID` (the ingest alert). All unset
as of 14 Aug — each feature 401s or no-ops until its value exists.

**Client env**: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`,
and optionally `EXPO_PUBLIC_DEV_TOOLS=1` for a test build. Any
`EXPO_PUBLIC_*` var is inlined into the bundle by Metro — public by
design, which is also why the dev-tools password is *typed* at `/dev` and
checked server-side rather than shipped as a fourth flag.

## Deploy and CI

**Backend** — `.github/workflows/deploy.yml`, on push to `main`:

```
checks:  pnpm install --frozen-lockfile → pnpm typecheck → pnpm lint → pnpm check
server:  needs: checks → flyctl deploy --remote-only
```

The gate is real (PR #274). `react-hooks/rules-of-hooks` is an **error** —
that is the class of bug that white-screened prod once. `pnpm check` (added
PR #416) runs the **thirteen** fixture checks: out-of-area, ingest alert, pet identity, per-user rate limiting,
invite gate, dev auth, contact redaction, ad-body containment, ad
extraction, found reports, walk stops, landmark name match, route coverage.
They existed before and **nothing ran them** — a broken rule deciding which
pets get expired or merged would have shipped on the strength of having
compiled.

`typecheck.yml` runs the same checks on every PR.

**Frontend** — Vercel's own git integration, not this workflow. `main` →
production, every branch → a preview URL. `vercel.json` at repo root sets
the build command, SPA rewrites, and long-cache headers for
`_expo` / `assets`. **Gated since PR #425**: the build command runs
typecheck + lint first and fails on either — deliberately a failing build
rather than Vercel's `ignoreCommand`, because a skipped build leaves the
previous deployment up with nothing visibly wrong. The gate's first catch
was the commit that added it.

**Fly** — `fly.toml`: app `shukajpes-api`, region `fra`, one
`shared-cpu-1x / 512mb` VM, `min_machines_running = 1`, auto stop/start,
health check `GET /health` every 30s.

`/health` returns `{ ok: true }` unconditionally and is what Fly's rotation
uses. `/health/deep` checks Postgres and Redis and returns 503 if either is
unhealthy. The split is deliberate — Redis is non-critical, so a Redis
outage should not make Fly cycle the machine.

## Local development

```sh
pnpm install
docker compose up -d                                # Postgres + Redis
pnpm --filter @shukajpes/server db:migrate
pnpm dev:server                                     # port 3000
pnpm web                                            # Expo web
```

`server/.env` needs at minimum `DATABASE_URL` and `REDIS_URL`; the LLM and
Maps keys are needed for chat, parsing and spots. The Anthropic key goes in
`server/.env` only and is never exposed to the client bundle.
