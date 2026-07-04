# шукайпес — State of Things & Road to Pilot

> A planning primer for a **fresh session**. This is the third of three docs;
> read them in this order:
> 1. **`AUDIT_BRIEF.md`** — ground-up architecture & how the system is built.
> 2. **`AUDIT_FINDINGS.md`** — grounded, code-referenced issues + remediation,
>    ranked P0–P3. (It also *corrects* three factual errors in the brief — see
>    its §0; trust it over the brief where they differ.)
> 3. **this doc** — where the product actually stands today, what "pilot"
>    needs to mean, and the road between the two.
>
> This doc does **not** repeat the architecture or the issue list — it points
> at them. Its job is product state + sequencing + the decisions only the
> humans can make. Where any doc disagrees with the code, **trust the code.**

---

## 1. Orientation (read this first)

**What it is:** a Kyiv **lost-pet search** app disguised as a gentle walking
game. You walk a real city with a pixel-art **AI companion dog** (a Claude
agent, not a chatbot); you collect paws/bones, do quests, discover partner
spots — and, the actual point, **lost pets reported around the city surface on
your map** so ordinary walkers become a distributed search network. Ships as a
**PWA** and a **Telegram Mini App**. Prod: `shukaypes.vercel.app` /
`shukajpes-api.fly.dev`.

**The one thing I'd tell a fresh planner:** the last several weeks of work went
almost entirely into the **game render** (Three.js city, volumetric fog, sun,
ground shadows) and **multiplayer presence** (see/poke other walkers, bots).
That work is real and now live in prod — but it's *atmosphere*, not the core
value. The **pilot-critical path is the find-a-pet loop and the data engine
that feeds it**, and those have had comparatively little recent attention. A
fresh plan should re-center there and treat further render polish as optional.

**Status in one line:** the *game* is genuinely playable and pretty; the
*lost-pet product* is built end-to-end but under-validated; the *pilot* is
undefined. The gap to pilot is mostly **decisions + trust/safety/privacy +
data-quality validation**, not big new engineering.

---

## 2. What's actually built and live right now

Labels: **✅ works** · **🟡 built but rough / unvalidated** · **🧪 experimental,
flag-live in prod** · **⛔ stub / not real yet**.

### Product surface (frontend)
| Area | State | Notes |
|---|---|---|
| Map + companion follow (GPS) | ✅ | Core screen; companion lerps to GPS, radial menu (quest/chat/feed/stats). |
| Token/food collect + hunger/happiness | ✅ | Decay + refill loop works. **But** collect distance is bypassable via a client `force` flag — see FINDINGS §2.3. *User says tap-to-collect is test-only and goes away at launch.* |
| Companion chat (Claude agent) | ✅ | Opus for active turns, Haiku ambient; 4-layer prompt, memory. Reachable by anon device-id users, lightly throttled (FINDINGS §6.2). |
| Quests / daily tasks / lore / spots | 🟡 | Present and wired; depth/tuning and content volume unvalidated at pilot scale. |
| **Lost-pet pins on map + search/sniff flow** | 🟡 | **The core.** Reports render; "sniff/locate" flow exists. Report→map→sighting loop needs an end-to-end validation pass (see §5). |
| Game render (Three.js city, fog, sun, shadows) | 🧪 | `GAME_RENDER = true` in prod. WebGL2-gated with a clean MapLibre fallback. *Perf/battery on low-end devices unmeasured.* |
| Multiplayer presence + poke | 🧪 | `MULTIPLAYER = true` in prod. Redis GEO, 8km radius, haptics. **30 bots** populate the map (`MULTIPLAYER_BOTS=30`). |

### Backend / data
| Area | State | Notes |
|---|---|---|
| **Lost-pet ingestion pipeline** | 🟡 | Hourly scrape cron over **OLX + Telegram channels (env-gated) + Facebook (2 seed groups)** → Haiku parse → dedupe upsert. Plus **real-time Telegram bot ingest** (a group post lands on the map immediately). This is the product's engine — see §5. |
| Auth | 🟡 | Telegram initData = strong. `x-device-id` = unverified/spoofable (FINDINGS §2.1). |
| Spawn / mapData / decay / cleanup crons | ✅ | In-process on one machine. |
| Postgres (no PostGIS — haversine scans) | 🟡 | No spatial index; fine now, a scaling ceiling later (FINDINGS §3.1). |
| Redis presence/cooldowns/cache | ✅ | Now eager-connects at boot (fixed an idle-reap); silent-degrades if down; **no uptime alert** (FINDINGS §4.1). |
| Rate limiting | ⛔ | Configured but applied to **no** mutating routes (FINDINGS §2.2). |
| CI gate | 🟡→✅ | Was none; **PR #274** adds real ESLint (react-hooks) + gates the Fly deploy on typecheck+lint. Frontend (Vercel) still ungated. |

### Infra
Single Fly `shared-cpu-1x / 512MB` in `fra` (Frankfurt), `min_machines=1`,
crons in-process. Postgres + Redis. Vercel for the web app (auto-deploy on
`main`, preview per branch).

### In-flight right now (open PRs)
- **#273** — ground shadows much fainter (shader constants).
- **#274** — ESLint + CI deploy gate (the first real quality gate).
- *(#272 lighter shadows already merged.)*

---

## 3. How we got here (and the imbalance to correct)

Recent PR history (≈#258–#274) is dominated by: warm sun + god rays →
daylight cycle → single-profile fog tuning → multiplayer presence → bot
behavior → building-avoidance → horizon-cull softening → **ground shadows**.
Plus two audits (brief + findings) and this doc.

That's a lot of **polish and atmosphere**. It made the app feel alive and
distinctive — a real asset for a demo. But it means the **pilot-defining
questions** (below) and the **core loop's real-world reliability** are where
the fresh energy should go. Treat the render/MP as "good enough to pilot,
freeze it" unless a pilot goal specifically needs more.

---

## 4. What "pilot" means — the central undecided question

Everything downstream depends on this, and it's **not yet decided.** The
planning session should lock it early. Key axes:

- **Audience & size:** just the founders + friends (a handful)? A closed group
  of ~20–100 Kyiv dog owners? An open Kyiv soft-launch?
- **Surface:** Telegram Mini App first (strong identity, native to the Kyiv
  audience, easier auth) or web/PWA first?
- **Core promise being tested:** is the pilot validating **"does the walking
  game retain people"**, or **"does the lost-pet network actually help find a
  pet"**, or both? These need different instrumentation and different
  minimum bars.
- **Real lost-pet data:** does the pilot run on **live** scraped/ingested
  reports (real owners, real stakes → real trust/safety/privacy obligations),
  or seeded/synthetic data for a mechanics-only test?
- **Bots:** keep the 30 presence bots for density, or turn them off for an
  authentic small-group test? (`MULTIPLAYER_BOTS=0` is a one-line switch.)
- **Success criteria:** what does a "successful pilot" concretely look like?
  (retention %, # reports ingested/accurate, # sightings submitted, a single
  real reunion, qualitative delight…)

My default recommendation, absent other info: **a small closed Telegram-first
pilot in one or two Kyiv districts, on real data, bots off (or clearly
labeled), instrumented for both retention and the report→sighting loop.** But
this is exactly what the fresh session exists to decide.

---

## 5. Gap-to-pilot, by dimension

For each: where it stands / what a pilot needs / is it a **pilot blocker** or
**can-wait**. (Issue IDs reference `AUDIT_FINDINGS.md`.)

### 5.1 The core loop: report → map → search → sighting → reunion
- **Stands:** ingestion lands reports on the map; sniff/search flow and
  sightings route exist.
- **Gap:** no evidence the *full* loop has been walked end-to-end with real
  data — e.g. a real owner's post is parsed correctly (species, last-seen
  location, photo), shows in the right place, a walker can submit a credible
  sighting, and the owner is notified. **Parsing accuracy and location
  correctness on real posts are the single biggest unknown.**
- **Verdict:** **PILOT BLOCKER.** This is the product. Needs a manual
  end-to-end validation pass on a batch of real Kyiv posts before any real
  user sees it.

### 5.2 Lost-pet data engine (quality & coverage)
- **Stands:** 3 sources + live TG ingest, Haiku parse, dedupe.
- **Gap:** coverage (are the right Kyiv channels/groups wired? `TELEGRAM_CHANNELS`
  is env-gated and may be empty), parse precision/recall, dedupe correctness
  across reposts, and **stale-report cleanup** (a found pet shouldn't linger).
- **Verdict:** **PILOT BLOCKER** for a real-data pilot; N/A for a synthetic
  mechanics test. Decide data mode first (§4).

### 5.3 Trust, safety & content
- **Stands:** parser strips contact info, refuses low-confidence posts.
- **Gap:** untrusted scraped text flows into the companion's LLM context
  (indirect prompt-injection, bounded — FINDINGS §6.1); no moderation of
  user-submitted sightings; no abuse handling on reports.
- **Verdict:** **Blocker-ish for real data** (you're republishing real people's
  posts + photos). At minimum: a human review/kill switch for ingested
  reports, and a takedown path.

### 5.4 Privacy & legal
- **Stands:** presence positions are ~25m-jittered.
- **Gap:** **live location of real walkers is broadcast to anyone within 8km
  with no opt-in/opt-out** (FINDINGS §2.4). Republishing owners' posts + photos
  has data-protection implications. No in-app privacy disclosure.
- **Verdict:** **PILOT BLOCKER for real users.** A presence opt-out (or
  presence-off for the pilot) + a basic privacy note is the floor.

### 5.5 Security & cost exposure
- **Stands:** —
- **Gap:** **compromised Google Maps key still committed** (FINDINGS §1.1, P0 —
  real billing exposure regardless of user count); unthrottled mutating routes
  (§2.2); Opus chat reachable by anon users (§6.2, the main $ lever).
- **Verdict:** **Maps-key rotation = do-now** (a 10-min Google Cloud task, not
  code). Rate limits + Opus cost caps = **pilot blocker** before opening to
  anyone who isn't a founder.

### 5.6 Infra, scale & ops
- **Stands:** one Fly machine handles the founders fine.
- **Gap:** no spatial index + spawn pipeline on the 15s hot path (FINDINGS §3.1,
  §3.2) cap the DAU ceiling; single machine can't replicate (crons not
  leader-elected, §3.3); no Redis uptime alert (§4.1).
- **Verdict:** **CAN WAIT** for a small pilot. These are the "if the pilot
  succeeds" scaling list, not the "can we pilot" list — with one cheap
  exception: point an uptime monitor at `/health/deep`.

### 5.7 Quality / regression safety
- **Stands:** typecheck in CI; **PR #274** adds lint + a real deploy gate
  (react-hooks error — the class that white-screened prod once).
- **Gap:** no client error tracking (crashes only surface when a human notices);
  frontend deploy still ungated; `MapView.tsx` is 2,665 lines (highest-risk
  file, FINDINGS §5.3).
- **Verdict:** **Merge #274.** Add basic client error tracking (Sentry-equiv)
  **before** real users touch the render — cheap, high-value. Refactor later.

---

## 6. A proposed road (raw material, not a fixed plan)

Sequenced so each phase unblocks the next. The fresh session should re-order
freely — this is a starting shape, not a commitment.

**Phase 0 — Decide (session 1, no code).**
Lock the pilot definition (§4): audience/size, surface, data mode (real vs
synthetic), bots on/off, success metrics. Everything else forks on this.

**Phase 1 — "Safe to show a real person" (must-haves).**
- Rotate + restrict the Maps key (FINDINGS §1.1). *[do-now, human task]*
- Merge the CI gate (#274) + add client error tracking.
- Presence opt-out or presence-off for the pilot (§2.4).
- Rate-limit mutating routes + a global Opus spend cap (§2.2, §6.2).
- Decide bots on/off; if a real-people test, likely off or labeled.

**Phase 2 — "The core product actually works" (the pilot's real content).**
- End-to-end validation of the report→map→sighting loop on **real** Kyiv posts;
  fix parse/location/dedupe/cleanup issues found (§5.1, §5.2).
- Wire the right Kyiv Telegram channels / FB groups; confirm coverage.
- A human review + kill switch + takedown path for ingested reports (§5.3).
- Owner-notification path when a sighting comes in (confirm it exists / works).

**Phase 3 — Run the pilot.**
- Instrument for the chosen success metrics. Small cohort. Watch, talk to
  users, iterate. Keep render/MP frozen unless a goal needs it.

**Phase 4 — Only if it works (scale & harden).**
- Spatial index / PostGIS; spawn off the hot path; Redis leader lock for a 2nd
  machine; device-id auth hardening; MapView refactor (FINDINGS §3, §2.1, §5.3).

---

## 7. Decisions only the humans can make

Consolidated so the session can rip through them:
1. **Pilot definition** — all of §4 (audience, surface, data mode, bots,
   success criteria). *Blocks everything.*
2. **Real vs synthetic lost-pet data** for the pilot. Drives trust/safety/
   privacy scope entirely.
3. **Telegram-first vs web-first.**
4. **Maps key** — who rotates it, and are we OK deferring the git-history purge
   (the rotation itself is the urgent part).
5. **Render/MP freeze** — agree to stop polishing atmosphere and lock it, or is
   a specific pilot goal dependent on more?
6. **Privacy posture** — presence opt-out vs presence-off; how we disclose data
   use to owners whose posts we republish.

---

## 8. Open unknowns to validate (not yet answered by code or docs)
- Parse **accuracy on real posts** (the core risk) — no measured numbers exist.
- Whether the wired ingestion sources actually **cover** the Kyiv lost-pet
  conversation (channel/group list completeness).
- **Perf/battery** of the Three render on low-end Android in the field.
- Real **latency/cost** of `/sync/map` under even a small concurrent cohort
  (the spawn pipeline is heavier than the reads — §3.2).
- Whether the **owner-notification / reunion** step is actually closed.

---

## 9. Pointers
- Architecture & file map → `AUDIT_BRIEF.md`.
- Ranked issues with file:line + fixes → `AUDIT_FINDINGS.md`.
- Product intent → `docs/PRODUCT_SPEC.md` (+ canonical `.docx`) — older than the
  render/MP work; trust code for anything technical.
- Live flags → `app/constants/experiments.ts`. Bot count / env → `fly.toml`.
- Core loop code → `server/src/{routes/{syncMap,sightings,dogs},services/{scrape,
  telegramIngest,mapData},pipeline/*}`, `app/components/map/MapView.tsx`.

*Written to be handed to a fresh planning session. Trust the code over every
doc, including this one.*
