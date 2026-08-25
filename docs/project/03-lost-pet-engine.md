# 03 — The lost-pet engine

This is the product. Everything else is the reason people walk.

A public post by an owner becomes a structured record with a location, on a
map, in front of somebody who is out walking near it. Four stages: **fetch →
parse → gate → upsert**. Each stage can silently do nothing, which is why
most of the recent work has been about making silence audible.

## Sources

`services/scrape.ts` runs every source in sequence, hourly, jittered
30–120s after boot so a deploy doesn't cause a thundering herd. A source
failing does not starve the others. The whole cron skips if
`ANTHROPIC_API_KEY` is missing, because the parser would throw anyway.

| Source | File | Status (verified 25 Aug 2026) |
| --- | --- | --- |
| **OLX** | `pipeline/sources/olx.ts` | **Working — and it was never blocked.** The 403s were a 50% coin flip; a retry fixed them and listing coverage doubled. Then a second, larger problem was found and fixed: the scraper had run out of page. See below. |
| **Telegram (channel scrape)** | `pipeline/sources/telegram.ts` | **Unconfigured.** `TELEGRAM_CHANNELS` is unset, so the source is a no-op. Not blocked — verified reachable from the Fly IP. |
| **Telegram (bot webhook)** | `routes/telegram.ts` → `services/telegramIngest.ts` | Working, but only ever pointed at the owner's own test chats. |
| **Facebook** | `pipeline/sources/facebook.ts` | **Parked.** Needs a burner account (`FACEBOOK_COOKIES` unset; logs one expected error per tick). |
| **Owners, in-app** | `routes/dogs.ts` → `pipeline/ownerReport.ts` | **Live since 24 Aug.** Not a scraper — a form. Structured fields, own photo, own pin, nothing guessed. See below. |

**Live tick, 25 Aug 10:56 UTC** — healthy and producing nothing:

```
[olx] discovered 475, skipped 475, parsed 0, inserted 0, errors 0, fresh 32
```

Zero errors is the retry working. **32 fresh ads and 0 pets** is the open
question: `skip_reason` distinguishes `title-filter` from `rehoming` and
would settle whether the filter is too strict or those queries surface
irrelevant traffic. Do not read a non-zero `fresh` as a healthy pipeline.

### OLX

Polls ~13 Kyiv listing URLs — the dedicated lost-and-found category, plus
site-wide searches in both Ukrainian and Russian for posts that get
mis-categorised into generic "dogs"/"cats", plus the wider "тварини
загубилися" bucket. Finds ads by the `data-cy="l-card"` marker, filters
titles, fetches surviving ad pages, parses, upserts. `scrape_log` (keyed on
URL) stops the same ad being re-parsed.

**It is the only source that has ever inserted a real pet.**

### It was never blocked (17 Aug, PR #448)

This corrects three weeks of this project's own writing, including two
earlier versions of this document. `scrapeFetch.ts` opened by asserting
"CloudFront blocks the address, not the request." Measured from the Fly
machine, no proxy, **the same URL eight times in a row**:

```
403 200 403 200 403 200 403 200
```

**Fifty per cent, alternating, deterministic.** Not a block — a coin flip.
An 8-second gap between requests changed nothing, so it is not time-based
throttling; the same URL from a different datacentre returned 200 five
times out of five, so it is not a ban on datacentres either.

The retry that fixes this **already existed and was switched off** unless a
proxy was configured, on the reasoning written into the file: that retrying
a fixed address is "pure waste — the answer is the same every time." It is
not. That one condition is why "OLX is half-blocked" was the story for
weeks: half of every tick was discarded on the first refusal.

```
before   discovered 251, errors 7
after    discovered 508, errors 0
```

**The retry must fire with NO delay, and this is a trap.** The first
version shipped with a 500ms pause for politeness and changed nothing —
the tick after deploy logged the same seven failures. Measured:

```
no delay      424242     <- every second request succeeds
500ms apart   444444     <- all refused
3s apart      444444     <- all refused
```

Back-to-back requests reuse the warm connection and the second is let
through; any pause opens a fresh one and is refused. `RETRY_DELAY_MS = 0`
is load-bearing. **Adding a backoff looks like an obvious improvement and
silently disables the whole thing.** A local mock cannot catch this — a
mock has no connection behaviour to reuse.

**A residential proxy is not the fix, and establishing that cost a
subscription.** Four Ukrainian residential exits, two in Kyiv, with a full
browser header set: 403/919 every single time.

| client | exit | result |
| --- | --- | --- |
| Node | Fly datacentre | 403/200 alternating |
| Node | UA residential ×4 | 403 every time |
| Node | other datacentre | 200 ×5 |

`SCRAPE_PROXY_URL` (`lib/scrapeFetch.ts`) stays as a seam for the day the
edge really does harden — set it and scrape traffic routes through an
undici `ProxyAgent`, unset and nothing changes — and is **not set**. The
seam is deliberately narrow: it wraps scraping only, because routing an
Anthropic or Google key through a third-party proxy to solve a problem
those hosts do not have would be a bad trade.

How the old diagnosis went wrong is worth keeping: it compared a home
**browser** against a datacentre **Node client** and attributed the gap to
the address — two variables, one conclusion. And the probe that seemed to
confirm it used a URL that had been *invented* rather than taken from the
source, so the "page not found" it produced was evidence about a fake path.

### Then it turned out the scraper had run out of page (18 Aug)

Doubling listing coverage did not produce pets. A clean tick, no errors:

```
[olx] discovered 506, skipped 506, parsed 0, inserted 0, errors 0
```

Every discovered URL was already in `scrape_log`, so every one stopped at
the `seenUrls` gate and nothing reached the ad fetch.

**Nothing broke — it saturated.** Each listing URL serves page one only,
and OLX ordered that page by **relevance, not date**, so page one is a
nearly fixed set. Early on, with a small ledger, most of it was new. After
a few weeks and 12,381 rows the scraper had seen everything relevance
ordering would ever show it, and a genuinely new ad does not rank onto page
one immediately. Discovery hit 100% already-seen and stayed there — while
every log line read `tick complete`.

Fix: `search[order]=created_at:desc` on every listing URL. Measured after
deploy, `fresh` went 0 → 88 (the backlog), then settles to single digits
per tick, which is what a few new ads a day looks like against 24 ticks.

`SourceRunSummary.fresh` — URLs never seen before, whatever became of them
— was added for exactly this: `skipped` lumps already-seen together with
title-filtered, so `discovered - skipped` does not answer the question and
nothing else did. **`fresh === 0` is a log level, never an alert**, for the
reason `ingestAlert.ts` already documents.

**Fresh ads are not pets, and that gap is still open.** The first 94 fresh
ads produced 0 pets, all rejected by the title filter — either the filter
is too strict or those queries surface non-lost-pet traffic.
`scrape_log.skip_reason` distinguishes `title-filter` from `rehoming` and
would settle it.

### Volume, measured

```
13 listing URLs × hourly            = 312 requests/day
ad bodies actually fetched          ≈   4 requests/day  (pre-refresh)
pets inserted                       =  2–9/day in early Aug

14-day title filter: 926 title-filter + 386 rehoming rejected
                     BEFORE any page fetch; only 55 ads fetched
```

~99% of the traffic is the hourly listing sweep; the whole job is ~9,500
requests/month. Note this is the *pre-`created_at:desc`* shape — the
request count is unchanged, but what those requests now surface is not.

### Telegram channel scrape

Scrapes the anonymous web preview at `t.me/s/<channel>`. No Bot API, no
auth, no MTProto. Channel list comes from `TELEGRAM_CHANNELS`; the file says
plainly "Empty or unset = source is a no-op", and that variable has never
been set, so this source has never run in production.

Measured 11 Aug from the Fly datacentre IP:

```
GET https://t.me/s/telegram   ->  200, 134 KB, 227 messages parsed
```

**Telegram is not behind a WAF and does not need the proxy.** A second
ingestion path is one env var away, at no cost. What it needs is curation,
which is a human judgement rather than a technical task. Guessing channel
names is a poor method — of 12 candidates probed with the project's own
parser and keyword filter, most do not exist. Two real ones found:

```
poshuk_tvaryn      20 msgs   1 lost, 4 rehoming
pets_share_Kyiv    10 msgs   0 lost, 1 rehoming (mostly adoption)
```

One page each, so treat those as a sample and not a rate. Setting
`TELEGRAM_CHANNELS=chan1,chan2` is all it takes; the hourly cron picks them
up and the existing rehoming filter already keeps adoption posts out.

### Telegram bot webhook

A different code path entirely: a group post reaching the Mini App bot's
webhook lands on the map immediately, with the photo carried as a stable
`file_id` (see "Photos" below). Working, but the two chats in the heartbeat
are the owner's own test chats. Their staleness is two manual tests going
quiet after the tests ended — the expected outcome, not a fault. This was
misdiagnosed once as "both Telegram sources are dead"; it is worth not
repeating.

### Facebook

Two seed group IDs hardcoded, overridable via `FACEBOOK_GROUP_IDS`. Went
through an rsshub-bridge era (PRs #79, #84) and then to `mbasic` with saved
cookies (PR #85). Testing never finished because it needs a burner account
the owner has not created. Nothing to diagnose until then.

## Parsing

`pipeline/parser.ts` — **Haiku 4.5** (`claude-haiku-4-5`), ~$0.001/call.
Takes raw free-form post text and returns a structured `ParsedDog`: species,
name, breed, emoji, photo URL, last-seen point, last-seen time, a ≤280-char
English description, urgency, and a search-zone radius.

Two things worth knowing:

**It geocodes too.** Rather than wiring a paid geocoding API, the prompt
carries a Kyiv district/landmark coordinate table and asks the model to
infer lat/lng from landmarks in the post. Good enough for a 500–1000m search
zone. Text it cannot geolocate falls back to the city centre —
`50.4501, 30.5234` — with `parseConfidence` dropped accordingly. That
fallback pin is the source of the "invisible pets" problem below.

**The gazetteer is a second pass, gated.** When Haiku falls back, the parser
tries `lookupBestPlace` against `kyiv_gazetteer` (~16k OSM places, trigram
fuzzy match) — but **only on location mentions the model extracted**, never
on raw post words. That `mentions.length > 0` gate looks like a bug and is
not; see "The gazetteer trap" below.

**Contact stripping.** The prompt refuses to emit phone numbers, and the
free-text description is clamped to 280 chars. That is the only sanitising
between untrusted scraped text and the companion's chat context — an
indirect prompt-injection surface, bounded because the companion has no
tools that touch money or other users.

## First-party reports (the supply side)

Since 24 Aug an owner can post their own lost pet from the app, and this is
categorically different from every other source: **nothing is inferred.**
The owner supplies species, name, description, phone, photo and their own
pin, so `POST /dogs/report` runs no Haiku, consults no gazetteer, and
records `placement_source: 'owner'` with `parseConfidence: 1`. Existing
dedupe and the Kyiv bbox gate still apply.

Every inference in this pipeline exists to recover information a scraped
post does not carry. A first-party report carries it.

**Distribution is automatic** (`services/crosspost.ts`): the report is
published to a public Telegram channel, `copyMessage`d to every chat in
`CROSSPOST_GROUP_IDS` with a deep-link button back to the pin, and handed
back as a `t.me` share link for chats no bot will join. The channel post
**is** the photo upload — this app stores photos as Telegram `file_id`s, so
`sendPhoto` returns the id the row stores. One call does storage,
distribution and the shareable link.

**Abuse rails:** 3 reports/user/day plus a burst limiter, photos accepted
by magic bytes only (jpeg/png/webp ≤5MB), bbox and other-city violations
answered as readable 400s before anything publishes. `check:owner-report`
pins the contact rule — the full post keeps the phone on purpose, the pin
line never carries contacts.

**Review is after the fact:** each report alerts `ALERT_CHAT_ID` with an
inline «прибрати з мапи» button, honoured only from that chat, expiring
rather than deleting. Correct for known testers; the largest open-launch
risk. See [`08-open-issues.md`](08-open-issues.md) L-1.

## Placement: how a pin gets its coordinates

Rebuilt 21–22 Aug (#506–#530) after `audit:pins` measured it. The parser
had been inferring coordinates from **~41 hardcoded landmarks** while
`kyiv_gazetteer` — thousands of real streets, seeded for this exact job —
was read only by `questPlaces`.

**The Maidan trap, worth keeping because it is invisible from inside.** A
pet the parser cannot place gets the fall-through coordinate
(`50.4501, 30.5234`) and is correctly hidden. A pet the model places on
**Maidan** — the natural answer to "somewhere in Kyiv" — gets
`50.4503, 30.5234`, **22 metres away**, which is not an exact match, so it
escapes the fall-through filter and is then scattered by
`jitterAround(…, 120)` into a ring around Khreshchatyk. Every stage reports
success. That is what "the pet was in the centre" looked like from outside.

`audit:pins` is deliberately **independent of the parser**: it matches ad
text against the gazetteer directly rather than re-running the parser's
logic, because a check that reproduces the thing it checks cannot fail. It
prints no ad text — names, places and distances only.

Now: `pipeline/resolvePlace.ts` resolves the place the owner wrote, with
**addresses beating prose, specific beating broad, and silence beating
guessing** (`check:resolve-place`). Inflected Ukrainian forms and
abbreviations resolve; the model is asked only on ads a regex gave up on,
and answers in the ad's own alphabet.

**`placement_source` (migration `0037`) records how each pin happened** —
`owner`, `gazetteer-marked:<name>`, `model-landmark:<name>`, `fall-through`,
`sighting`. `label-pins` backfilled the 167 pre-column rows by
recomputation, never by touching coordinates, so `GROUP BY
placement_source` now describes the whole active table with no nulls and no
inference. Fall-through went **81 → 71**.

`resolve-pins` re-places pets dry-run-first. The landmark-guessed group was
deliberately measured but not moved for a week — those pets are already
visible at the model's best guess, so a wrong move damages a working pin —
and when it did move, the dry run printed every candidate with the pet's
stored description beside it, which is what exposed «Грейс → Контактна
вулиця» as the resolver misreading contact-info boilerplate. Each applied
move emits a per-pet reversal UPDATE with the previous coordinates.

## The ad body

Since 17 Aug (migration `0034`) `scrape_log.raw_body` stores the ad text
the parser actually read, and `GET /dogs/:id/post` serves it **one pet at a
time, behind auth**. This is what makes "is this actually the dog?"
answerable mid-search — the parser's 280-char English summary never was.

**Every stored body was mostly CSS, and nobody noticed for a day.**
cheerio's `.text()` concatenates every descendant text node, and a
`<style>` tag's contents *are* a text node; OLX injects CSS-in-JS `<style>`
elements inside the description container. Bodies opened with several
hundred characters of `.css-4upmi{text-transform:uppercase…}` before the
description. It was invisible for as long as the body was only ever
*written* — the first thing that ever read one back was the modal, in front
of a user, and the owner found it by opening one.

`extractAdBody` now strips `style, script, noscript` first and lives in
`pipeline/sources/adHtml.ts` — pure HTML in, text out. It had been inside
`olx.ts`, which imports the db module, so a check for it could not run
without a `DATABASE_URL`; that is most of why a pure function had no test.
`check:ad-extract` now asserts both halves: no stylesheet survives **and**
the description does. Repaired in production via `--repair`, 66 bodies
re-fetched — clean bodies are 86–189 chars where the polluted ones were
1300–1430.

**`parseDogPost` had been reading that same polluted text all along**, so
every classification to date spent part of its input on CSS. Whether that
changed any verdict is **unmeasured** — do not claim an improvement without
scoring it.

A second cleanup pass (`clean:ad-bodies`) removed OLX's section labels
welded to the following word (`Описменя`). 227 bodies cleaned across two
passes; **0 of 202 stored bodies still carry a label.**

## Contacts, and who sees them

Contact details are stored and shown **deliberately** — the owner's
decision — and the safeguard is structural rather than a promise.

- **During a search** the walker gets the body through
  `pipeline/redactContacts.ts`, which replaces phones, e-mails and
  @handles with «[контакт приховано]». It deliberately errs toward keeping
  the description readable: anything with fewer than nine digits stays,
  because that is a house number, a year, a price or a time, and a
  redaction that swallows "Оболонь, буд. 12" helps nobody. A number that
  slips through is one the walker could get thirty seconds later anyway.
- **After reporting a sighting** the phone is visible. An owner's phone
  rings when somebody has actually seen their animal, not every time a
  stranger opens a pin.
- **The link to the original ad is gated with the contacts.** This was a
  change of mind during the work: the first pass masked the phone while
  still handing over the OLX url, so one tap made the mask decoration.
  `sourceUrl` is now `seen ? url : null`. Consequence, deliberate and
  stated in the copy: a pet with no stored body and no sighting shows an
  explanation and a close button.
- **Contacts never enter a bulk payload.** Verified 0 occurrences in
  `/sync/map`, `/dogs/nearby` and `/stats`. Expired pets 404, so
  `expire:pet` doubles as contact removal.

`check:ad-body` is a **source-level** fixture: it fails if any file outside
a five-name allowlist mentions `raw_body`, or if `routes/dogs.ts` stops
mentioning `redactContacts` or `schema.sightings`. Source-level on purpose
— a response check only sees the pets a seeded database happens to hold and
passes happily if the leak sits behind a branch the fixture never takes.
Both mutations were run and both failed the check.

**How much contact we actually hold** (`census-contacts`, PR #492). The
mechanism was settled — OLX masks on its own page, we store the page
verbatim, so the stars were never ours — but the distribution was a guess,
and guessing is how this project has been wrong before. Three buckets by
what the walker experiences: `readable` (a full number survives in the
body), `masked` (OLX's stars and nothing readable), `none` (no contact in
the text at all — the phone lives in OLX's contact panel, which is not part
of the page body). `readable` beats `masked` when an ad has both. The
census prints **counts only, never a fragment of any body**, and is
allowlisted in `check:ad-body` on that basis.

## Gates

Between a parse and a row there are five filters, in order:

1. **Title keywords** (`pipeline/keywords.ts`) — `looksLikeLostPet` and
   `looksLikeRehoming`, stem-friendly Ukrainian and Russian regexes. This
   runs *before* any page fetch and rejects ~96% of discovered ads.
2. **Confidence** — a low-confidence parse is logged and dropped.
2b. **Found-report classification** (`pipeline/foundReport.ts`, migration
   `0035`) — somebody who *has* an animal and is looking for its owner is
   not somebody who lost one. Both look identical to the keyword filter,
   and by design: `LOST_KEYWORDS` includes `знайд|знайш|найден|нашли|found`
   and four of the thirteen listing queries are «знайшли-собаку» /
   «нашли-кошку», because a found stray needs its owner found. The bug was
   presentational — «песик (знайдений)» appeared under «загублені» with
   «терміново», asking a walker to search the streets for an animal already
   sitting in somebody's flat. Now flagged with `is_found_report` and kept
   out of the map query. Kept **in the table** rather than filtered at
   ingest so they can get their own screen later. `check:found-report`
   pins the rule, and **ambiguity stays a search**.
3. **`detectOtherCity`** (`pipeline/outOfArea.ts`, PR #409) — reads the city
   out of the post text at parse time. Built around the trap that Kyiv has
   streets named after other cities (Львівська площа, Харківське шосе, метро
   Чернігівська): matching is **token-exact** and adjectival endings are
   rejected, so a pet on Львівська площа is not read as a pet in Lviv. It
   skips anything that names Kyiv itself. Guarded by
   `pnpm --filter @shukajpes/server check:out-of-area` — 31 fixture cases,
   18 of which must *not* flag. **Run it after touching the city list; its
   failure mode is expiring a real Kyiv pet.**
4. **Greater Kyiv bbox** (`pipeline/upsert.ts`) — north 50.65, south 50.20,
   west 30.10, east 30.90. Generous enough for Vyshgorod, Brovary, Bucha,
   Boryspil and Vasylkiv; tight enough to reject Dnipro or Lviv. Coords
   outside it are refused, **but the ungeocoded fallback coord is let
   through on purpose** — which was the hole that let out-of-city pets into
   the table, because a post about a cat in Uzhhorod is exactly the post
   that fails to geocode.

## Dedupe and upsert

`pipeline/upsert.ts`, with identity in `pipeline/samePet.ts` as a pure
function since PR #416 — so the rule can be *checked* rather than reasoned
about. Every source funnels through it.

**Dedupe rule:** an active pet of the same species with a similar name
within **1500m** whose `lastSeenAt` is within **7 days** of the candidate
is *probably* the same pet — and since PR #416 the predicate **refuses when
evidence is thin**. Measured against the live table, three of the four
pairs the old rule considered duplicates were **different animals**: two
Лолаs 721m apart that were a chihuahua and a dachshund, two generic коти
where one was missing and the other *found*, two котикs that shared nothing
but the word. Two conditions carry the fix:

- **Breed compatibility** — separates pets that genuinely share a name.
  Unknown/mixed on either side stays a wildcard so ordinary reposts merge.
- **Descriptor rejection** — `name` is frequently not a name: the parser
  emits "a short descriptor if unnamed", which is why the table holds
  "чорний кіт" and "собака без імені". Two cats being equally black is not
  evidence they are one cat.

The asymmetry decides the design: a duplicate pin is untidy, obvious, and
fixable by anyone who notices. A wrong merge overwrites one family's lost
pet with another's, and the losing record leaves no trace. The candidate
query gained `ORDER BY` distance with an id tiebreak — with 81 pets sharing
the exact fallback coordinate, an unordered `LIMIT 20` had made dedupe a
lottery where the same input could resolve differently on two runs.
`check:same-pet` covers all four production pairs and runs in CI.

**Position drift:** reposts of the same pet often land 30–150m from the
original — different parser run, different landmark match. Below **150m** we
keep the existing pin and only refresh description, urgency, photo and
timestamp. Above it we treat it as a real move. Sightings take a different
path (`routes/sightings.ts`) and are not subject to this threshold.

`scrape_log` records every URL ever seen with its source, title, resulting
`dog_id`, parse confidence, ingest action and skip reason. It is both the
"don't re-Haiku this" key and the ingest heartbeat.

## Photos

Two shapes. OLX gives a CDN URL, stored in `photo_url`. Telegram gives a
`file_id`, stored in `photo_file_id` — stable forever, unlike the
`file_path` URL which Telegram only guarantees for about an hour. When
`photo_file_id` is set, the API serializer rewrites `photoUrl` to point at
`/photos/:fileId`, a server proxy that re-resolves the path on demand so the
client URL never expires.

Nulling a photo URL is **not reversible** — the URL is gone. Only do it on a
definitive 404.

## Ops tooling

Built during the 10–11 Aug sessions, all of it because something had been
failing silently.

| Tool | What it does |
| --- | --- |
| `GET /admin/lost-dogs/report[?format=text]` | The counting half of the audit: source counts, invisible counts, ingest heartbeat, fallback-pin breakdown. Read-only. **Reach for this before `fly ssh`** — no shell, no writes, no network access needed. |
| `services/lostDogsReport.ts` | One query, one renderer, shared by the endpoint and the CLI, so the two cannot describe the database differently. |
| `pnpm --filter @shukajpes/server clean:lost-dogs [--apply]` | The half that has to go out and ask the internet questions — dead photo detection and city checks. **Dry by default.** Gives up after 8 consecutive 403s. |
| `pnpm --filter @shukajpes/server expire:out-of-area [--apply]` | The catch-up sweep for out-of-city rows already in the table. Dry by default. Needs no network, so it runs from the app host. |
| `pnpm --filter @shukajpes/server expire:pet --id=<id>` | **The takedown tool** (PR #424) — for when an owner asks for their pet removed. Dry by default; `--apply` expires (reversible), `--photo` also nulls the photo (irreversible, opt-in, and the dry run says so in those words), `--restore` undoes. `--restore --photo` is refused rather than half-done. Prints the source permalink so a request can be checked against the post it came from. |
| `pnpm --filter @shukajpes/server backfill:ad-bodies [--apply] [--repair]` | Fetches each pet's ad by the URL already in `scrape_log` — no rediscovery, ~226 requests instead of ~12,000. **Three outcomes kept apart, and that separation is the safety property:** 200 stores the body, 404/410 marks `skip_reason='ad-gone'`, **anything else is left alone.** A 403 that survived its retries says nothing about whether an ad exists, and treating one as gone would expire a pet somebody is still looking for. |
| `pnpm --filter @shukajpes/server expire:no-post [--apply]` | Expires only the `ad-gone` rows. Refuses to write when no scraped pet has a body at all — the guard that covers the "the write never landed" state. Its dry run lists **newest first** behind a complete age histogram; the first version listed the 60 oldest and capped the rest, hiding all 83 rows newer than those shown. |
| `pnpm --filter @shukajpes/server census-contacts` | How much owner contact the corpus actually holds. Counts only, never a fragment of a body. |
| `pnpm --filter @shukajpes/server audit-ingest` | What the ingest missed and what it let through. |
| `pnpm --filter @shukajpes/server check:out-of-area` | 31 fixture cases for `detectOtherCity`. |
| `pnpm --filter @shukajpes/server check:same-pet` | The four production dedupe pairs plus the guards. |
| `pnpm --filter @shukajpes/server check:ingest-alert` | Exercises the alert state machine against an in-memory store, messaging nobody. |
| `services/ingestAlert.ts` | Says something when pets stop arriving. See below. |
| `GET /stats` | **Bearer-gated since PR #417.** It had been unauthenticated and was republishing `scrape_log.title` — which for bot-ingested pets is the first 200 chars of the sender's message, contact-stripping *not* applied. Private Telegram DMs, served to the world. |
| `GET /admin/lost-dogs/scrape-log` | The same data behind the admin bearer. |
| `GET /admin/metrics[?format=text]` | The beta's numbers: users, DAU/WAU, retention, ingest heartbeat, the search funnel (from `search_results`), chat token spend by model. Bots excluded structurally. |
| `POST /admin/lost-dogs/{ingest,scrape-now}` | Manual sideload and a forced tick. |

### The ingest alert

`services/ingestAlert.ts` asks two questions, both **edge-triggered**:

- *Is a source blocked?* — **≥10 errors in a tick** (`INGEST_BLOCKED_ERRORS`),
  three consecutive ticks. Retuned in PR #413 against a real tick: the
  first rule ("discovered things, parsed none, errored") would have fired
  on a perfectly normal quiet hour, because OLX discovers ~250 already-seen
  ads hourly and parses none of them. Error-counting also keeps
  unconfigured sources quiet (Facebook emits exactly one expected error per
  tick). Note the threshold was sized against the old steady 7 errors —
  with the retry in place a healthy tick now errors **0** times, so it has
  more headroom than it was designed with.
- *Has everything stopped?* — nothing inserted by any source for
  `INGEST_STALL_HOURS` (default 36; the measured baseline is 2–9/day with no
  zero days in 21). This is the check that asks the question that actually
  matters — are pets arriving — rather than counting HTTP failures.

It alerts once on the way in and once on the way out, and never repeats in
between. A monitor that nags hourly gets muted, and a muted monitor is the
same silence it was built to remove. State lives in Redis so a deploy does
not re-announce everything.

**It needs `ALERT_CHAT_ID` and that is unset**, so it ships dormant and
log-only. Setting it is one value, no purchase, and it is what stops a dying
source from being invisible — which is exactly how OLX sat blocked unnoticed.

## The table: the base refresh of 18 Aug

The corpus had accumulated months of rows nobody had checked against
reality. `backfill:ad-bodies` asked OLX about each one, and
`expire:no-post` acted only on the definitive answers:

```
221 active  →  78 active
   67 with full ad text
   11 no verdict (8 serve a 200 page we cannot parse, 3 refused)
  143 expired — the ad was deleted from OLX
```

**A deleted ad is the best found-signal this data has.** Far better than an
age threshold, which expires a pet still being searched for and keeps one
that went home in April. For a lost pet, the owner taking the ad down
usually means the story ended. Reversible with one UPDATE.

29 sightings existed and **all survived** — expiring does not cascade. (The
owner confirms those were their own UI testing, not real use.)

The same lesson produced migration `0036`, `ad_alive_at`: the staleness
sweep expired an active pet after 90 days on age alone, and «Льоля» was
ingested in April, expired by that rule, and **her ad was still serving
four months later** — the owner was renewing a live listing while we
quietly took her off the map. Age is a proxy; "is the ad still up" is
evidence, and the backfill already asks it every time it fetches. The
column remembers the answer so the sweep can defer to it.

### Earlier: the invisible-pet sweep of 11 Aug

```
before the sweep     261 active,  89 on the fallback pin
expire:out-of-area    17 status → expired  (8 on the pin, 9 drawn on the map)
after                244 active,  81 on the fallback pin
```

The map draws pets that `/dogs/nearby` returns, and that endpoint filters
out the fallback pin and bounds the rest by radius. So a row can be active,
correct, and undrawable — the genuine geocoding-failure population, and
rescuing it is still an open job (see the gazetteer trap below). Note the
81 figure predates the base refresh; the proportion has not been
re-measured against the 78.

The reversal SQL for the 17 expired rows is recorded in `HANDOFF.md` §3.2.
Two rows flagged only by the parser's English description were deliberately
**not** written — a Kyiv dog whose description mentions being evacuated from
Kramatorsk, and one whose description says Chernihiv district while its
coords are in Obolon. A description narrates history as readily as location.
Only a city named in the **ad title** is ever written.

## The gazetteer trap

Worth its own section, because the obvious fix is wrong and somebody will
propose it again.

The `mentions.length > 0` gate looks like a bug: 81 pets are sitting on the
fallback pin, 88 of the pre-sweep 89 have an original-Ukrainian title in
`scrape_log`, and the gazetteer has 15,948 Kyiv streets in it. Feed the
titles to the gazetteer, resolve the pins, done.

**Measured: it resolves 64 of 88 titles, and the hits are mostly garbage.**
`котика` ("kitten") matches провулок Валі Котика at 1.00. `Ужгород` matches
Ужгородський провулок at 0.88. Many Kyiv streets are named after people, so
collisions with ordinary words are the norm rather than the exception.

Widening the gate would scatter dozens of real pets onto confident, wrong
streets. **A wrong pin is worse than no pin** — it sends searchers to the
wrong neighbourhood. Any rescue of the 81 needs precision work first (place-type
markers, a higher similarity floor, common-noun rejection), and its
precision has to be measured before a single row is written.

One more trap inside that one: the first attempt to measure this reported
"the gazetteer resolves none of the 88 titles". That was false. A tokenising
regex lost its backslash passing through `fly ssh`, so `\p{L}` became a
character class that split on every Cyrillic letter and produced zero
tokens. A check that read nothing was reported as a check that found
nothing. Print the intermediate before trusting the aggregate.

## Known holes

- **`source = 'scrape'` matches nothing.** `lost_dogs.source` stores the
  ingest's actual name (`olx`, `telegram:<channel>`, `admin-sideload`),
  never the literal `'scrape'` the column comment implies.
- **Fresh ads are not pets.** The first 94 ads the `created_at:desc` fix
  surfaced produced zero pets, all rejected by the title filter. Either the
  filter is too strict or those queries surface non-lost-pet traffic;
  `skip_reason` distinguishes `title-filter` from `rehoming` and would
  settle it. **Do not read a non-zero `fresh` as a healthy pipeline.**
- **`--sample=N` draws from an unshuffled list.** It reported "4 of 5 ads
  are live" when the true rate was nearer 1 in 3, because the query order
  put the freshest first. Shuffle before drawing, or the sample is a biased
  estimate presented as a measurement.
- **One pet has `last_seen_at` 94 days in the future**, printed as
  `-94d ago`. It would dodge the staleness sweep for six months. A parser
  date bug, not yet traced.
- **Raw `sql` fragments in Drizzle render interpolated columns unqualified.**
  `${schema.scrapeLog.dogId} = ${schema.lostDogs.id}` came out as
  `"dog_id" = "id"`. Prefer two plain queries and a Map, and render with
  `.toSQL()` before shipping — it needs no database and it caught a bug that
  would otherwise have been silent.
- **The takedown path is half-built.** `expire:pet` (PR #424) means an
  operator can act in seconds once a request arrives — but there is no way
  for an owner to *make* one: no contact route on the landing, no address
  in the app. You are republishing real people's posts and photos, and
  nothing guarantees you are told when one of them minds.
- **Every completed search is now recorded** (`search_results`, PR #421) —
  before 14 Aug 2026, "zone walked, nothing there" existed only as an
  ephemeral log line, so "how many searches were completed" could not be
  computed from this database at all. History starts on that date; any
  funnel chart should say so.
