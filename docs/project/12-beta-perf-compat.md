# 12 — Performance and compatibility for the open beta

Written 10 Sep 2026 against `c6265b9`, for the pass that shipped as the
`claude/performance-compatibility-beta-3s5f9g` branch. Two halves: what
was measured and changed, and what was seen along the way that belongs
to somebody else's session. Numbers carry their source; where a check
could not run here it says so.

## What a user actually downloads

Measured with `expo export --platform web` on this branch's parent
(`c6265b9`), sizes from the built files, gzip via `gzip -c | wc -c`:

| Asset | Raw | gzip | Note |
| --- | --- | --- | --- |
| `entry-*.js` (one script, everything) | 3.94 MB | 1.00 MB | Deferred; nothing paints until it has run |
| `maplibre-gl.css` | 70 KB | — | |
| `Annex-Regular.woff2` (preloaded) | 56 KB | — | |
| `logo-full.png` (React splash) | 81 KB | — | |
| `icon.png` (favicon + touch icon) | 81 KB | — | |
| `/fonts/**/*.pbf` glyphs | 2.7 MB total, 550 files | — | Fetched per range as the map pans |

The script by package (source-map-explorer over the same build):

| Package | KB (raw) | Why it is there |
| --- | --- | --- |
| maplibre-gl | 1027 | The map. Not negotiable. |
| three | 729 | The game render's buildings + ground fog. **Now a separate chunk** (below). |
| app code | 532 | |
| react-native-reanimated | 481 | Used by **one** component, `CardStack.tsx`. See flags. |
| react-native-web | 270 | |
| react-native-gesture-handler | 190 | Root view + the card stack |
| react-dom | 126 | |
| expo-router + react-navigation | ~300 | |

On the 3G a phone drops to in a metro entrance (~400 kbit/s effective)
the one-megabyte script is 20–30 seconds, and until this pass every one
of those seconds was a blank white page.

After this pass (same build command, this branch):

| Asset | Raw | gzip |
| --- | --- | --- |
| `entry-*.js` | 3.12 MB | 802 KB |
| `gameRender-*.js` (async, three.js + two layers) | 824 KB | 200 KB |

The total is the same on a device that runs the game render; the
difference is that the map no longer waits for the buildings chunk, and
a device without WebGL2 never downloads it.

## What a user downloads every 15 seconds

From `02-architecture.md` (measured in PR #422): `/sync/map` is ~27 KB
steady-state every 15 s and `/presence` ~4 KB every 3 s — roughly
**6.6 MB/hour on a walk**. Checked here: the server has no compression
plugin, nothing in `fly.toml` or Fly's proxy adds one, and the browser
sends `Accept-Encoding: gzip` on every request regardless. So every one
of those bytes crossed the air uncompressed. JSON of this shape
(repeated keys, coordinate arrays) compresses 4–6×.

Not measured against production in this session, deliberately: a
`/sync/map` call needs a device id, and a device id the server has not
seen **creates a `users` row**. `CLAUDE.md` says writes to `users` get a
dry run and a human first. The plugin's behaviour is well known and the
size claim is from the plugin's own semantics, not a probe. **Verify on
the first deploy** with `curl -sI -H 'Accept-Encoding: gzip'` against
`/sync/map` from a real session and look for `content-encoding: gzip`.

## What changed

Every item below is in this branch. File paths are where to look.

### Server

- **gzip on every compressible response** — `@fastify/compress`, gzip
  and deflate only, level 5, 1 KB threshold (`server/src/index.ts`).
  Brotli is deliberately off: its default quality is far too slow to run
  per request on one shared vCPU, and gzip-5 gets nearly all of the size
  win. Images from `/photos` are skipped by content type. Expected
  effect on the data bill above: roughly **6.6 → 1.5 MB/hour**; confirm
  with a real session.
- **The spawn pipeline is gated as a whole** (`shouldAttemptSpawn`,
  `server/src/services/spawnCooldown.ts`; used in
  `routes/syncMap.ts`). This is the first item under L-2 in
  `08-open-issues.md`. One Redis `SET NX PX` decides whether a spawn
  round is due — at most one per user per **30 s** (`SPAWN_ATTEMPT_GAP_MS`,
  env, default 30000; `0` disables the gate) — and a sync that is not due
  skips every probing query the two `ensure*` calls would otherwise make:
  the two expiry UPDATEs, the nearby-pets scan, the per-pool counts, the
  two cap UPDATEs. Fails open on a Redis outage like every other gate
  there. Behavioural change: a pool the walker is approaching seeds at
  most one tick later than before; at walking speed that is ~45 m inside
  zones hundreds of metres across. The per-pool gates still apply.
- **The Postgres pool is written down** (`server/src/db/index.ts`):
  `max` from `PG_POOL_MAX` (default 10 — the same as before, but now a
  knob), `connect_timeout: 10`. Item 2 under L-2.

### Shell (`app/public/index.html`, `vercel.json`)

- **A CSS-only splash** paints the wordmark in the brand font (already
  preloaded) the moment the HTML arrives, and admits "slow connection"
  after 12 s. The root layout removes it on mount. No JS — if the bundle
  never parses this is the last thing on screen, and it should not
  depend on the thing that failed.
- **The Telegram SDK script is `defer`red.** A blocking `<script>` in
  `<head>` stopped the parser until telegram.org answered — before a
  byte of our own bundle ran. Deferred scripts execute in document
  order and the app bundle is deferred too, so `window.Telegram` is
  still set before the app reads it.
- **Cache headers for `/fonts`, `/dog`, `/icons`** — a day, with a week
  of stale-while-revalidate. These had Vercel's default
  (`max-age=0, must-revalidate`): every glyph range the map asked for,
  and every dog sprite, was a conditional round trip per session. The
  `_expo` and `/assets` paths already had immutable caching; the
  public folder did not.

### Map (`app/components/map/`)

- **WebGL2 is asked for before MapLibre is constructed**
  (`app/utils/webgl.ts`; `MapView.tsx`). MapLibre GL JS v5 dropped
  WebGL1; the constructor throws, and until now that throw was a
  console line while the user sat on «шукаю себе…» forever. The floor
  this makes explicit: **iOS 15+, Android Chrome 56+ / a 2017-or-later
  WebView**, and the same inside Telegram (it uses the system engine).
  Below it, a localised message says so and what to do, with no retry
  button — reloading an iPhone 6 does not give it WebGL2.
- **The style fetch retries** (`crayonStyle.ts`): three attempts, 8 s
  each, 1 s / 2 s back-off. It was one bare `fetch` to
  `tiles.openfreemap.org`, and one dropped packet meant no map, ever,
  for that page load. On final failure MapView now shows «мапа не
  довантажилась» with a retry that re-runs construction.
- **Three.js is a separate chunk** (`gameRender.ts`, `layerIds.ts`).
  Metro splits `import()` on web export; MapView loads the chunk in
  parallel with the style and falls back to the classic render if it
  does not arrive. `app/tsconfig.json` gained `"module": "esnext"` so
  `tsc` accepts the dynamic import. `02-architecture.md`'s line that
  `three` "cannot be code-split" is corrected in this PR.
- **A governor for the self-driven repaints** (`repaintGovernor.ts`,
  used by `groundFogLayer.ts` and `fogLayer.ts`). Both animating layers
  asked MapLibre for the next frame from inside the current one on a
  fixed timer — 20 fps for the sun's rays whenever the sun was in view,
  and **30 fps unconditionally for the classic fog**, which is the
  render path that exists for the weakest devices. Each such frame
  redraws the whole map. The governor measures whether the frame it
  asked for arrived on time and backs the interval off (up to 6×) when
  it does not, honours `prefers-reduced-motion` (the sun holds still),
  and sleeps while the tab is hidden. The classic fog's base rate is
  now 20 fps. Item P2-14 is narrower now, not closed: the field cost is
  still unmeasured, but the loop no longer runs flat-out on a phone
  that cannot keep up.
- **`/presence` stops while the tab is hidden.** The 3 s loop was gated
  on navigation focus, not visibility — twelve hundred requests an hour
  from a pocket, each carrying the auth header. The 15 s sync loop
  already had this guard.

## Verified on this branch

```
pnpm -r typecheck     shared / server / app — clean
pnpm lint             22 problems (0 errors, 22 warnings)   (main: 23)
pnpm check            14 fixture checks — all pass
                      (52 routes: 49 limited, 3 knowingly exempt)
expo export --platform web
                      entry 3.12 MB / gameRender 824 KB, both hashed,
                      chunk referenced by absolute /_expo/... path
```

Not verified here, because it needs a device or production: that the
splash hands off without a flash on iOS standalone; that the WebGL2
message renders on a real iOS 14 device; the actual compressed size of
`/sync/map`; the governor's back-off on a real low-end Android. Each is
a five-minute check with the thing in hand.

## Flagged along the way — for other sessions

In scope for a beta, out of scope for this pass. Ranked by how much it
would matter in launch week.

| # | Finding | Where | Why it matters / suggested shape |
| --- | --- | --- | --- |
| F-1 | **The auth header is upload on every request.** Inside Telegram, `x-telegram-init-data` is ~0.5–1 KB and is sent on every call, including the 20/min presence poll — ~1 MB/hour of *upload* on a walk, and upload is the slow direction on mobile. The device-id path is tiny by comparison | `app/services/api.ts` `req()` | The fix is the same one P1-6 wants for security: exchange initData once for a short signed session token. Two birds. |
| F-2 | **reanimated is 481 KB raw (~120 KB gz) of the bundle for one component**, the lost-pet card stack. gesture-handler (190 KB) is needed by it too | `app/components/ui/CardStack.tsx` | A rewrite on RN `Animated` + `PanResponder` would drop ~600 KB raw. 720 lines and gesture-tuned, so not a launch-week change; after beta, with the design owner in the room. |
| F-3 | **No service worker.** An installed PWA with no network opens to the browser's error page — the immutable bundle is in the HTTP cache, but `index.html` revalidates. Also nothing pre-caches glyphs or sprites | `app/public/` | A minimal SW that serves `index.html` and `_expo/*` from cache, network-first for everything else. Post-beta; it changes how deploys roll out and needs a plan for stale clients. |
| F-4 | **Tile data per walk is unmeasured.** At the game pitch (60–80°) MapLibre pulls many more tiles than a flat view, from OpenFreeMap, and nothing here counts them. The API bill was measured to the byte; the tile bill never was | `MapView.tsx` construction, `balance.mapZoom*` | One walk with DevTools' network tab filtered to `tiles.openfreemap.org`. If it is large, `maxZoom`/`maxPitch` and MapLibre's `maxTileCacheSize` are the knobs. |
| F-5 | **Pet photos are served at whatever size the ad had.** OLX `photoUrl` is the CDN URL as scraped; the card stack renders it as a `background-image: cover` at card size, and the marker at thumbnail size — a 1280 px JPEG for a 56 px circle. 78 pets × ~150 KB is ~12 MB if all are viewed | `pipeline/sources/extractAdBody.ts`, `LostDogCardStack.tsx`, `LostDogMarker.tsx` | Check whether OLX's CDN URL takes a size parameter (many do: `;s=` suffixes). If yes, request a ~600 px variant for cards and ~120 px for markers. Measure first. |
| F-6 | **GPS is `enableHighAccuracy: true` for the whole session**, including while a modal, the chat tab or the radial menu is open. The accuracy is right for the walk; it is the battery's biggest single line item and nothing lowers it while the user is not walking | `app/hooks/useLocation.ts` | Drop to coarse (`enableHighAccuracy: false`, larger `maximumAge`) when the app is not on the map screen or has not moved for a couple of minutes; re-arm on the map. Product call on how it feels. |
| F-7 | **WebGL context loss is not handled.** iOS drops WebGL contexts under memory pressure or after a long background; MapLibre listens for `webglcontextlost` but the two custom layers and the three.js renderer hold GL objects that are gone afterwards. What the app does then is unknown | `groundFogLayer.ts`, `threeBuildingsLayer.ts`, `fogLayer.ts` | Test: open the map, background the phone for 20 minutes, come back. If the map is white, the cheap fix is `map.on('webglcontextlost')` → tear down and reconstruct. |
| F-8 | **`MapView.tsx` is 3,850 lines** and re-renders on every `idle` (three `setState`s per idle). Known as P2-10; this pass added ~90 lines to it because that is where the map is built | `MapView.tsx` | Unchanged advice: extract construction + render-stack setup into a hook before the next big feature lands there. |
| F-9 | **No spatial index on `lost_dogs`** (P1-4). At 78 active pets the haversine scan is nothing; at a few thousand, with a thousand walkers, it is a real query per sync | `services/mapData.ts` (`fetchNearbyLostDogs`) | Bbox columns + composite B-tree, the way territory did it. Not before the corpus grows. |
| F-10 | **One shared vCPU now also gzips.** Level 5 on ~30 KB is well under a millisecond, but it is new CPU on the same machine that runs every cron and thirty bots | `fly.toml` | Watch CPU on the Fly dashboard in launch week. If it is hot, `zlibOptions.level` down to 3 is the first lever, and it is still worth it. |
| F-11 | **The desktop preview column** (≥900 px) is not a target, and nothing in this pass looked at it | `index.html` | Fine for a beta aimed at phones. Noting so nobody reports a "bug" there as a regression. |
| F-12 | **`logo-full.png` and `icon.png` are 81 KB each.** The splash logo is fetched on every cold start after the bundle | `app/assets/`, `app/public/` | `pngquant`/`oxipng` would halve both. Minutes of work, tiny win; batch it with the next asset change. |
| F-13 | **The classic (non-three.js) render has never been screenshotted on a real WebGL2-less-of-three device.** It is the path an old Android gets, and the fallback code is exercised only when the game layers throw | `fogLayer.ts`, `MapView.tsx` | Set `GAME_RENDER = false` in a scratch build and look at it on a phone once before launch. |

## What this pass did not touch, and why

- **Presence jitter, consent (P1-1)**, the rival dials (P2-12), the
  chat ceiling (L-3): product and privacy decisions, not performance.
- **Brotli**: see above; the CPU is the scarcer resource.
- **The 15 s / 3 s cadences**: measured and reasoned in PR #351/#422;
  compression changes the bytes, not the reasoning.
- **A load rehearsal** against the bot fleet: needs
  `DEV_TOOLS_PASSWORD` set and a human watching, per `CLAUDE.md`.
