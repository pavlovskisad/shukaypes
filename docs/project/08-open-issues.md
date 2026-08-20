# 08 — Open issues

What is wrong right now, ranked. Where an item came from `AUDIT_FINDINGS.md`
its original ID is kept so the two can be read together.

Re-verified against the code at `43808c6` on 20 Aug 2026. Two weeks of work
(PRs #416–#494) closed most of this list — closed items are struck off at
the bottom rather than left to rot at the top, and the owner's live
checklist is `HANDOFF.md` §0.2.

---

## The blocking question

### Q-1 · The pilot is defined; the door is still open ⚠️
*Was "pilot is undefined" — resolved in shape during the 12–14 Aug pass.*

The answer: a **closed beta of roughly 50–150 testers**, invite-gated, on
real data, with a phased readiness plan. Phase 1 ("safe to hand to a
stranger") is complete server-side. What still stands between here and
invites is entirely the owner's checklist — the Maps key (P0-4), flipping
`INVITE_REQUIRED` after minting codes, `DASHBOARD_TOKEN` and
`DEV_TOOLS_PASSWORD`, a contact route (P0-5), and the presence-consent
decision (P1-1).

Still genuinely undecided from the old list: **bots on or off** for the
beta (30 currently on; `MULTIPLAYER_BOTS=0` is one line), and the **success
criteria** the beta will be judged by — though `/admin/metrics` now
computes DAU/WAU/retention/funnel, so the instrumentation no longer forces
the question.

---

## P0 — do before anyone outside the team touches it

### P0-1 · Parse accuracy on real posts has never been measured
*`PILOT_ROADMAP` §5.1 called this the pilot blocker in July. It is now the
**last** engine gap standing, and everything needed to close it exists.*

There is still no measured number for the core claim: that a real post
comes out of the parser with the right species, the right place and a
usable photo. The blockers that used to sit in front of it are gone — the
ad text is now stored (`raw_body`), so scoring a batch no longer means
re-fetching anything.

Two facts sharpen the urgency. **`parseDogPost` had been reading
CSS-polluted text all along** — every classification to date spent part of
its input on stylesheet noise, and whether that changed any verdict is
**unmeasured; do not claim an improvement without scoring it.** And the
first 94 ads the `created_at:desc` fix surfaced produced **zero pets**, all
rejected by the title filter — either the filter is too strict or those
queries surface non-lost-pet traffic, and `skip_reason` distinguishes
`title-filter` from `rehoming` well enough to settle it.

**What it needs:** score ~50 stored bodies against their parse output —
species, place, photo, and the reject reasons — and write the numbers down.
An afternoon, and the strongest slide a deck could carry.

### P0-2 · Ingestion works; coverage beyond OLX is still one source deep
*Rewritten 20 Aug. The two previous versions of this item — "no source is
producing pets" and then "OLX is half-blocked" — were **both wrong**, in
the same direction, for a month. See [`03`](03-lost-pet-engine.md).*

- **OLX** — **working, and was never blocked.** The 403s were a 50% coin
  flip (`403 200 403 200 …`) that a retry rescues; errors 7 → 0, discovery
  251 → 508. A separate saturation bug — relevance-ordered page one meaning
  the scraper had run out of new ads to see — was the real reason nothing
  arrived, fixed with `created_at:desc`.
- **`SCRAPE_PROXY_URL` should stay unset.** Residential exits were refused
  *more* than the datacentre, not less. There is nothing to buy here.
- **Telegram channel scrape** — still never configured. Free, unblocked,
  one env var, needs a curated channel list. **This is now the whole item**:
  OLX is a single point of failure and Telegram is the cheapest second leg.
- **Facebook** — parked; needs a burner account (`FACEBOOK_COOKIES`).
- **Telegram bot ingest** — works, but only ever pointed at test chats.

**Cheapest first, unchanged:** set `TELEGRAM_CHANNELS`.

### P0-3 · Four features are built and switched off for want of a value
*Each is one `fly secrets set`.*

| Secret | What stays dark without it |
| --- | --- |
| `ALERT_CHAT_ID` | The ingest alert. A source dying stays invisible until somebody reads the heartbeat by hand — exactly how the OLX problem survived a month. |
| `DASHBOARD_TOKEN` | `/admin/console` and `/admin/metrics` 401 for everyone, including the agent. Three questions during the 18 Aug session needed a deploy or a log tail because of this. |
| `DEV_TOOLS_PASSWORD` | `/dev` refuses everyone, so the walk simulator is off everywhere. |
| `INVITE_REQUIRED` | The beta door stays open. Mint codes first (`invite --new`); existing accounts are never gated. |

Collectively the highest value-per-effort on the list, and unchanged for a
week. Any random string will do for the two read-only ones.

### P0-4 · Compromised Google Maps key still committed — in a public repo
*`AUDIT_FINDINGS` §1.1 · `docs/TECHNICAL.md:236`,
`reference/shukajpes-demo.html:147`*

Still present at HEAD in two tracked files, and in history. Two facts
sharpened since the audit: **the repo is public**, and the committed key
**is the one serving production** (confirmed by hashing the committed value
against the deployed bundle). This is the only genuinely urgent owner item.

**Do the cheap half first:** a billing quota and a budget alert — touches
no key, caps what a harvested one can cost, precedent is ~$100 of Places
burned in days. Then restrict to HTTP referrers + only the APIs in use.
Rotation can wait until just before invites, and **the order matters or the
map goes dark**: new key → restrict → set in Vercel → redeploy → confirm
the map draws → only then delete the old one. History purge
(`git filter-repo` / BFG) last, alongside removing the demo HTML.

### P0-5 · Trust-and-safety is half-built: the operator can act, the owner cannot ask
*`PILOT_ROADMAP` §5.3 · takedown CLI landed in PR #424*

`expire:pet` closes the operator half — a takedown request can be honoured
in seconds, reversibly, checked against the source post. **The other half
is still missing:** there is no contact route on the landing, no address in
the app, nothing that guarantees an owner who minds can reach a human.
There is also still no proactive review of ingested reports and no
moderation of user-submitted sightings.

Minimum floor before invites: a visible contact path (a landing-page
change, not code). The owner is considering a support-ticket form.

**Raised since 17 Aug:** the app now *displays owners' contact details* to
walkers who report a sighting, and stores ad bodies containing them. That
is the owner's deliberate decision and the containment is enforced by a
source-level fixture check (D-47, D-48) — but it raises what a takedown is
worth, and sharpens the fact that the person whose phone number is in the
database has no way to reach us. Note `expire:pet` doubles as contact
removal, since expired pets 404 on the post route.

---

## P1 — before the pilot opens beyond the team

### P1-1 · Live walker positions are broadcast with no consent surface
*`AUDIT_FINDINGS` §2.4 · `services/presence.ts`*

Every active walker's position is written to a shared Redis GEO set and
returned to anyone within **8km** who asks. Jitter is a stable per-id offset
of ≤25m — good, in that averaging many reads will not de-jitter it, but 25m
in a residential block is identifying. **There is no opt-in, no opt-out, and
no in-app disclosure.**

**Fix:** a toggle that stops the client sending `mp=1` and the server
writing presence. Or presence off entirely for the pilot. Plus a basic
privacy note.

*(P1-2 — unthrottled mutating routes — is closed; see the bottom. It turned
out to be worse than filed: the limits that did exist were silently global.)*

### P1-3 · `force: true` still bypasses every distance check — now a standing decision
*`AUDIT_FINDINGS` §2.3 · `tokens.ts`, `food.ts`, `quests.ts`*

A client-supplied boolean gates the distance check on collect, feed and
quest advance; the UI sends `force: true` on taps. **The owner decided on
13 Aug to keep it** while the collection animation is tuned (D-42), so this
is no longer a pending fix but a recorded trade with one consequence:
**beta collection counts will not prove anybody walked.** `search_results`
and distance still will. Rate limiting being per-user now means it at least
cannot be done at machine speed against a shared bucket.

### P1-4 · No spatial index on `lost_dogs`
*`AUDIT_FINDINGS` §3.1*

`fetchNearbyLostDogs` filters `status='active'` then computes haversine over
every survivor, on every `/sync/map`, per user, every 15s. Cost grows with
(active pets × concurrent walkers).

Note that territory solved the same problem differently and well — bbox
columns plus a composite B-tree, no extension needed. The same shape would
work here.

### P1-5 · The spawn pipeline runs on the 15s hot path
*`AUDIT_FINDINGS` §3.2 · `syncMap.ts` awaits `ensureTokensForUser` +
`ensureFoodForUser` before every read*

A single `ensureTokensForUser` can issue an expire UPDATE, a load SELECT, a
user-area count and insert, a nearby-dogs SELECT, then a count and insert
per nearby dog and per park, and a final cap UPDATE with `OFFSET`. Easily
8–15 round trips per sync per user, on a default pool of ~10 and one shared
vCPU. The Redis cooldowns throttle the *inserts*; the probing still runs
every tick.

**Fix:** gate the whole spawn attempt on the Redis cooldown *before* any
probing query.

### P1-6 · `x-device-id` is unverified identity
*`AUDIT_FINDINGS` §2.1*

Any string of 8–128 chars is accepted as an identity and resolves or creates
a `users` row. Presenting somebody's device id **is** logging in as them.

Mitigating: device ids are client-generated random hex, so this needs the id
to leak (shared device, XSS, logs), and there is no cross-user IDOR — every
mutating route re-checks `ownerId === req.userId`. The Telegram path is
properly signed and fine.

**Fix:** treat device-id accounts as throwaway (they already cannot merge),
and require the Telegram-signed identity for anything with real value. If
device-id must stay first-class, issue an HMAC token on first contact.

*(P1-7 — client error tracking — and P1-8 — the ungated frontend deploy —
are both closed; see the bottom.)*

*(P1-9 — parse accuracy — was promoted to **P0-1**: it is now the last
engine gap, and the ad text it needed is stored.)*

### P1-10 · Found strays and lost pets share one presentation
*Raised 18 Aug, partly addressed by PR #480*

Ads where somebody has *found* an animal are ingested on purpose — a found
stray needs its owner found — but they were displayed under «загублені»
with «терміново», asking a walker to go search the streets for an animal
already in somebody's flat. They are now flagged (`is_found_report`) and
kept off the map, which stops the wrong ask but also means **that half of
the corpus currently does nothing.**

The product decision is open: give them their own badge and a different
call to action («знаєш чий це?» rather than «шукати»), or drop them from
ingest entirely. The schema deliberately keeps them so the first option
stays available.

---

## P2 — worth doing

| ID | Issue | Where |
| --- | --- | --- |
| P2-1 | **Pets on the fallback pin cannot be drawn.** The geocoding-failure population — 81 of 244 before the base refresh; **not re-measured against the current 78 active.** Rescuing them needs precision work on the gazetteer *measured before anything is written* — see the trap in [`03-lost-pet-engine.md`](03-lost-pet-engine.md) | `pipeline/parser.ts` |
| P2-17 | **One pet has `last_seen_at` 94 days in the future**, printed as `-94d ago`. It would dodge the staleness sweep for six months. A parser date bug, not traced | `pipeline/parser.ts` |
| P2-18 | **`--sample=N` draws from an unshuffled list**, so it reported "4 of 5 ads are live" when the true rate was nearer 1 in 3. A biased estimate presented as a measurement | `db/*.ts` |
| P2-2 | **No uptime monitor on `/health/deep`.** It exists and returns 503 correctly; nothing watches it | ops |
| P2-3 | **Redis has no uptime alert** and silently degrades everywhere. Also unconfirmed whether the current tier is persistent or another idle-reapable free database | `AUDIT_FINDINGS` §4.1 |
| P2-4 | **`spawnCooldown` fails open when Redis is down** → every 15s sync re-spawns, no cooldown, no claim lock. Global caps bound the on-screen count but not the write churn. (The chat budget now fails open the same way, as a stated decision — D-34) | `AUDIT_FINDINGS` §3.4 |
| P2-6 | **Telegram photo proxy is rate-limited but still an open egress path.** Any `file_id` the bot can resolve is fetchable, not just ingested ones. Bounded (ids are opaque and bot-scoped) | `AUDIT_FINDINGS` §2.6 |
| P2-7 | **Untrusted scraped text reaches the companion's LLM context.** Rendered in RN `Text` so no XSS, but indirect prompt injection is possible. Worst case is the companion saying something off-script | `AUDIT_FINDINGS` §6.1 |
| P2-9 | **Single machine, in-process crons, no leader election.** A second replica would double every cron and run 2×30 bots. A Redis leader lock is the one change that unblocks it | `AUDIT_FINDINGS` §3.3 |
| P2-10 | **`MapView.tsx` is ~3,400 lines** — the highest-risk file in the repo, mixing map init, marker layout, territory render, multiplayer culling, supersniff and camera control | `AUDIT_FINDINGS` §5.3 |
| P2-11 | **Territory decay is undesigned.** Ground only ever ratchets upward. Deferred by the owner; the motive is real — with no decay a city eventually saturates | [`04-territory.md`](04-territory.md) |
| P2-12 | **The rival dials are now 47% of what a sync costs.** `rivalMarksPerOwner: 24` + `rivalPiecesDrawn: 140`; halving them is another ~23% off the data bill. Left alone deliberately — it changes how dense the map *looks*, which is the art director's call. (The old "~52MB/hour" figure here was ~4× too high; measured reality was ~13MB/h, now ~6.6) | PR #422 |
| P2-13 | **Render flags are compile-time constants.** `GAME_RENDER` / `MULTIPLAYER` cannot be turned off without a rebuild and redeploy. The server has a `MULTIPLAYER=off` kill switch; the client cannot match it | `AUDIT_FINDINGS` §5.1 |
| P2-14 | **Perf and battery of the Three.js render on low-end Android is unmeasured.** WebGL2 fallback is handled well; the cost of the continuous fog repaint in the field is not known | `PILOT_ROADMAP` §5.6 |
| P2-15 | **CORS reflects any origin** (`origin: true`). Low risk — auth is header-based, so a malicious site has neither the device id nor the initData — but pinning is free | `AUDIT_FINDINGS` §2.7 |
| P2-16 | **`groundIn` takes 240 pieces with no `ORDER BY`.** Harmless at current fragmentation; will bite eventually | `services/territory.ts` |

## P3 — cleanup

| ID | Issue |
| --- | --- |
| P3-1 | **Large binaries committed to the repo** — `8-Bit Dogs.rar`, `SHUKAYPES_SVG_ICONS.zip`, `kalam.zip`, a 929KB HTML file, `reference/shukajpes-demo.html` (380KB), the product `.docx`. No build role. Best removed alongside the P0-4 history rewrite so there is only one force-push. |
| P3-2 | **Third-party pixel-art asset licensing unconfirmed.** The README claims free-for-commercial with no attribution required — verify and keep the license text in-repo before a public launch. |
| P3-3 | **Scrape tick history is in-memory only.** Gone on every restart. |
| P3-4 | **Stale schema comments.** `tokens` claims "PostGIS point added via raw SQL migration"; there is no PostGIS. `lost_dogs.source` says `scrape | in_app`; the column actually stores `olx`, `telegram:<channel>`, `admin-sideload`. |
| P3-5 | **`shared` types are duplicated at runtime.** The server never resolves the package and defines its own copies of the wire types, so a wire change has to be made twice. |
| P3-6 | **Territory mood gates are off** (`minHappiness: 0`, `minHunger: 0`). Restoring them to ~30/15 re-wires territory into the bones economy; the code that reads them is untouched. |

---

## Closed since the July audits

Kept so nobody re-files them.

### Closed by the engine rescue (15–20 Aug, PRs #433–#494)

| Was | Now |
| --- | --- |
| "OLX is half-blocked, buy a proxy" | ✅ **The diagnosis was wrong.** Not a block — a 50% coin flip, fixed by re-enabling a retry that was already in the code. Errors 7 → 0. A residential proxy was measured to be *worse*, so the pending purchase is cancelled. |
| "Coverage is degraded but pets are arriving" | ✅ Also wrong, in the other direction: after the retry fix, discovery doubled and **still produced nothing**, because the scraper had saturated against relevance-ordered page one. Fixed with `created_at:desc`. |
| The corpus had never been checked against reality | ✅ 221 active → 78, with a deleted ad taken as the found-signal. `ad_alive_at` (migration `0036`) stops the age sweep expiring pets whose owners are still renewing live ads. |
| The ad body was stored nowhere | ✅ `raw_body` (migration `0034`), served one pet at a time by `/dogs/:id/post`. Which then exposed that every stored body was mostly CSS — fixed and repaired, with `check:ad-extract` pinning it. |
| No way to answer "is this actually the dog?" mid-search | ✅ `PostModal` reads the owner's real ad, contacts redacted until a sighting is reported. |
| Found strays presented as pets to search for | 🟡 Flagged and hidden (P1-10); their own screen is a product decision still open. |
| A walk could not happen without a Google Places key | ✅ `/walk/destinations` serves our own tables; the route line falls back to dashed straight segments that keep the stops. |
| Walks could send you to the vet | ✅ Errand categories removed from the destination pool entirely, not merely outranked. |
| The app never said what it was for | ✅ The dog asks first; the logo rotates three modes (PR #494). |

### Closed by the beta-readiness pass (12–14 Aug, PRs #416–#430)

| Was | Now |
| --- | --- |
| P1-2 — mutating routes unthrottled | ✅ Closed by #417/#418, and it was worse than filed: the limits that existed were **global**, one bucket for the whole service behind Fly's proxy. Now per-user (`hook: 'preHandler'` + `trustProxy`), 45 routes tiered, `check:route-coverage` in CI. |
| P1-7 — no client error tracking | ✅ Closed by #419. Root `ErrorBoundary` + global handlers → `POST /client-errors`, self-hosted, capped, deduped. |
| P1-8 — frontend deploy ungated | ✅ Closed by #425. Vercel's build command runs typecheck + lint and fails on either; its first catch was the commit that added it. |
| P2-5 — public `/stats` leaks pipeline internals | ✅ Closed by #417, and it was worse than filed: it was republishing bot-ingested users' **private Telegram DM text** (`scrape_log.title`, contact-stripping not applied). Now bearer-gated. |
| P2-8 — Opus reachable with no spend cap | ✅ Closed by #417. Per-user daily (50), global daily (1,000), ambient cap (300), `CHAT_DISABLED` kill switch. Fails open on Redis, loudly (D-34). |
| P2-13 (partial) — no way to kill features without a deploy | 🟡 Chat now has a no-deploy kill switch; `GAME_RENDER` / `MULTIPLAYER` are still compile-time. |
| Places request cost unbounded | ✅ Closed by #417. Radius clamped to 2000m, Kyiv-bbox-validated coordinates, capped fan-out — one crafted request could previously trigger 935 Google calls (~$30). |
| Device-id door open to anyone | 🟡 Invite gate built (#417), exhaustively checked, **dormant** — `INVITE_REQUIRED` unset is the owner's call. Also fixed the first-launch 500 (auth race on a UNIQUE column). |
| Dedupe over-merging real pets | ✅ Closed by #416 — three of four "duplicate" pairs were different animals; the rule now refuses on thin evidence (D-32). |
| Search funnel uncomputable | ✅ Closed by #421 — `search_results` records every completed search from 14 Aug. |
| No takedown tool | ✅ Operator half closed by #424 (`expire:pet`). The owner-facing contact route is still open — P0-5. |
| Lost-pet cleanup cron never fired | ✅ Closed by #425 — runs at boot now, like its siblings. |
| Fixture checks existed, nothing ran them | ✅ Closed by #416 — `pnpm check` in CI on PRs and before deploy. |
| Dev affordances in the public build | ✅ Closed by #420 — `/dev` + server-checked password; destructive routes verify server-side. |
| Auth returning 500 for every failure | ✅ Regression from this same pass, closed by #428. 401/403 pass through; the invite-gate door screen depends on it. |

### Closed earlier

| Was | Now |
| --- | --- |
| `AUDIT_FINDINGS` §5.2 — ESLint referenced but not installed or configured | ✅ Fixed by PR #274. Root `eslint.config.mjs`, `eslint-plugin-react-hooks`, `rules-of-hooks` as an **error**. Verified: 0 errors, 21 warnings. |
| `AUDIT_FINDINGS` §4.2 — `deploy.yml` does not gate on typecheck | ✅ Fixed for the server by PR #274 (`server` job `needs: checks`), for the frontend by PR #425. |
| `AUDIT_BRIEF` §10.4 — Redis idle-reap | ✅ Fixed by PR #265 (eager boot connect + status guards + log throttle). Uptime alerting still missing — P2-3. |
| `AUDIT_BRIEF` — "PostGIS is in use" | ✅ Corrected. There is no PostGIS and that is now a stated decision, not an oversight — see D-06. |
| `AUDIT_FINDINGS` §1.2 — Google Places called from the client | ✅ Fixed. `services/placesCache.ts` proxies and caches server-side. Only Routes is still called from the browser. |
| "Both Telegram sources are dead, nobody has looked at why" | ✅ Wrong on both counts. Corrected by PR #411 — one is the owner's test chats behaving as expected, the other has never been configured. |
| "Rotate `REPORT_TOKEN`" filed as top priority | ✅ Resolved by removing it (PR #408). A lesser key is only a boundary against a holder who lacks the greater one. |
| Silent scrape ticks | ✅ Fixed by PRs #402/#403. A tick that discovered items, ingested none and errored no longer logs as complete. |
| Out-of-city pets entering the table | ✅ Gate closed at parse time by PR #409, and 17 existing rows swept. Two ambiguous rows deliberately left alone. |
| Eleven-hour silent outage with no detection | ✅ `services/watchdog.ts`. Converts a silent permanent outage into a visible restart loop. |
| Territory leaderboard timing out and taking `/health` with it | ✅ Fixed by PR #363. It is a `GROUP BY` now. |
