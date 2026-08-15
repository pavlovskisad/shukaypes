# 10 — Product brief & running costs

Written 15 Aug 2026, for business and strategy work. **Self-contained on
purpose** — it repeats things the other docs say so it can be handed to
someone (or a planning session) that reads nothing else. Where a number is
measured it says so and carries its date; where it is an estimate it says
that too, and estimates use public list prices as of mid-Aug 2026.

Monetisation, market sizing and fundraising strategy are deliberately out
of scope — this is the factual substrate for that work, not the work.

---

## 1. The product, in one page

**шукайпес** ("shukaypes" — "search-pets" in Ukrainian) is a lost-pet
search network for Kyiv, delivered as a walking game.

The user walks their real city with a pixel-art **companion dog** — a
Claude-powered agent that follows their GPS on a stylised 3D map, talks,
remembers, eats, and marks territory. Around that companion sit three
loops:

1. **The walking loop.** Collect paws and bones, keep the dog fed and
   happy. Produces daily walking.
2. **The territory loop.** The dog claims ground as you walk; rivals can
   take it; there is a city-wide standing and passive perks on your own
   streets. Produces *coming back*.
3. **The search loop — the point.** Real lost-pet posts from public
   sources are parsed into structured records with locations and surfaced
   to walkers near them. The dog leads a walker along a route to a search
   zone; at the end it asks *did you see them?* — and **both answers are
   recorded and rewarded**, because a zone confirmed empty is information
   too. A confirmed sighting can move the pet's pin.

The game is not decoration on the search: it is the recruitment and
retention layer. A person who walks daily because their dog is fun to walk
is a searcher who covers ground daily. In the other direction, the search
gives the game something no competitor's collectible loop has — the
occasional chance of genuinely mattering to a real family.

**Surfaces:** a PWA (`shukaypes.vercel.app`) and a Telegram Mini App —
one codebase, one deployment. **Market:** Kyiv, Ukrainian-first UI.

**What makes it defensible** is not any single mechanic but the data
engine underneath: an ingestion pipeline (marketplace listings, Telegram
channels, a real-time bot) → LLM parsing with local-knowledge geocoding →
dedupe tuned against real Kyiv data → a curated 16k-place gazetteer of the
city. That machinery is city-specific and compounding, and it is the part
a copycat cannot lift from screenshots.

## 2. Where it stands (15 Aug 2026)

**Built and live:** the full game (map, companion, chat, quests,
territory, multiplayer presence with 30 labelled bots), the full search
flow, the ingestion pipeline, an admin metrics console, crash reporting,
per-user rate limiting, LLM spend ceilings, an invite gate. The
engineering posture is unusually disciplined for the stage: CI gates both
deploys on typecheck + lint + seven fixture checks, data mutations are
dry-run-first, and production numbers separate bots from humans
structurally "because these numbers are going into a fundraise".

**The declared next step** is a **closed beta of ~50–150 invite-gated
testers on real data.** Phase 1 of that plan ("safe to hand to a
stranger") completed 12–14 Aug. What remains is an owner checklist:
rotate/restrict the one compromised Google Maps key, mint invite codes and
flip `INVITE_REQUIRED`, set three one-value config secrets, add a contact
route, and decide the presence-privacy posture.

**The two honest gaps**, unchanged for a month and named in every internal
doc:

- **No ingestion source is currently live.** OLX (the only source that
  has ever produced real pets, 2–9/day measured) is blocked by a WAF; the
  fix is a ~$10–50/mo managed proxy plus one env var, seam already built.
  Telegram channel scraping is free, verified working, and needs only a
  curated channel list. So this is days, not months — but today the pet
  table is aging.
- **Parse accuracy on real posts has never been measured.** The core
  claim — a real post comes out with the right species, place and photo —
  has no number behind it. An afternoon of work; also the strongest slide
  a deck could carry.

**Data as of the last count:** 244 active lost-pet records (real posts,
no synthetic data in production); ~543 registered accounts (drive-by web
visitors included — the product has never been promoted); measured chat
usage is near zero because nobody has been invited yet.

## 3. What it costs to run

### 3.1 The shape of the costs

The striking fact for a business model: **the marginal cost of a user is
almost entirely the LLM chat, and everything else rounds toward zero until
discrete step-ups.** Three deliberate engineering choices produced that:

- **Map tiles are free.** OpenFreeMap vector tiles with a hand-written
  style — no Google/Mapbox per-tile bill, which is usually the dominant
  cost of a map-centric consumer app.
- **Google Places is server-cached** by map cell (a bounded ~3,600-cell
  domain for all of Kyiv, 14-day TTL): the first user to look at an area
  pays the Google call, everyone after reads the cache. Before this
  existed, direct client calls burned ~$100 in days; after hardening
  (Aug 2026), the worst *crafted* request is capped too.
- **Geocoding is done by the parsing LLM** against an in-prompt landmark
  grid + the gazetteer — no paid geocoding API at all.

### 3.2 Current actuals (pre-beta, measured or near-measured)

| Item | Monthly | Basis |
| --- | ---: | --- |
| Fly.io — 1× shared-cpu-1x / 512MB VM, always on (`fra`) | ~$3–6 | List price + trivial egress |
| Supabase Postgres | $0 | Free tier; DB well under limits |
| Upstash Redis | $0 | Free tier (noted as flaky; app degrades gracefully without it) |
| Vercel (web hosting + CDN) | $0 | Hobby tier |
| Anthropic API | ~$1–5 | **Measured:** 3 Opus chat turns in 7 days across the whole service; Haiku parsing ≈ $0.001/call at ~4 ad fetches/day; Haiku ambient bubbles |
| Google Maps (Places server-side + Routes client-side) | ~$0 | Within Google's monthly free credit at current volume |
| Telegram Bot API, GitHub Actions CI | $0 | Free |
| **Total today** | **≈ $5–10** | Effectively one small VM plus pennies of LLM |

There is currently no custom domain (~$15/yr when bought) and no paid
monitoring, crash-reporting or analytics service — metrics and crash
reports are self-hosted in the same VM and logs, by decision.

### 3.3 The one pending purchase

**A scraping proxy for OLX: ~$10–50/mo.** The volume is measured and
small — ~9,500 requests/month, low single-digit GB — so the recommendation
on file is a managed unblocker in proxy mode (the provider absorbs WAF
changes) rather than raw residential IPs. This is the only money currently
standing between the product and its primary data source.

### 3.4 Closed beta (50–150 testers) — estimate

| Item | Monthly | Notes |
| --- | ---: | --- |
| Fly.io | $5–10 | Same VM; egress grows but a walk costs the server ~6.6MB/h/user (measured, after the Aug data-diet halved it) — 150 daily walkers ≈ 30GB/mo ≈ $0.60 |
| Scrape proxy | $10–50 | The purchase above |
| Anthropic API | $10–60 | **The swing factor** — scales with chat engagement, which is unknown until real users exist. Bounded hard: 50 Opus turns/user/day, 1,000/day global, ambient capped, kill switch. The global ceiling caps worst-case spend at roughly $30–80/day; typical engagement lands orders of magnitude below it |
| Upstash Redis | $0–10 | Presence + counters may outgrow the free tier; pay-as-you-go |
| Google Maps | $0–15 | Routes (walking routes) is the only per-user Google call; likely within free credit |
| Supabase / Vercel | $0 | Still inside free tiers |
| **Total at beta** | **≈ $30–150** | Dominated by proxy + LLM; everything else ≈ today |

### 3.5 If it grows (≈1,000 DAU) — rough sketch

Fixed infra steps up in known increments: Supabase Pro **$25**, Vercel Pro
**$20**, a larger or second Fly VM **$10–40** (a second machine requires
one known engineering change — a Redis leader lock around the cron jobs).
Data egress at 1k daily walkers ≈ 200GB/mo ≈ **$4**. Google Routes may
exit the free credit: low tens of dollars.

The LLM line is the honest unknown, because it is an engagement number,
not an infrastructure number. Bracketing it: if an average DAU spends 1–3
Opus turns/day (with prompt caching), that is very roughly **$0.5–3 per
monthly-active user per month**, i.e. **$500–3,000/mo at 1k DAU** — with
three levers already built if that is too hot: shift more of the
conversation to Haiku, lower the per-user budgets, or gate Opus behind the
signed-identity tier. Everything except the LLM totals **under
~$150/mo at 1k DAU.**

Engineering headroom on the current single-machine design was estimated in
the July audit at ~5–15k DAU before the known ceilings (no spatial index
on the pet table, spawn work on the hot path) need paying down — both have
mapped fixes.

### 3.6 Cost risks worth knowing about

- **The committed Google Maps key** (public repo, live key) is the one
  uncapped liability until the owner sets a billing quota — precedent
  exists (~$100 burned in days in an earlier incident). A ten-minute
  Google Cloud task.
- **Redis is free-tier and flaky.** The app survives outages by design,
  but two spend-control systems (chat budget, spawn cooldowns) *fail
  open* without it — deliberately, and loudly logged. A paid Redis
  (~$10/mo) removes the wobble.
- **Prompt caching matters.** The companion's system prompt was
  deliberately sized past the model's caching minimum; losing that (e.g.
  by a model migration done carelessly) would multiply chat input cost.

## 4. The numbers that exist for a deck, and the ones that do not

**Exist, measured:** ingest volume (2–9 pets/day from one source, no zero
days in 21); the pet table (244 active); wire cost of a walk (6.6MB/h);
sync latency (<20ms steady state); the fact that every user-facing metric
excludes bots structurally. From 14 Aug, the search funnel (every
completed search, found or not) accumulates in `search_results`, and
`/admin/metrics` computes DAU / WAU / D1 / D7 / funnel / LLM spend on
demand — with retention refusing to print percentages on cohorts under
ten, so small-beta numbers cannot quietly mislead.

**Do not exist yet:** any retention or engagement number (nobody has been
invited); parse accuracy (§2); coverage of the Kyiv lost-pet conversation
(how much of it the wired sources actually see); and any reunion story —
the single most valuable artifact a pilot could produce.

## 5. One paragraph of positioning raw material

The mechanics rhyme with Pokémon GO (walk, collect, territory) and the
category has proven that walking games retain; the difference is that the
"Pokémon" here are real animals whose owners are searching for them, which
changes the emotional register, the press story, the partnership surface
(shelters, vets, pet shops — the Spots system already maps them), and the
civic-tech funding angle in a Ukrainian context. The nearest functional
competitors are lost-pet Telegram channels and Facebook groups — which are
exactly what the product ingests, positioning it as a layer over the
existing ecosystem rather than a replacement for it.

---

*Numbers verified against the codebase and PR record at `8266bc6`,
15 Aug 2026. For depth: product detail in
[`01-product.md`](01-product.md), architecture in
[`02-architecture.md`](02-architecture.md), the data engine in
[`03-lost-pet-engine.md`](03-lost-pet-engine.md), open risks in
[`08-open-issues.md`](08-open-issues.md).*
