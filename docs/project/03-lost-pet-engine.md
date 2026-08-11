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

| Source | File | Status (11 Aug 2026) |
| --- | --- | --- |
| **OLX** | `pipeline/sources/olx.ts` | **Blocked.** CloudFront's WAF serves 403 to datacentre IPs. |
| **Telegram (channel scrape)** | `pipeline/sources/telegram.ts` | **Unconfigured.** `TELEGRAM_CHANNELS` is unset, so the source is a no-op. Not blocked — verified reachable from the Fly IP. |
| **Telegram (bot webhook)** | `routes/telegram.ts` → `services/telegramIngest.ts` | Working, but only ever pointed at the owner's own test chats. |
| **Facebook** | `pipeline/sources/facebook.ts` | **Parked.** Needs a burner account nobody has created. |

### OLX

Polls ~13 Kyiv listing URLs — the dedicated lost-and-found category, plus
site-wide searches in both Ukrainian and Russian for posts that get
mis-categorised into generic "dogs"/"cats", plus the wider "тварини
загубилися" bucket. Finds ads by the `data-cy="l-card"` marker, filters
titles, fetches surviving ad pages, parses, upserts. `scrape_log` (keyed on
URL) stops the same ad being re-parsed.

**It is the only source that has ever inserted a real pet.**

**Why it is blocked, and what has been ruled out.** The 403 is on the
address, not the request — a full browser header set (`sec-fetch-*`,
`sec-ch-ua`, `accept`, `upgrade-insecure-requests`) changes nothing, and the
block reproduces from two independent hosts and in production logs. The
official route is a checked dead end: OLX has a Partner API, but every
advert endpoint is scoped to the authenticated partner's own listings
(`GET /adverts` is "Get user adverts"). There is no public search. It cannot
see other people's lost-pet ads.

**The seam that exists.** PR #407 added `SCRAPE_PROXY_URL`
(`lib/scrapeFetch.ts`): set it to any HTTP(S) proxy URL and scrape traffic
routes through an undici `ProxyAgent`; unset, behaviour is unchanged. No
provider is hardcoded. Boot logs `[scrape] outbound: proxy <host>` so you
can tell from the logs whether it is actually on. It is currently **unset**,
so it is inert in production.

**The volume, measured** from `scrape_log` over 14–21 days. An earlier
estimate here was wrong by about 24×:

```
13 listing URLs × hourly            = 312 requests/day
ad bodies actually fetched          ≈   4 requests/day
pets inserted                       =  2–9/day, no zero days in 21

14-day title filter: 926 title-filter + 386 rehoming rejected
                     BEFORE any page fetch; only 55 ads fetched
```

So ~99% of proxied traffic would be the hourly listing sweep, and the whole
job is ~9,500 requests/month. Bandwidth is what a residential proxy bills
for and nothing records page sizes, so plan on low single-digit GB/month and
measure once a proxy is on. Because the volume is this small, prefer a
**managed unblocker in proxy mode** over raw residential IPs — the provider
absorbs WAF changes instead of you. It must expose a `host:port` proxy
endpoint; an API-wrapper service (`GET api.x.com/?url=…`) would need code,
not just an env var.

The scraper gives up after **8 consecutive 403s** rather than hammering the
WAF (PR #403).

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

## Gates

Between a parse and a row there are four filters, in order:

1. **Title keywords** (`pipeline/keywords.ts`) — `looksLikeLostPet` and
   `looksLikeRehoming`, stem-friendly Ukrainian and Russian regexes. This
   runs *before* any page fetch and rejects ~96% of discovered ads.
2. **Confidence** — a low-confidence parse is logged and dropped.
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

`pipeline/upsert.ts`. Every source funnels through it.

**Dedupe rule:** an active pet with a similar name within **1500m** whose
`lastSeenAt` is within **7 days** of the candidate is the same pet.
"Similar" is a case-insensitive substring match either way, so "Бусинка"
matches "бусинка" matches "буся". Imperfect, and fine at a few dozen posts
a day.

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
| `pnpm --filter @shukajpes/server check:out-of-area` | 31 fixture cases for `detectOtherCity`. |
| `pnpm --filter @shukajpes/server check:ingest-alert` | Exercises the alert state machine against an in-memory store, messaging nobody. |
| `services/ingestAlert.ts` | Says something when pets stop arriving. See below. |
| `GET /stats` | Public, unauthenticated. Active counts, per-source breakdown, last 30 `scrape_log` rows. Convenient; also an ops dashboard exposed to the world. |
| `GET /admin/lost-dogs/scrape-log` | The same data behind the admin bearer. |
| `POST /admin/lost-dogs/{ingest,scrape-now}` | Manual sideload and a forced tick. |

### The ingest alert

`services/ingestAlert.ts` asks two questions, both **edge-triggered**:

- *Is a source blocked?* — three consecutive ticks that discovered items,
  ingested none, and errored.
- *Has everything stopped?* — nothing inserted by any source for
  `INGEST_STALL_HOURS` (default 36; the measured baseline is 2–9/day with no
  zero days in 21).

It alerts once on the way in and once on the way out, and never repeats in
between. A monitor that nags hourly gets muted, and a muted monitor is the
same silence it was built to remove. State lives in Redis so a deploy does
not re-announce everything.

**It needs `ALERT_CHAT_ID` and that is unset**, so it ships dormant and
log-only. Setting it is one value, no purchase, and it is what stops a dying
source from being invisible — which is exactly how OLX sat blocked unnoticed.

## The table, as measured on 11 Aug 2026

```
before the sweep     261 active,  89 on the fallback pin
expire:out-of-area    17 status → expired  (8 on the pin, 9 drawn on the map)
after                244 active,  81 on the fallback pin
```

The map draws pets that `/dogs/nearby` returns, and that endpoint filters
out the fallback pin and bounds the rest by radius. So a row can be active,
correct, and undrawable. The 81 still on the pin are the genuine
geocoding-failure population, and rescuing them is the open job.

Composition of the invisible set, measured before the sweep:

```
56  medium urgency
33  urgent
 0  rehoming
 0  with no description text to re-geocode from
```

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
- **The ad body is stored nowhere.** Only the title, the URL and the
  parser's English summary. Ingest is the only moment the full text exists,
  so anything that needs the original wording has to happen there.
- **Raw `sql` fragments in Drizzle render interpolated columns unqualified.**
  `${schema.scrapeLog.dogId} = ${schema.lostDogs.id}` came out as
  `"dog_id" = "id"`. Prefer two plain queries and a Map, and render with
  `.toSQL()` before shipping — it needs no database and it caught a bug that
  would otherwise have been silent.
- **No human review, kill switch or takedown path** for ingested reports.
  You are republishing real people's posts and photos.
