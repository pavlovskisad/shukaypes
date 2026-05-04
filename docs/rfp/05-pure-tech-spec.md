# Lost-pet companion app — Technical Specification (build contract)

**Document type:** Build contract / SOW addendum
**Audience:** delivery team (engineering)
**Status:** binding spec for v1 pilot

This document defines exactly what the system must do. It assumes the discovery + scoping phase is done. Do not reinterpret the product surface — match the spec.

---

## 1. Project structure

Monorepo with three packages:
- `app/` — frontend (RN + Expo Router, web target via `react-native-web`).
- `server/` — backend (Fastify on Node 20, deployed to Fly.io fra region).
- `shared/` — TypeScript types, balance constants, geo helpers shared between client + server.

Package manager: `pnpm` workspaces. TypeScript strict mode in all three. ESLint + Prettier configured.

---

## 2. Stack (mandatory)

- React Native 0.74+ / Expo SDK 51+ / Expo Router v3+.
- TypeScript 5+.
- Fastify 4+ on Node 20.
- Postgres 15+ with PostGIS extension (Supabase-managed).
- Redis (Upstash).
- Drizzle ORM + `drizzle-kit` for migrations.
- `@react-google-maps/api` for the web map.
- `@anthropic-ai/sdk` for Claude Haiku.
- Zustand for client state.
- `expo-location` for GPS.
- Vercel (web deploy) + Fly.io (server deploy). Both auto-deploy from `main`.
- GitHub Actions CI: typecheck + build + lint on every PR.

No alternative stacks unless approved in writing.

---

## 3. Data model

```sql
users (id PK, email UNIQUE, created_at, last_seen_position GEOGRAPHY(POINT), total_distance_meters INT, points INT, level INT, xp INT)
companion_state (user_id PK→users, name TEXT, hunger INT 0-100, happiness INT 0-100, last_decay_at TIMESTAMPTZ, memory_notes TEXT)
lost_dogs (id PK, source TEXT, source_external_id TEXT, name TEXT, breed TEXT, last_seen_position GEOGRAPHY(POINT), urgency TEXT CHECK IN ('urgent','medium','resolved'), photo_url TEXT, reward_points INT, scraped_at, expires_at, search_zone_radius_m INT, UNIQUE(source, source_external_id))
quests (id PK, user_id FK, dog_id FK, status TEXT CHECK IN ('active','completed','abandoned'), waypoints JSONB, started_at, finished_at)
sightings (id PK, user_id FK, dog_id FK, position GEOGRAPHY(POINT), reported_at, trusted BOOLEAN)
daily_tasks (user_id FK, date DATE, counts JSONB, PRIMARY KEY(user_id, date))
push_subscriptions (id PK, user_id FK, endpoint, p256dh, auth, created_at)  -- scaffold only, not active
```

Redis keys:
- `path:last:<userId>` — last GPS position (24h TTL).
- `recently_consumed:<userId>` — set of item IDs (60s TTL).
- `push_throttle:<userId>` — token bucket for future push rate limiting.

`waypoints` JSONB shape: `[{ position: {lat, lng}, clue: string, reached_at: string|null }]`.

---

## 4. Server endpoints

All routes session-authed unless marked. Bodies + responses are JSON.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/login` | Email + magic link or password (studio's call). |
| POST | `/auth/logout` | |
| POST | `/sync/map` | Bulk: returns `{ tokens, food, spots, lostDogs }` within `radiusM` of user position. Single round-trip. |
| POST | `/collect/path` | Body: `{ position }`. Server reads anchor from Redis, sweeps segment, credits items within `autoCollectM` of the line, refreshes anchor. Segments >5km treated as teleport (anchor refreshed, no credit). |
| POST | `/collect/token` | Body: `{ tokenId, position, force?: boolean }`. Validates distance unless `force`. |
| POST | `/feed` | Body: `{ foodId, position, force? }`. Same gate behavior. |
| POST | `/quests/start` | Body: `{ dogId }`. Generates 3 waypoints, calls Haiku ONCE for 3 clues, stores quest, returns `{ quest, route }`. |
| POST | `/quests/advance` | Body: `{ position }`. If user is within 25m of the next unreached waypoint, marks it reached, awards happiness +8, returns next clue. If final, marks complete, awards points + happiness +25, returns completion narration. |
| POST | `/quests/cancel` | Marks active quest abandoned. |
| GET | `/quests/history` | User's completed + abandoned quests. |
| POST | `/sightings` | Body: `{ dogId, position }`. Updates `lost_dogs.last_seen_position` if multiple users converge. |
| POST | `/chat` | Body: `{ message }`. Builds prompt (system + memory + last K turns), calls Haiku, parses `<<act:NAME:JSON>>` tags from response. Returns `{ text, actions: [...] }`. Triggers async memory summarization every Nth turn. |
| GET | `/profile/me` | User XP, level, lifetime stats, companion state. |
| POST | `/spots/visited` | Daily-task progress increment. |
| POST | `/admin/lost-pets` | Manual lost-pet entry. Bearer token auth. |

Server-side anti-abuse:
- Rate limit: `/collect/token`, `/feed`, `/quests/advance` capped at 1 req / 500ms per user.
- Distance gates: server `collectMaxDistanceM = 150`, client trigger 130. Tolerance band intentional.
- `recently_consumed` set prevents double-credit on race.
- Path collect 5km teleport guard.

---

## 5. Crons

- **Decay** (every 4 min): `UPDATE companion_state SET hunger = GREATEST(0, hunger - decay_per_tick), happiness = ... WHERE last_decay_at < NOW() - 4min`. Caps single-tick deduction at 30. Critical: every active interaction must reset `last_decay_at = NOW()` in the same UPDATE.
- **Search-zone expansion** (daily): `UPDATE lost_dogs SET search_zone_radius_m = base_m + days_since_seen * grow_per_day_m WHERE status != 'resolved'`.
- **OLX scraper** (hourly): 14 query variants, parses listings, upserts on `(source, source_external_id)`.
- **Memory cleanup** (weekly): strips system-prefix lines from `memory_notes`, trims to ≤500 chars.

---

## 6. Map view

- Custom Google Map style (greyscale, muted). `disableDefaultUI: true`, `gestureHandling: 'greedy'`.
- Min zoom: **16**. Max zoom: 19. Pan/zoom unrestricted within bounds.
- User position dot via `expo-location` watchPosition (high accuracy, distanceFilter 5m).
- Companion sprite (§7) anchored at companion position, paws on the lat/lng pixel.
- `MAP_RENDER_RADIUS_M = 2000` — items outside this radius from viewport center don't render.
- Lost-pet markers cluster below zoom 17. Cluster badge shows count + worst urgency colour.
- Lost-pet pin size 1.5× default Google Marker.
- Spots toggle (HUD pill) hides spot markers without re-fetching cached data.
- Off-screen companion bookmark: 32×32 white pill at viewport edge along line from map center to companion when companion is off-screen. Tap recenters map. Asymmetric clamp clears HUD top (90px) + dashboard bottom (90px + safe-area).
- Bulk `/sync/map` polled every 15s while tab is focused. Pauses when `document.visibilityState !== 'visible'`.

---

## 7. Companion sprite (`DogSprite` component)

- Source: 8-Bit Dogs by 14collective, Black & White Dog variant. Sheets in `/app/public/dog/{walking,sitting,running,sniffing,lying,jumping,crouched}.png`.
- All sheets 64px tall, frame-grid uniform. Sheets that ship at 55px tall (sniffing, crouched in some variants) must be pre-padded to 64 with a transparent top strip.
- `DogAnim` type: `'walking' | 'sitting' | 'running' | 'sniffing' | 'lying' | 'jumping' | 'crouched'`.
- Sheet config: `{ url, frameCount, frameMs, staticFrame? }`.
  - walking: 7 frames @ 110ms.
  - sitting: 5 frames @ 220ms.
  - running: 3 frames @ 80ms.
  - sniffing: 8 frames @ 140ms.
  - lying: 4 frames @ 320ms, `staticFrame: 3` (last frame held — sheet is a transition, not a loop).
  - jumping: 6 frames @ 110ms.
  - crouched: 6 frames @ 140ms, `staticFrame: 5`.
- Render via div with `backgroundImage: url(sheet)`, `backgroundPosition: -frameIdx * frameSize`, `backgroundSize: frameCount * size`, `image-rendering: pixelated`.
- **Module-level preload:** on import, `new Image().src = sheet.url` for every sheet. Eliminates first-swap flash.
- **Frame-index reset during render** (not in `useEffect`): track `animKey` state, when `animKey !== anim` call `setFrameIdx(staticFrame ?? 0)` and `setAnimKey(anim)` directly in render body. Prevents stale frame painting against new sheet's URL.
- Defensive `Math.min(frameIdx, frameCount - 1)` clamp in render.
- Direction flip via CSS `scaleX(-1)`.

---

## 8. Companion behaviour (`Companion` component)

- Lerps toward user. Trot speed configurable; defaults to ~3 m/s when within easy range, scales up to 8 m/s when chasing a target >15m away.
- State machine sets the displayed `DogAnim`:
  - `running` if currently lerping faster than `runThreshold` (8 m/s default).
  - `walking` if moving but below threshold.
  - `sniffing` for 1500ms after a collect event.
  - `lying` after 30s of `still`.
  - `sitting` otherwise.
- Hunt cooldown: after each chase resolves (collect or abandon), 5s minimum before next chase eligibility.
- Tap freeze: on companion tap, snap displayed position to live `getComputedStyle(...).transform.m41` and clear pursuit target. Use `DOMMatrix` to read.
- Radial menu (2-deep) on tap. See §11.

---

## 9. Game economy (paws + bones)

- Paw scatter: ~25 within 1.2km disk around user. Plus 4-paw / 70m-radius rings around each visible park. Annulus sampler with `userAreaInnerRadiusM = 130`.
- Bone scatter: clusters around parks (3-6 per park, 60m radius).
- Auto-collect distance: client triggers at 130m (`Math.min(distToUser, distToCompanion)`); server gates at 150m.
- Decay per 4-min tick: hunger -8, happiness -6 (config in `shared/balance.ts`).
- Bumps: paw +5 hunger / +12 happiness; bone +20 hunger / +18 happiness; quest waypoint +8 happiness; quest complete +25 happiness.
- Every collect/feed/advance UPDATE must `SET last_decay_at = NOW()` to prevent the decay cron from undoing the bump.

---

## 10. Lost-pet pipeline

- OLX scraper: hourly cron, 14 query variants (Ukrainian + Russian + generic). Parses listings, geocodes location strings (Google Geocoding API fallback), assigns urgency tier from listing keywords + age, stores. Dedup by `(source, source_external_id)`.
- Telegram + Facebook adapter interfaces defined but disabled (no secrets in pilot).
- Urgency tiers:
  - `urgent`: <24h since post or contains urgent keyword (помогите, терміново, please help).
  - `medium`: <7 days, normal tone.
  - `resolved`: marked resolved by admin or aged out (>30 days).
- `expires_at` set to `created_at + 30 days`. Listings past expiry hidden from map.
- Pin colour by urgency: red `#e84040`, amber `#d9a030`, grey `#888`.

---

## 11. Walks + radial menu

- Radial menu opens on companion tap. Levels:
  - Level 0: `walk`, `visit`, `search`, `chat`, `meet` (placeholder, shows "no walkers around yet").
  - Level 1 walk: `roundtrip`, `oneway`.
  - Level 2 walk: `close`, `far`.
  - Level 1 visit: `cafe`, `restaurant`, `bar`, `pet_store`, `veterinary_care`.
  - Level 2 visit: 3 closest spots in chosen category, by name.
  - Level 1 search: closest unresolved lost pet in range — selects it, opens modal.
- Walk destination picker: weighted random across candidates, each candidate's weight multiplied by `0.3` if visited in last 60 minutes (recent-visit penalty). Weights normalised before pick.
- Roundtrip route: outbound to destination, return via perpendicular nudge from destination 50m off the outbound axis. Three Directions API calls if needed (outbound, nudge-to-near-user, near-user-to-user).
- Walk distance:
  - `close`: 200-600m destination range.
  - `far`: 800-1800m.
- Routes plotted as polylines on the map, fit-to-screen with 60px padding.
- Parks-as-destinations: curated GeoJSON of Kyiv parks added to the destination pool with category `park`.

---

## 12. Search quests

- `/quests/start` → server picks 3 waypoints near pet's `last_seen_position`:
  - Spread evenly through the search circle (sample 3 random points within `search_zone_radius_m`).
  - Validate walkability (Directions API; if any leg fails, re-sample once, then accept).
- One Haiku call generates 3 clue strings at quest start. Stored in `quests.waypoints[i].clue`.
- Walking polyline plotted from user → wp1 → wp2 → wp3, fit-to-screen.
- Active quest pill on map dashboard shows current clue + abandon button.
- `/quests/advance` polled every 5s while quest active; if user position within 25m of next unreached waypoint, marks reached, awards bumps, returns next clue. Final waypoint completes the quest with reward.

---

## 13. Chat + AI

- LLM: Claude Haiku (Anthropic SDK).
- Each `/chat` call:
  1. Pull last 10 turns from messages table for this user.
  2. Pull `companion_state.memory_notes` (≤500 chars).
  3. Build system prompt: persona + actions grammar + memory + nearby pets context.
  4. Send to Haiku. Receive response.
  5. Parse `<<act:NAME:JSON>>` tags out of response text.
  6. Strip tags from text shown to user.
  7. Return `{ text, actions: [...] }` to client.
  8. Every Nth turn (N=5), kick off async memory summarisation Haiku call: input = recent turns + current memory note, output = updated note ≤500 chars, write back to DB.
- Action grammar (initial set):
  - `<<act:walk:{"distance":"close"|"far","shape":"oneway"|"roundtrip"}>>`
  - `<<act:select_pet:{"id":"<dog_id>"}>>`
  - `<<act:start_search:{"id":"<dog_id>"}>>`
  - `<<act:visit:{"category":"cafe"|"restaurant"|"bar"|"pet_store"|"veterinary_care"}>>`
- Client dispatches each action via the same handlers used by the radial menu / lost-pet modal.
- Greeting: once per JS session, on first map-tab focus, show `"woof! tap my logo top-left to learn what's what 🐾"`. Subsequent focuses show random woof from 18-variant pool.

---

## 14. Profile dog scene (`ProfileDogScene` + `ProfileSceneBackdrop` + `ProfileSceneBirds`)

- Container: 200px tall, full card width. `overflow: hidden`. Negative `marginTop: -18` and `marginLeft: -18` to break out of card padding.
- 3 parallax layers (factors 0.06, 0.18, 0.32) inside a single SVG viewBox 360×200.
- `GROUND_Y = 110` (where trees + bench stand). `FRONT_Y = 190` (where dog walks).
- Day palette: sky `#dbeaf4`, foreground `#c5e09a`, foliage `#88a878`, grass `#7ea850`, lamppost `#4a4a4a`.
- Night palette: sky `#1c2a44`, foreground `#2a3a4a`, foliage `#3a5a3e`, grass `#3e5236`, lamppost `#222`.
- Auto day/night: `isDayHour = h >= 7 && h < 19`, re-checked every 60s. Tap background → manual override.
- Sun: gold square cluster (`#f5b542`) at (290, 28) with stepped pixel-disc edges.
- Moon: pale square cluster (`#f0eee0`) with one crater pixel.
- Stars (night only): 7 fixed positions, 1×1 white squares.
- Lamppost light cone (night only): two stacked trapezoid polygons from bulb at `(160, GROUND_Y - 56)` to `(146-174, GROUND_Y + 5)`. No ground pool ellipse (earlier attempt read as stripe).
- Clouds: 4 `<g>` elements with per-cloud CSS keyframes, periods 28-42s, opposing translate directions.
- `ProfileSceneBirds` fires one ambient event every 6-14s. Day pool: bird flock (weight 5, 6.5-9.5s duration), butterfly (weight 2, 5.5-8s), falling leaf (weight 2, 4-6.5s). Night pool: bat (weight 3, 4.5-7s), firefly (weight 4, 5-8s), shooting star (weight 1, 0.9-1.3s).
- Bird flock: 2-4 birds, animated wing-flap via two opacity-keyed wing-frame groups + static body, `steps(1)` 320ms, per-bird negative `flapDelayMs` for desync.
- Dog state machine: 5-anim weighted pick with no-repeat guard. sitting weight 6 / 4-7.5s, lying weight 1 / 4-7s, sniffing weight 2 / 2.2-3.8s with `movePx: [30, 90]`, walking weight 3 / 3-5.5s, running weight 1 / 2-3.2s.
- Tap on dog: SpeechBubble + random reaction from `[{anim:'jumping', durMs:720, movePx:30}, {anim:'crouched', durMs:1200}, {anim:'sitting', durMs:1200}]`. State machine paused for `durMs`.
- Bark variants: 18 strings (woof!, bork!, *sniff sniff*, etc.). Single bubble at a time, 4500ms duration.
- Per-anim `ANIM_BOTTOM_OFFSET`: walking/running/sitting/jumping/crouched -25, sniffing +8, lying -5.
- Visual freeze on tap: read live transform via `getComputedStyle(el).transform` + `new DOMMatrix(...).m41`, snap both `setX` and `xRef.current` to that value before `setTransitionMs(0)`.

---

## 15. LostDogModal

- Bottom-sheet slide-up. Outer overlay: `paddingTop: 90`, `paddingBottom: calc(100px + env(safe-area-inset-bottom))`.
- Sheet: `maxWidth: 480`, `maxHeight: 100%`, `display: flex; flex-direction: column`, `overflow: hidden`, `borderRadius: 24`.
- **Photo banner:** 300px tall, full width, `flexShrink: 0`. `<img>` with `objectFit: cover; objectPosition: center center; transform: scale(1.04)`. Initial `opacity: 0`, fades to 1 in `onLoad` over 220ms.
- White-fade gradient at photo's bottom edge.
- Badge (top-left, floats over photo): pill with `🚨 URGENT` (red) or `⚠️ searching` (amber).
- Close button (top-right, floats over photo): 32×32 dark translucent circle.
- **Body** (`flexGrow: 1, overflowY: auto, minHeight: 0`):
  - Pet name (24pt 700).
  - Breed (13pt grey).
  - "last seen Xd ago".
  - One-line meta: `<Icon name="paws" size=14> complete search quest for {N} bonus pts`.
  - Side-by-side action pills (`flex: 1` each, `gap: 8`): "👀 i've seen them" (dark filled) + "🔍 start search" / "🔍 searching…" (outlined).
- **Prev/next chevrons:** 44×44 dark translucent circles, `top: 50%`, transform `translateY(-50%)`. Sit OUTSIDE the slide track.
- **Slide animation:** photo+body sit inside a slide-track div `key={renderDog.id}`. On prev/next/swipe, a `slideDir` state ('left' | 'right') is set BEFORE the parent's callback fires. The new track mount runs `slide-in-from-${dir}` keyframe (translateX ±22px, 280ms cubic-bezier). No opacity in keyframe. `slideDir` cleared on fresh open + close.
- **Swipe gesture:** touchstart records X, touchend computes delta. Threshold 60px. delta>0 → handlePrev; delta<0 → handleNext.
- **Photo preload:** on first modal open per session, `new window.Image(); img.src = url` for every dog in cycle list. Browser caches; subsequent swipes hit cache.
- Cycle list: from `MapView`, sorted by distance from user, wraps at ends. From `tasks.tsx` Quests tab, same.

---

## 16. SpotModal + AboutModal

- SpotModal: same slide-up family. Body: photo + name + category + rating + primary action `🚶 walk here` + secondary `🔄 roundtrip`.
- AboutModal: triggered by top-left logo tap. 8 rows describing the surfaces. Per-row icon (Icon component when name is in set, emoji fallback otherwise) + title + body. `paddingTop: 80`, `paddingBottom: calc(124px + env(safe-area-inset-bottom))`.

---

## 17. HUD pills (`StatusBar`)

- 4 frosted-glass pills, horizontal row, top of map.
- Pill height 38, border-radius 19, `backdrop-filter: blur(14px) saturate(160%)`, bg `rgba(255,255,255,0.85)`.
- Happiness: `<Icon name="sun" size=18>` + 0-100% with inner blue `rgba(0,60,255,0.85)` progress fill.
- Hunger: `<Icon name="bone" size=18>` + 0-100% with same fill.
- Paws: `<Icon name="paws" size=18>` + lifetime count.
- Spots toggle: `<Icon name="pin" size=18>` with `opacity: visible ? 1 : 0.45`. Tap toggles `gameStore.spotsVisible`.

---

## 18. Bottom tab bar (`(tabs)/_layout.tsx`)

- 5 tabs: Map (`name="index"`), Quests (`name="tasks"`), Chat, Spots, Profile.
- `tabBarStyle`: `position: absolute, bottom: 0`, frosted glass, `borderTopLeftRadius: 24`, `borderTopRightRadius: 24`, `tabBarHeight: 60`, slide animation between screens (`animation: 'shift'`).
- Custom `<TabIcon name={IconName} focused={boolean}>`: wraps `<Icon size={26}>` in a View with `filter: focused ? undefined : 'grayscale(1)'` and `opacity: focused ? 1 : 0.32`.
- Tab → IconName mapping: `index` → `map`, `tasks` → `task`, `chat` → `chat`, `spots` → `pin`, `profile` → `user`.

---

## 19. Custom icon set (`Icon` component)

- Path: `app/components/ui/Icon.tsx`. Wraps `<Image source={{ uri }} resizeMode="contain">`.
- `IconName` type: `'paws' | 'bone' | 'sun' | 'pin' | 'map' | 'chat' | 'task' | 'user'`.
- `URL` map: each name → `/icons/<name>.svg`.
- `SIZE_SCALE` map for solid-fill SVGs that ship with whitespace padding: `chat: 1.4`, `user: 1.4`. Other names default to 1.0.
- Component: `<Icon name size opacity? />` → `<Image style={{ width: size * SIZE_SCALE, height: size * SIZE_SCALE, opacity }}>`.

Wired into: HUD pills, bottom tab bar, `TokenMarker` (paws), `FoodMarker` (bone), profile companion-card meter pills, AboutModal rows, tasks daily-quest icons, LostDogModal reward meta line.

Other surfaces in v1: system emoji acceptable for radial menu, lost-pet badges, spot category pins, dynamic chat narration, ratings.

---

## 20. PWA setup

- `app/public/index.html` (overrides Expo `+html.tsx` if both exist):
  - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
  - `<link rel="manifest" href="/manifest.webmanifest">`.
  - `<link rel="apple-touch-icon" href="/icon.png">`.
  - `<meta name="apple-mobile-web-app-capable" content="yes">`.
  - `<meta name="apple-mobile-web-app-status-bar-style" content="default">`.
  - `<meta name="apple-mobile-web-app-title" content="шукайпес">`.
  - `<meta name="theme-color" content="#ffffff">`.
- `app/public/manifest.webmanifest`: name, short_name, icons (192, 512), start_url, display: standalone, theme_color.
- `app/public/icon.png` (512×512).
- All bottom sheets respect `env(safe-area-inset-bottom)`. All tab content bottom-padded for tab bar + safe-area.

---

## 21. Performance targets

- Map FPS ≥ 60 on Pixel 5 baseline.
- Server p95 latency ≤ 200ms on `/sync/map`, `/collect/*`, `/feed`, `/quests/advance`.
- PWA cold-start to first interaction ≤ 3s on Safari mobile over 4G.
- Total JS bundle ≤ 1.5 MB gzipped.
- No memory leaks: 30-min map session must have stable heap (≤10% growth).

---

## 22. Security

- Sessions: HttpOnly + Secure + SameSite=Lax cookies.
- CSRF protection on POST routes (token in header).
- Rate limits: per-user, in-memory or Redis-backed.
- Input validation on all bodies via Zod schemas.
- No PII beyond email + name. No precise position history retained beyond rolling 24h Redis anchor.
- OLX scraper: respects `robots.txt`, polite delays (1s between requests), User-Agent identifies the project.

---

## 23. CI/CD

- GitHub Actions on every PR: `pnpm install`, `pnpm -r typecheck`, `pnpm --filter app build:web`, `pnpm --filter server build`, `pnpm -r lint`.
- Auto-deploy on merge to `main`: Vercel deploys `app/dist`, Fly deploys `server/`.
- Drizzle migrations run on Fly boot via release_command.

---

## 24. Acceptance per surface

A surface is "done" when:
- Specified rendering matches the spec (visual diff against this doc's prose + screenshots if provided).
- All listed interactions work on iPhone Safari, iPhone PWA-installed, Android Chrome, desktop Chrome, desktop Safari.
- TypeScript compiles with no errors. ESLint clean.
- No console errors during a 5-minute exercise of the surface.
- Lighthouse PWA score ≥ 90 (Performance, Accessibility, Best Practices, SEO).

---

## 25. Out of scope (do not build)

Native iOS/Android apps. Push notification trigger logic. Multi-walker visibility. Skins. Sighting photo upload. Active TG/FB scrapers. Multi-city UI. Admin web UI. Languages other than Ukrainian. 3rd-party auth. Payments.

---

## 26. Deliverables

Per §18 of the original RFP brief: source repo, two deployed environments, CI/CD, migrations, seed data, READMEs, architecture doc, API doc, 2-hour hand-off, 30 days P1/P2 defect support.

---

## 27. References + assets provided

- 8-Bit Dogs sprite pack (commercial-use license, Black & White Dog variant).
- Curated Kyiv parks GeoJSON.
- Custom icon SVGs (paws, bone, sun, pin, map, chat, task, user) — pre-sourced from Flaticon Premium, commercial-use.
- Brand: name, logo nose icon, primary palette (frosted-white + retro-pixel companion).

---

*This is a binding specification. Any deviation from the listed numbers, paths, or behaviour requires written approval from the product owner before merge.*
