# шукайпес — Audit Findings & Remediation Plan

> Companion to `AUDIT_BRIEF.md`. The brief is the map; this is the audit.
> Code was treated as source of truth — every finding below is grounded in a
> specific file/line, with the fix spelled out enough to implement directly.
> Findings are grouped by area and ranked by severity within each group.
> Severity: **P0** = fix before any real launch · **P1** = fix soon ·
> **P2** = worth doing · **P3** = cleanup / nice-to-have.
>
> Reviewed at commit `805efed`. Where this contradicts the brief, the code
> won — those deltas are called out in §0.

---

## 0. Corrections to `AUDIT_BRIEF.md` (code vs. doc)

The brief is accurate on architecture. Three claims don't match the code and
should be corrected so later work isn't planned on false premises:

1. **There is no PostGIS.** The brief (§2, §3, §10.3) and even a `schema.ts`
   comment ("PostGIS point added via raw SQL migration") say PostGIS is in
   use. It isn't. No migration references `geometry`, `geography`, `gist`, or
   `postgis` (`server/migrations/*.sql` — grep is empty). **All proximity
   queries are hand-rolled haversine in SQL** (`routes/dogs.ts:57`,
   `services/mapData.ts:50`, `services/spawn.ts:40`, `pipeline/upsert.ts:85`).
   The only geo indexes are plain B-trees on `owner_id` / `status`. This
   materially changes the scaling story (see §3.1).

2. **`pnpm lint` is non-functional, not just "not gated."** The brief (§10.7)
   says lint "exists but isn't in the deploy gate." In fact there is **no
   ESLint config anywhere** (`.eslintrc*` / `eslint.config.*` absent) and
   **ESLint is not a dependency** of either package. The `"lint"` scripts
   (`app/package.json`, `server/package.json`) would error, and the dozens of
   `// eslint-disable-next-line` comments are decorative. The `react-hooks`
   rule that would have caught the white-screen hook-order bug isn't merely
   un-gated — it can't run. See §5.2.

3. **The collect rate-limit is configured but never applied.** The brief (§7)
   flags this as "check which routes actually apply it." Confirmed: it is
   applied to **none** of the collect endpoints. See §2.2.

---

## 1. Secrets & credentials

### 1.1 — P0 · Compromised Google Maps key still committed in-tree
- **Where:** `docs/TECHNICAL.md:236`, `reference/shukajpes-demo.html:147`
  (`AIzaSyBpqM8DobD-CRDYkK_IwbMI1VSmvRWMaPM`).
- **Evidence:** Present at HEAD in two tracked files; also in history
  (`git log -S` finds it). The Anthropic key alongside it in TECHNICAL.md was
  already redacted/revoked — the Maps key was not.
- **Impact:** Anyone cloning the repo (or reading the public preview HTML) has
  a live key. Even if HTTP-referrer-restricted, an unrestricted API in the
  same project (Routes, Places, Geocoding) can be abused for quota/billing.
- **Fix:**
  1. Rotate the key in Google Cloud, issue a fresh one.
  2. Restrict the new key: HTTP referrers = your Vercel origins only; enable
     **only** the APIs actually used from the browser (Routes API — see §1.2).
  3. Purge the value from history (`git filter-repo --replace-text` or BFG),
     then force-push. Coordinate since this rewrites SHAs.
  4. Delete `reference/shukajpes-demo.html` and the docs key line, or replace
     with a placeholder — the demo HTML is a 380KB artifact with no build role.

### 1.2 — P1 · Google key is necessarily exposed in the client bundle
- **Where:** `app/constants/env.ts:3`, `app/services/directions.ts:69`
  (`X-Goog-Api-Key: env.googleMapsApiKey`).
- **Evidence:** `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is inlined into the single
  web bundle by Metro (any `EXPO_PUBLIC_*` var is public by design). The Routes
  API call is made directly from the browser.
- **Impact:** The prod Maps key is readable by anyone via DevTools. This is
  inherent to calling Routes client-side; the mitigation is restriction, not
  secrecy.
- **Fix (pick one):**
  - **Cheap:** Ensure the client key is referrer-restricted and scoped to
    Routes API only, and set a billing quota/budget alert. (Places already got
    moved server-side — `services/placesCache.ts` — so the client key only
    needs Routes.)
  - **Thorough:** Proxy Routes through the server too (mirror the Places
    proxy), and stop shipping any Google key to the client. Removes the last
    client-side Google surface and unifies caching/billing control.

### 1.3 — P3 · Large binary/asset blobs committed to the repo
- **Where:** root `8-Bit Dogs.rar`, `SHUKAYPES_SVG_ICONS.zip`, `kalam.zip`,
  `pidmohylnyy-...misto76.html`; `reference/shukajpes-demo.html` (~380KB);
  `docs/shukajpes-product-doc.docx`.
- **Impact:** Bloats clone size, no build role, and (the demo HTML) carries the
  leaked key. Not a security issue on its own beyond §1.1.
- **Fix:** Move design source assets to storage/Drive; remove from git (history
  purge optional, do it alongside §1.1's rewrite to avoid a second force-push).

---

## 2. Auth, authorization & anti-abuse

### 2.1 — P1 · `x-device-id` is unverified, client-chosen identity
- **Where:** `server/src/auth.ts:116-123`, `app/services/deviceId.ts`.
- **Evidence:** Any string 8–128 chars is accepted as identity; a matching
  `users` row is created or resolved on it. There is no secret, no signature.
- **Impact:** Presenting a victim's device id **is** logging in as them — read
  their state, collect their tokens, spend/earn on their account, set their
  presence. Device ids are client-generated random hex (not enumerable), so
  this needs the id to leak (shared device, XSS, logs) — but there's zero
  defense in depth once it does. The Telegram path is properly signed and fine.
- **Note — no cross-user IDOR:** every mutating route re-checks
  `ownerId === req.userId` (`routes/tokens.ts:121`, `routes/food.ts:104`,
  `routes/quests.ts:222`), so you can't touch *another* user's rows by id. The
  weakness is impersonation via the header itself, not object references.
- **Fix:** Treat device-id accounts as throwaway (they already can't merge).
  For anything that gains real value (leaderboards, rewards), require the
  Telegram-signed identity. If device-id must stay first-class, issue a signed
  token on first contact (HMAC of a server secret + the id) and verify it,
  so a bare guessed/copied id isn't sufficient.

### 2.2 — P1 · Collect/feed/quest/poke/sync endpoints have no rate limit
- **Where:** `server/src/index.ts:48-53` registers `@fastify/rate-limit` with
  **`global: false`**. Only `routes/chat.ts`, `routes/admin.ts`,
  `routes/sightings.ts` opt in via `config.rateLimit`. `balance.collectRateLimitPerMin`
  (120) is passed as the plugin's default `max`, but with `global:false` that
  default is applied to nothing.
- **Evidence:** `/collect/token`, `/feed`, `/collect/path`, `/quests/advance`,
  `/tasks/tick`, `/poke`, and `/sync/map` register no `config.rateLimit`.
- **Impact:** The endpoints that write points/XP and the LLM-free hot path are
  unthrottled per user. Combined with §2.3, a script farms points and hammers
  the DB (`/sync/map` triggers the full spawn pipeline — §3.2) with no ceiling.
  `/poke` unthrottled = poke-spam another walker's screen.
- **Fix:** Add `config: { rateLimit: { max, timeWindow } }` to the mutating
  routes (the config the brief *thought* was global). `/sync/map` at ~1 call /
  10s/user → cap ~30/min. `/poke` → ~10/min. Keep keyGenerator on
  `userId || ip`. Alternatively flip the plugin to `global: true` with a sane
  default and opt higher/lower per route.

### 2.3 — P1 · `force: true` lets the client bypass every distance/anti-cheat check
- **Where:** `routes/tokens.ts:131` (`if (!force)`), `routes/food.ts:114`,
  `routes/quests.ts:238` — all gate the distance check behind a
  **client-supplied** `force` flag. The client sends `force:true` on UI taps
  (`api.collectToken(..., force)`), `advanceQuest(..., force)`.
- **Evidence:** `quests.ts` even has the comment "Testing flag … Gate this
  later if it ever ships to non-dev builds" — it shipped.
- **Impact:** The `collectMaxDistanceM` / `WAYPOINT_REACH_RADIUS_M` checks are
  effectively optional. A scripted client collects all its own tokens and
  completes quests (points + XP) from anywhere, instantly — no walking. Scope
  is self-farming (items are per-user owned), so it corrupts leaderboards /
  reward economies rather than harming other users.
- **Fix:** Don't trust `force` from the client for reward-bearing actions.
  Either remove it in prod builds (env/build flag), or keep the tap affordance
  but still enforce a generous server-side distance bound (e.g. must be within
  view radius). Pair with §2.2 so it can't be done at machine speed regardless.

### 2.4 — P2 · Multiplayer broadcasts live position with weak, non-consensual jitter
- **Where:** `services/presence.ts:52-64` (`jitter`), `:143-147` (`syncPresence`),
  `RADIUS_M = 8000`.
- **Evidence:** Real players' positions are written to a shared Redis GEO set on
  every `mp=1` sync and returned to **anyone within 8km** who sends `mp=1`.
  Jitter is a *stable* per-id offset of magnitude ≤25m derived from an FNV hash
  of the user id. There is no opt-out / hide-me.
- **Impact:** Live location of every active walker is queryable citywide at ≤25m
  accuracy. The stable offset (good: averaging many reads won't de-jitter)
  still leaks true position within ~25m, and 25m in a residential block is
  identifying. No consent surface.
- **Fix:** Add an explicit opt-in (or at least opt-out) toggle that stops the
  client sending `mp=1` and the server writing presence. Consider coarser
  jitter for non-friends, snapping to a grid, or only exposing presence within
  a tighter radius. Document the privacy model in-app.

### 2.5 — P2 · Public unauthenticated `/stats` leaks pipeline internals
- **Where:** `server/src/auth.ts:87` bypasses auth for `/stats`;
  `routes/stats.ts` returns active-pet counts, per-source breakdowns, and the
  last 30 `scrape_log` rows (titles, confidence, skip reasons, dog ids).
- **Impact:** Anyone can enumerate scraping sources, volumes, and post titles —
  useful for a competitor or for gaming the ingestion. Low direct harm, but
  it's an internal ops dashboard exposed to the world.
- **Fix:** Move behind the admin bearer (like `/admin/lost-dogs/scrape-log`,
  which returns nearly the same data *with* auth), or trim `/stats` to
  non-sensitive aggregate counts.

### 2.6 — P2 · Open Telegram photo proxy, unauthenticated and unthrottled
- **Where:** `routes/photos.ts`; auth bypassed at `auth.ts:97`.
- **Evidence:** `/photos/:fileId` resolves any `file_id` via the bot token and
  streams the bytes. No rate limit, no allow-list of known file ids.
- **Impact:** (a) An open relay to `api.telegram.org` under your bot token — a
  caller can drive getFile/file fetches (bandwidth + TG rate-limit exhaustion
  against your bot). (b) Any `file_id` the bot can resolve is fetchable, not
  just ones you've stored on a `lost_dogs` row. Practical risk is bounded (file
  ids are opaque and bot-scoped) but it's an unauthenticated egress path.
- **Fix:** Rate-limit the route; ideally validate the requested `fileId`
  against `lost_dogs.photo_file_id` before proxying so only ingested photos are
  serveable.

### 2.7 — P3 · CORS reflects any origin
- **Where:** `index.ts:47` — `cors({ origin: true })`.
- **Impact:** Low. Auth is header-based (no cookies), so a malicious site can't
  ride an existing session — it has neither the victim's device id nor their
  Telegram initData. Reflecting `*` is acceptable here, but pinning to known
  origins is free defense.
- **Fix:** Allow-list the Vercel prod + preview origins and the Telegram web
  origin instead of `true`.

---

## 3. Scaling, performance & data model

### 3.1 — P1 · No spatial indexing; proximity queries are haversine table scans
- **Where:** all nearby queries — `routes/dogs.ts:57`, `services/mapData.ts`,
  `services/spawn.ts`, `pipeline/upsert.ts:85`. Indexes present: `tokens`
  (`owner_id`, `collected_at`), `food_items` (`owner_id`), `lost_dogs`
  (`status`) — no geo index anywhere (`schema.ts:73,93,126`).
- **Evidence:** `fetchNearbyLostDogs` filters `status='active'` then computes
  haversine over the survivors — a scan of **all active pets** on every
  `/sync/map`, per user, every 15s. Token/food queries are pre-filtered by
  `owner_id` (indexed) so they stay per-user-small, but the lost-dog scan and
  the spawn pipeline's repeated `count(*)` haversine queries are not.
- **Impact:** The brief's ~5–15k DAU ceiling is optimistic given full-active
  scans on the hot path. Cost grows with (active pets × concurrent walkers).
- **Fix:** Add real spatial support. Minimum viable: a bounding-box pre-filter
  on `last_seen_lat/lng` with a composite B-tree, so haversine only runs on a
  small box. Better: enable PostGIS (the schema comments already assume it),
  store a `geography(Point)` column, add a GiST index, and use `ST_DWithin`.
  This also simplifies the SQL considerably.

### 3.2 — P1 · The spawn pipeline runs on the 15s hot path and fires many queries per sync
- **Where:** `routes/syncMap.ts:71-74` awaits `ensureTokensForUser` +
  `ensureFoodForUser` **before** every map read; `services/spawn.ts`.
- **Evidence:** A single `ensureTokensForUser` can issue: 1 expire UPDATE, a
  load-existing SELECT, a user-area count + insert, a nearby-dogs SELECT, then
  **per nearby dog** a count + insert, **per park** a count + insert, and a
  final cap UPDATE with `OFFSET` (`spawn.ts:121-269`). `ensureFoodForUser` is
  similar. That's easily 8–15+ round-trips per sync per user, on a default
  postgres-js pool of ~10 (`db/index.ts:9`) and one shared-cpu-1x VM.
- **Impact:** This, not the reads, is the real per-user DB cost and the first
  thing to saturate the pool under concurrency. The Redis gates
  (`spawnCooldown.ts`) throttle the *inserts* but the count/select probing
  still runs every tick.
- **Fix:** Gate the whole spawn attempt on the Redis cooldown *before* doing
  any probing queries (early-return when the user-area gate is closed and no
  new dogs/parks are in range). Consider decoupling spawn top-up from the read
  path (spawn on a cheaper cadence or lazily), and raise/measure the DB pool.

### 3.3 — P2 · Single machine + in-process crons cap horizontal scaling
- **Where:** `fly.toml` (`min_machines_running=1`, `shared-cpu-1x/512mb`);
  `index.ts:113-123` starts decay/scrape/zone/cleanup/multiplayer crons in
  every process.
- **Evidence:** `services/scrape.ts:6` explicitly notes "no leader election —
  move to a redis lock if we scale beyond one machine." The multiplayer bot
  cron (`services/bots.ts`) writes 30 bots' presence from *each* process.
- **Impact:** You cannot add a second replica without (a) duplicated cron work
  (double scrapes, double decay ticks, N×30 bots), and (b) presence-purge races.
  The current design is correct for one machine and blocks scaling out.
- **Fix:** Before scaling out, add a Redis-based leader lock around the crons
  (only the leader runs decay/scrape/cleanup/bots; all replicas serve HTTP).
  This is the single change that unblocks a second machine.

### 3.4 — P2 · `spawnCooldown` fails open when Redis is down → over-spawn
- **Where:** `services/spawnCooldown.ts:58,70,104,116` all `return true`
  (allow) when `redis.status !== 'ready'` or on any throw.
- **Impact:** With Redis unavailable, every 15s sync re-spawns (no cooldown, no
  claim lock) → token/food piles and double-spawn races. The global caps
  (`spawn.ts:258`, `capFoodForUser`) bound the on-screen count but not the
  churn/write volume. Cosmetic + wasteful, as the brief notes.
- **Fix:** Acceptable as graceful degradation, but consider failing *closed* on
  the pool-claim locks specifically (skip top-up when Redis is down) so an
  outage doesn't turn into a write storm. Add a Redis uptime alert (see §4.1).

---

## 4. Reliability & observability

### 4.1 — P2 · Redis is silent-degrade everywhere but has no uptime monitor
- **Where:** `db/redis.ts` (throttled error log), guards in `presence.ts`,
  `spawnCooldown.ts`, `path.ts`, `userLang.ts`; `/health/deep` checks Redis but
  `/health` (Fly's rotation check) deliberately does not (`index.ts:55,57`).
- **Evidence:** The brief (§10.4) documents an earlier idle-reap of a free
  Upstash DB; the eager boot-connect (`index.ts:106`) fixes the reap, but
  nothing *alerts* when Redis is down — the app just quietly loses cooldowns,
  presence, path-collect, and lang cache.
- **Fix:** Point an external uptime monitor at `/health/deep` (returns 503 when
  Redis or DB is unhealthy). Confirm the current Redis is a paid/persistent
  tier, not another idle-reapable free DB.

### 4.2 — P2 · `deploy.yml` does not gate on `typecheck.yml`
- **Where:** `.github/workflows/deploy.yml` vs `typecheck.yml` — two independent
  workflows both triggered on push to `main`.
- **Evidence:** `deploy.yml` runs `flyctl deploy` immediately on push; it has no
  `needs:` on the typecheck job (different workflow, can't). So a push to `main`
  that fails typecheck **still deploys** the server. Vercel's git integration
  deploys the frontend on the same push with no gate either.
- **Impact:** A type error (or, once lint exists, a hook-order lint failure) can
  reach prod. The white-screen incident's class of bug isn't blocked by CI.
- **Fix:** Merge typecheck into the deploy workflow as a prerequisite job
  (`needs: [checks]`), or make deploy trigger on `workflow_run` of a passing
  checks workflow. Add lint (§5.2) to the same gate. For the frontend, gate
  Vercel via a GitHub check or move its build behind the same workflow.

### 4.3 — P3 · Recent-scrape tick history is in-memory only
- **Where:** `routes/stats.ts:109` `getTickHistory()`; comment: "Gone on
  restart; promote to redis if we ever scale beyond one machine."
- **Impact:** Minor — ops visibility resets on every deploy/restart. Fine for
  now; noted so it's not surprising.

---

## 5. Frontend & build

### 5.1 — P1 · Experimental render + multiplayer are hard-`true` in prod
- **Where:** `app/constants/experiments.ts:12,18` — `GAME_RENDER = true`,
  `MULTIPLAYER = true`.
- **Evidence:** These are compile-time constants, not env/URL-gated. The
  Three.js city + self-repainting fog and the presence system are live for
  every prod user. WebGL2 fallback is handled well (`MapView.tsx:1221-1261`
  tears down partial state and reverts to MapLibre buildings + screen fog on
  any throw), so this is a *perf/cost* concern, not a correctness one.
- **Impact:** No kill switch without a rebuild+redeploy. `three` (~0.6MB) is in
  the single ~3.8MB bundle (can't code-split under `output: single`). Battery /
  low-end-device cost of the continuous fog repaint is unmeasured.
- **Fix:** Wire both flags to an env var and/or URL param so they can be toggled
  without a deploy (the server already honors `MULTIPLAYER=off`; the client
  can't match it today). Profile the fog/Three render on a low-end Android in
  the field; consider a "lite" mode that skips the Three layer.

### 5.2 — P1 · ESLint is referenced but not installed or configured
- **Where:** `app/package.json` / `server/package.json` `"lint"` scripts;
  **no** `.eslintrc*` / `eslint.config.*` exists and ESLint is not in
  dependencies.
- **Evidence:** `find` for eslint configs is empty; `grep eslint package.json`
  shows only the script lines, no dep. The `// eslint-disable-next-line
  react-hooks/exhaustive-deps` comments (e.g. `MapView.tsx:1317,1630`) are
  inert.
- **Impact:** The `react-hooks` rules that would catch the exact hook-order bug
  the brief says white-screened prod (§10.7) cannot run. There is effectively
  no linting.
- **Fix:** Add ESLint + `eslint-plugin-react-hooks` +
  `@typescript-eslint`, commit a flat config, get `pnpm -r lint` green, then
  add it to the CI gate from §4.2. Turn `rules-of-hooks` to `error` and
  `exhaustive-deps` to `warn`.

### 5.3 — P2 · `MapView.tsx` is a 2,665-line component
- **Where:** `app/components/map/MapView.tsx` (also `gameStore.ts` 917 lines as
  a single store).
- **Impact:** Maintainability + the hook-order risk from §5.2 concentrate here —
  the file mixes map init, marker layout, multiplayer culling, sniff-mode
  animation, and camera control. Not a bug, but the highest-risk file to edit.
- **Fix:** Incrementally extract cohesive hooks (`useMapInit`, `useMarkers`,
  `usePresenceRender`, `useSniffMode`). Do this *after* §5.2 so the linter
  guards the extraction.

---

## 6. LLM cost & prompt-injection surface

### 6.1 — P2 · Untrusted scraped text flows into the companion chat context
- **Where:** `pipeline/parser.ts` parses attacker-authorable posts (Telegram /
  OLX / FB) into `lastSeenDescription`; that field is stored on `lost_dogs`
  and surfaced into the chat system prompt via `prompts/context.ts`
  (`buildContextBlock` → nearby lost pets) for the Opus companion.
- **Evidence:** The parser constrains structure (clamps numbers, normalizes
  enums, strips the field to 280 chars, prompt says "no phone numbers") but the
  free-text description is still model-shaped text derived from untrusted input,
  later concatenated into another model's context. Output is rendered in RN
  `Text`, not HTML — so **no XSS**, but indirect prompt-injection into the
  companion is possible ("ignore previous instructions" smuggled via a post).
- **Impact:** Bounded — the companion has no tools that touch other users or
  money; worst case is it says something off-script or leaks its own prompt.
  Still worth hardening before the ingestion volume (and blast radius) grows.
- **Fix:** Wrap externally-derived fields in clearly-delimited, "data not
  instructions" context blocks; keep the parser's contact-info stripping; add a
  short output filter on the chat reply. Log/monitor for anomalous replies.

### 6.2 — P2 · Chat (Opus) is reachable by anonymous device-id users, lightly throttled
- **Where:** `routes/chat.ts:154` (`/chat` = 30/min), `:272` (`/chat/ambient`
  = 60/min), model `claude-opus-4-8` for active turns
  (`services/anthropic.ts:13`).
- **Evidence:** A throwaway device id (no verification, §2.1) can open chat and
  drive Opus at 30 requests/min. Rate limit is per `userId||ip`, so rotating
  device ids from one IP still shares the IP bucket — but a botnet / rotating
  IPs isn't bounded by anything else.
- **Impact:** Opus is the priciest call in the app; this is the most direct
  cost-abuse lever. Google Places/Routes are the other $ lever but those are
  now cached server-side (Places) or client-restricted (Routes, §1.2).
- **Fix:** Lower the active-chat limit, and/or gate Opus chat behind the
  Telegram-signed identity (device-id users get the Haiku tier). Add a global
  daily spend cap / alarm on the Anthropic key.

---

## 7. Licensing

### 7.1 — P3 · Confirm third-party pixel-art asset licensing
- **Where:** `app/public/dog/` sprite sheets; root `8-Bit Dogs.rar`.
- **Impact:** README claims free-for-commercial, no attribution — verify and
  keep the license text in-repo before a public launch. (Carried over from
  brief §10.10; unchanged.)

---

## 8. Suggested order of work

1. **§1.1 / §1.2** rotate + restrict + purge the Maps key. (Nothing else
   matters if the key is live.)
2. **§2.2 + §2.3** add rate limits to mutating routes and stop trusting
   `force`. Small, high-value, closes the farming/abuse loop.
3. **§4.2 + §5.2** stand up real ESLint and make CI gate deploy on
   typecheck+lint. Prevents the next white-screen.
4. **§3.1 + §3.2** bounding-box/PostGIS the geo queries and take the spawn
   pipeline off the hot path — the two changes that move the DAU ceiling.
5. **§2.1 / §2.4 / §6.2** tighten auth, add a presence opt-out, and cap Opus
   chat cost/abuse.
6. **§3.3** add a Redis leader lock so a second machine becomes possible.
7. Everything P2/P3 as cleanup.
