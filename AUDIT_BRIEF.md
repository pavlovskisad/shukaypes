# шукайпес — Audit Brief & Ground-Up Architecture

> Onboarding + audit map for a fresh reviewer. Written to be self-contained.
> Where this doc and older docs (`TECHNICAL.md`, `PRODUCT_SPEC.md`,
> `TRANSFORMATION.md`) disagree, **trust the code** — those predate the
> game-render + multiplayer work. Anything marked _(verify)_ is my best
> understanding, not gospel — confirm against source before relying on it for a
> finding.

## 1. What it is

**шукайпес** ("shukaypes" / "search-pets") is a Kyiv **lost-pet search** app,
gamified as a walking game. You have a pixel-art **companion dog** that follows
your GPS around a stylised 3D city map; you collect **paws/bones**, feed/keep
the companion happy, do **quests**, discover partner **spots**, and — the point
— help find **lost pets** reported around the city. Recently added: a **game
render** (Three.js 3D city + volumetric fog) and **multiplayer presence** (see
other walkers' dogs, poke them).

Runs as a **PWA** (browser / installed) and a **Telegram Mini App**. Primary
market: Kyiv. Prod web: `https://shukaypes.vercel.app`. API:
`https://shukajpes-api.fly.dev`.

## 2. Repo & stack

pnpm **monorepo** (`pnpm-workspace.yaml`): `app`, `server`, `shared`.

- **`app/`** — frontend. Expo (SDK ~52) + Expo Router + **React Native Web**,
  bundled by Metro to a **single** web bundle (`app.json` → `web.output:
  "single"`). Deployed to **Vercel** (auto-deploys `main`; every branch gets a
  preview URL). Build: `pnpm --filter @shukajpes/app build:web` (`expo export
  --platform web`). Map via **MapLibre GL JS v5**; 3D via **three** 0.185.
- **`server/`** — API. **Fastify 5** + **Drizzle ORM** (`postgres-js`) on
  **Postgres + PostGIS**, **Redis** (`ioredis`), **Anthropic SDK** for the LLM
  bits. Compiled `tsc` → `dist`, run `node dist/index.js`. Deployed to
  **Fly.io** (app `shukajpes-api`, region `fra`) via GitHub Actions.
- **`shared/`** — TypeScript types only (`@shukajpes/shared`). No build; the
  server maps the alias in tsconfig but **defines its own copies of wire types**
  at runtime (it never resolves the shared package at runtime — see
  `presence.ts`).

**CI/CD**: `.github/workflows/deploy.yml` runs `flyctl deploy --remote-only` on
push to `main` (server → Fly). `typecheck.yml` runs typechecks. Frontend deploy
is Vercel's own git integration, not this workflow.

## 3. Runtime topology

```
Browser / Telegram Mini App (app, on Vercel CDN)
   │  HTTPS, auth header (x-device-id OR x-telegram-init-data)
   ▼
Fastify API (single Fly machine: shared-cpu-1x / 512MB, min 1)
   ├── Postgres + PostGIS   (durable state: users, pets, tokens, quests…)
   ├── Redis (Upstash/Fly)  (cache: presence GEO, cooldowns, path anchor, lang)
   ├── Anthropic API        (dog chat, lost-pet parsing pipeline, lore, quests)
   ├── Google Maps Platform (Places → spots, Directions → walk routes)
   └── Telegram Bot API     (Mini App auth, webhook, lost-pet ingestion)
Map tiles: OpenFreeMap "liberty" style (self-referenced), glyphs self-hosted.
```

The **hot path** is `GET /sync/map` — the client polls it every **15s** with
its position; one round-trip returns nearby tokens, food, lost dogs, user/
companion state, and (multiplayer) nearby players + pokes. It also does
idempotent spawn top-ups. Almost all per-user server load is this endpoint.

## 4. Frontend architecture (`app/`)

- **Routing/screens**: `app/app/(tabs)/` — `index` (map, the core screen),
  `tasks` (quests), `chat` (talk to the dog), `spots`, `profile`. Floating tab
  bar in `_layout.tsx` (hidden during sniff mode).
- **State**: **Zustand** `stores/gameStore.ts` — large single store (map data,
  companion stats, quests, spots, sniff mode, multiplayer `nearbyPlayers` /
  `incomingPoke`, daylight, etc.). `stores/langStore.ts` for language.
- **Map**: `components/map/MapView.tsx` (~2.5k lines — the nerve center). Uses
  MapLibre with a heavily-overridden **"crayon" style** (`crayonStyle.ts`,
  based on OpenFreeMap liberty). Markers are **DOM overlays** via
  `MapLibreMarker.tsx` (companion, user dot, tokens, food, lost-dog pins/
  clusters, spots, other walkers). Camera opens at a steep game pitch (74°).
- **Render tiers** (flagged in `constants/experiments.ts`):
  - `GAME_RENDER` (**on in prod**): replaces MapLibre's flat extrusions with
    **Three.js extruded buildings** (`threeBuildingsLayer.ts`) that get true
    per-distance + height **fog**, plus a **ground/sky fog** custom layer
    (`groundFogLayer.ts`) with an off-screen warm sun + god rays, and a screen
    fog (`fogLayer.ts`) kept as the classic/fallback. All share fog params so
    ground and buildings dissolve together. Requires **WebGL2**; on failure the
    init falls back to the classic render (MapLibre buildings + screen fog).
  - `MULTIPLAYER` (**on in prod**): see §8.
- **Companion**: `components/map/Companion.tsx` + `DogSprite.tsx` (pixel-art
  sprite sheets in `app/public/dog/`). Lerps to follow GPS.
- **Build note**: `app/babel.config.js` enables `@babel/plugin-transform-class-
  static-block` so Metro can bundle `three` (ES2022 static blocks). Removing it
  breaks the web build.

## 5. Backend architecture (`server/src/`)

- **Entry** `index.ts`: builds Fastify, registers routes, starts crons, eager-
  connects Redis, registers the Telegram webhook, listens.
- **Auth** `auth.ts` (Fastify plugin, `preHandler`): resolves `req.userId` from
  **Telegram initData** (validated with bot token) or an **`x-device-id`**
  header (browser/PWA). Device-id users are anonymous + browser-scoped; no
  account merging. A few paths bypass auth (`/health*`, `/stats`, `/admin/*`,
  `/telegram/webhook`, `/photos/*`).
- **Routes** `routes/`: `state`, `tokens`, `food`, `dogs`, `chat`, `admin`,
  `sightings`, `quests`, `stats`, `profile`, `path` (collect-along-path),
  `syncMap` (the bulk hot path), `poke` (multiplayer), `dailyTasks`, `lore`,
  `places` (Google Places-backed spots/parks), `photos` (TG photo proxy),
  `telegram` (webhook + Mini App).
- **Services** `services/`: `spawn` + `spawnCooldown` (token/food spawning &
  per-area cooldown locks in Redis), `mapData` (nearby queries), `decay` (cron:
  hunger/happiness decay), `scrape` + `scrape-history` + `pipeline/` (lost-pet
  **ingestion** from external sources → LLM parse → DB), `searchZoneExpansion`
  (cron), `lostDogCleanup` (cron), `quest` + `questNarration`, `presence` +
  `bots` (multiplayer, §8), `anthropic` (LLM client), `memory*` (chat memory),
  `telegramAuth`, `userLang`, `gazetteer` (place-name resolution).
- **DB** `db/`: `schema.ts` (Drizzle), `index.ts` (`postgres(url, {prepare:
  false})`, default pool ~10), `redis.ts` (`ioredis`, `lazyConnect`,
  throttled error log), migrations via `db/migrate.ts` at container start.
- **Crons** (all `setInterval`, `.unref()`, wrapped by `cronUtils.runCronTick`):
  decay, scrape, zone-expansion, lost-dog cleanup, multiplayer (bots + presence
  purge). They run in-process on the single machine (`min_machines_running=1`
  keeps one warm for this reason).
- **LLM usage**: the companion **chat** (`routes/chat.ts` + prompts/), the
  lost-pet **parsing pipeline** (free-text pet reports → structured records),
  **lore** and **quest narration**. Anthropic API key required.

## 6. Data model (Postgres, `db/schema.ts`) — highlights

`users` (id, deviceId UNIQUE, username, telegram* fields), `companionState`
(hunger, happiness, last_decay_at, per user), `tokens` (paws/bones w/ position,
spawnedAt, collectedAt), `foodItems`, `lostDogs` (reports: species, emoji,
lastSeen position + PostGIS, urgency, searchZoneRadiusM, photoUrl, status),
`sightings`, quests + stored waypoints, `placesCache` (Google Places results),
chat memory tables. **Durable state is here**; Redis is strictly cache.

## 7. Auth & identity (audit-relevant)

- **Telegram**: `x-telegram-init-data` validated with the bot token → strong,
  cross-device identity keyed on `telegram_id`.
- **Device**: `x-device-id` (8–128 chars, client-generated) → weak,
  spoofable, browser-scoped identity. Anyone can present any device id.
- No sessions/JWT; identity is re-derived each request. Rate limiting is per
  `userId || ip` at `balance.collectRateLimitPerMin` (120/min), `global:false`
  (per-route opt-in — check which routes actually apply it).

## 8. Multiplayer (recent — likely audit focus)

**Model**: polling-based presence, **not** WebSockets (deliberate — see the PR
history / `AUDIT_BRIEF` reasoning: fits the 15s poll, no stateful conns on Fly,
fine latency for a walking game). Real players and **bots** share one Redis GEO
set so they render identically.

- **Presence** `services/presence.ts`: on each `mp=1` `/sync/map`, write the
  caller's **jittered** position (stable ~25m per-id offset — privacy) into
  Redis GEO (`mp:pos`), a `seen` ZSET (TTL 45s), and `mp:meta` hash
  (name/photo/bot). Then `GEOSEARCH` within **8km** → nearby players. Guards
  every call on `redis.status === 'ready'` (degrades quietly if Redis is down).
- **Bots** `services/bots.ts`: `MULTIPLAYER_BOTS` (env, `fly.toml` sets 30)
  simulated walkers with a state machine — roam → **dwell at hotspots**
  (hardcoded central parks/squares) → randomly **go offline/online**. Written
  to the same presence set; only online bots publish. Same cron purges stale
  presence.
- **Poke** `routes/poke.ts` + presence `sendPoke`/`takePokes`: tap another
  walker → queued in Redis → delivered on the target's next `/sync/map` →
  "X poked you!" card + haptic + camera fly-to. Can't poke self/bots.
- **Client**: `api.syncMap` sends `mp=1` when `MULTIPLAYER`; `OtherWalker.tsx`
  renders + glides other dogs (nearest 24 in-view; horizon-culled so they don't
  float at the skyline); `PokeToast.tsx`; `utils/haptics.ts` (Telegram
  HapticFeedback on iOS, `navigator.vibrate` on Android web).
- **Gating**: prod clients only participate because `MULTIPLAYER` is on; server
  honors `mp=1` and can be killed with `MULTIPLAYER=off`.

## 9. Deploy / CI / env

- **Frontend**: Vercel git integration. `main` → prod; branches → preview URLs.
  `vercel.json` (repo root): `buildCommand` installs frozen lockfile + builds
  the app; SPA rewrites; long-cache headers for `_expo`/`assets`.
- **Backend**: `.github/workflows/deploy.yml` → `flyctl deploy` on `main` push
  (needs `FLY_API_TOKEN` secret). `fly.toml` (root): single **shared-cpu-1x /
  512MB** VM, `min_machines_running=1`, `auto_stop/start`, health check on
  `/health`.
- **Env / secrets** (Fly): `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`,
  `GOOGLE_MAPS_API_KEY`, `TELEGRAM_*` (bot token, public URL), `MULTIPLAYER_BOTS`
  (in `fly.toml [env]`), optional `MULTIPLAYER=off` kill-switch.

## 10. Known issues & audit hotspots

Ranked roughly by severity. Start here.

1. **Committed, compromised Google Maps API key.** A Google Maps Platform API
   key is present in the repo (committed) and is **known-compromised**; rotation
   was deferred. **Rotate + restrict + purge from history.** (Do not re-paste
   the key value into new files.)
2. **Weak device-id auth.** `x-device-id` is client-supplied and unverified —
   trivially spoofable to impersonate/enumerate device-scoped users. Assess what
   a spoofed/rotated device id can do (claim state, collect, poke-spam,
   presence-spoof). Telegram path is fine.
3. **Single points of scale/failure.** One shared-cpu-1x Fly machine + Postgres
   pool ~10 + all crons in-process. Estimated comfortable ceiling ~5–15k DAU
   before latency degrades; no horizontal replicas configured. PostGIS indexes
   on geometry columns _(verify)_.
4. **Redis durability history.** A free Upstash DB was **idle-reaped** (nothing
   was connecting to it). Fixed by eager boot-connect + status guards + log
   throttle, but confirm the new Redis is durable and add an uptime monitor on
   `/health/deep` (which checks Redis + DB; `/health`, used by Fly rotation,
   does **not** — intentional, since Redis is non-critical).
5. **Multiplayer privacy.** Real players broadcast a ~25m-jittered live position
   to anyone within 8km sending `mp=1`. No opt-in/hide. Review whether that's
   acceptable, and whether jitter is sufficient (it's a stable per-id offset —
   averaging multiple reads won't de-jitter it, but confirm).
6. **Experimental features shipped to prod behind always-true flags.** The whole
   game render + multiplayer are `GAME_RENDER = true` / `MULTIPLAYER = true` in
   `constants/experiments.ts` — i.e., **live in prod**, not really "off." Audit
   perf/battery on low-end devices, WebGL2 fallback correctness, and bundle size
   (~3.8MB single JS bundle; `three` adds ~0.6MB, not code-split because
   `output: single`).
7. **Rules-of-Hooks / lint not enforced in build.** A hook-order bug white-
   screened prod once (fixed). `tsc` + Metro build don't run the `react-hooks`
   ESLint rule; `pnpm lint` exists but isn't in the deploy gate. Consider
   wiring lint into CI.
8. **Spawn cooldown correctness.** `spawnCooldown` uses Redis `SET NX` locks +
   returns `true` (allow) when Redis isn't ready — so with Redis down, spawns
   skip cooldown/lock (over-spawn + double-spawn races). Cosmetic but worth
   noting.
9. **LLM cost/abuse surface.** Chat + parsing pipeline hit Anthropic; Places/
   Directions hit Google (the real $ ceiling at scale). Check rate limits,
   caching, and prompt-injection exposure in the lost-pet parsing pipeline
   (untrusted scraped text → LLM).
10. **Third-party pixel-art assets** in `app/public/dog/` — confirm licensing
    (README claims free-for-commercial, no attribution).

## 11. Where to look (file map)

- Map / render: `app/components/map/{MapView,crayonStyle,threeBuildingsLayer,
  groundFogLayer,fogLayer,MapLibreMarker,Companion,DogSprite}.tsx`
- Multiplayer: `app/components/map/{OtherWalker,PokeToast}.tsx`,
  `app/utils/haptics.ts`, `server/src/services/{presence,bots}.ts`,
  `server/src/routes/{syncMap,poke}.ts`
- State/API: `app/stores/gameStore.ts`, `app/services/api.ts`
- Server core: `server/src/{index,auth}.ts`, `server/src/routes/*`,
  `server/src/services/*`, `server/src/db/{schema,index,redis}.ts`
- Config/flags: `app/constants/experiments.ts`, `app/constants/balance.ts`,
  `server/src/config/balance.ts`, `fly.toml`, `vercel.json`,
  `.github/workflows/deploy.yml`

## 12. Running locally / checks

- Install: `pnpm install` (root).
- App: `pnpm --filter @shukajpes/app web` (dev) / `build:web` (prod build) /
  `typecheck`.
- Server: `pnpm --filter @shukajpes/server dev` (tsx watch) / `build` (tsc) /
  `typecheck`. Needs `DATABASE_URL` + `REDIS_URL` (+ API keys for LLM/Maps).
- Lint: `pnpm --filter <pkg> lint` (eslint — **not** in the deploy gate).

## 13. Suggested audit checklist

- [ ] Secrets: rotate/restrict the Maps key; scan history for other leaked
      secrets; confirm no secrets in the client bundle.
- [ ] Auth: what can a spoofed `x-device-id` do? Any IDOR across users?
- [ ] `/sync/map` + `/poke` + `/collect/*`: input validation, rate limits,
      per-user authorization, PostGIS query cost.
- [ ] Multiplayer: privacy of live positions; poke spam; presence spoofing;
      Redis key growth / TTL correctness.
- [ ] Scaling: DB pool + indexes; single-machine ceiling; cron cost at scale;
      Google/Anthropic cost model.
- [ ] Client: WebGL2 fallback path; perf/battery of the Three render + the
      self-repainting fog on low-end mobile; bundle size.
- [ ] Prompt-injection in the lost-pet parsing pipeline (untrusted input → LLM).
- [ ] CI gates: add lint (react-hooks) + typecheck to the deploy path.
