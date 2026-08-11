# Handoff — production state, 11 Aug 2026

Written at the end of a long session so the next one can pick up cold.
Read this top to bottom before touching anything; several of the numbers
below contradict what an earlier version of me confidently reported, and
the corrections are recorded here on purpose.

Updated later the same day: the two items that used to be section 1 are
both done — see 1.1 for what happened to them.

---

## 1. Do these first

### 1.1 Already done, do not redo

**PR #407 is merged** (`cdf84bf`, 11 Aug 11:39 UTC, merged by the owner).
`SCRAPE_PROXY_URL` is confirmed unset on Fly, so it is inert in
production exactly as intended.

**`REPORT_TOKEN` is unset, not rotated.** The compromised placeholder is
gone from Fly (`fly secrets unset REPORT_TOKEN -a shukajpes-api`, machine
`7841039a4d60e8` restarted healthy). Verified after: the secret no longer
appears in `fly secrets list`, and `GET /admin/lost-dogs/report` returns
`401` to both a junk bearer and no bearer, which is `checkReportAuth`
failing closed on an undefined token as designed.

It became a removal rather than a rotation because the owner asked the
right question: given a session already holds `FLY_API_TOKEN`, is a
report token worth anything? It is not. Anyone holding the Fly token can
`fly secrets set REPORT_TOKEN=<anything>` and then use it, or skip the
endpoint and run the same query in the container. The lesser key is only
a boundary against a holder who lacks the greater one — a dashboard, a
cron, a non-Fly agent. No such holder exists today, so there is nothing
to hold a token.

The code path is untouched: `checkReportAuth` still accepts
`REPORT_TOKEN`, so re-opening the endpoint to a narrow reader is one
`fly secrets set` away. If a session needs the report while holding the
Fly token, mint one, use it, unset it in the same session — do not leave
a long-lived value nobody can read back.

Two things worth not relearning. A token used in a `curl` is a token in
the transcript, so "generate it and tell the human" reproduces the exact
exposure being fixed; there is no way to both use a value here and keep
it private. And do not put a trailing `# comment` on a command handed to
someone using zsh — interactive zsh does not strip them, which is how the
placeholder got set in the first place.

### 1.2 What is actually next

Nothing in section 1 is blocking any more. The live problems are in
section 3, worst first:

0. **Set `ALERT_CHAT_ID`** to a Telegram chat. One value, no purchase,
   and it is what makes the rest of this list stop needing a babysitter
   — until it is set, a source dying is invisible until somebody reads
   the heartbeat, which is how OLX sat blocked unnoticed. See §4.
1. **Set `TELEGRAM_CHANNELS`** (3.3). Free, unblocked from the app host,
   one env var, no code, no purchase — and it is the only way to stop
   OLX being a single point of failure. Needs a curated channel list,
   which is a human judgement rather than a technical task.
2. **Pick an unblocker and set `SCRAPE_PROXY_URL`** (3.1). Buys back the
   half of OLX listing coverage that 403s. Worth doing — OLX is the only
   source that has ever inserted a real pet — but it is a purchase, it
   is not urgent, and pets are still arriving without it.
3. **Do not widen the gazetteer gate** (3.2). Measured: it would place
   pets on wrong streets. Precision work first, measured before writing.
4. 3.4 is a one-command cleanup, safe whenever someone wants it.

The `expire:out-of-area` sweep has already been read and applied — see
3.2. Do not re-run it expecting the same 17.

---

## 2. Access

| What | State |
| --- | --- |
| `FLY_API_TOKEN` | Set in the cloud environment as of the end of the session. App-scoped deploy token for `shukajpes-api`. Only visible to sessions started *after* it was saved. |
| `REPORT_TOKEN` | **Unset, deliberately** (see 1.1). The read route now answers only to `ADMIN_TOKEN`. Re-mint if a non-Fly holder ever needs the counts. |
| `ADMIN_TOKEN` | Unchanged. Gates the write endpoints, and still opens the read ones. Value is unknown to anyone — Fly secrets cannot be read back. |
| `ALERT_CHAT_ID` | **Not set.** Telegram chat the ingest alerts go to. Until it is set, a stalled pipeline is logged and nothing is sent. Not a secret — a chat id. |
| Database | Supabase (Postgres + PostGIS). No direct credentials held. Reachable from the app host, and from anywhere via the connection string. |

`flyctl` is not preinstalled in cloud sessions. Install with
`curl -sL https://fly.io/install.sh | sh` then
`export PATH="/root/.fly/bin:$PATH"`.

**Note on storing credentials here:** the cloud-environment variables
field is explicitly *not* a secrets store — "anyone who uses the
environment can read the values… don't add API keys or other
credentials." The Fly token is there anyway, as a deliberate tradeoff on
a personal account, and it is app-scoped and revocable. Prefer short
expiries and re-minting over long-lived tokens.

---

## 3. Live production problems, worst first

### 3.1 OLX is partially blocked — coverage is degraded, not stopped

**The old heading here said "new lost pets have stopped arriving". They
have not.** Measured 11 Aug:

```
OLX pets inserted, last 7 days:  17
Newest OLX pet:                  2026-08-10 10:35 UTC
Live tick, 11 Aug 13:38 UTC:     7 of 13 listing URLs -> 403
                                 6 served, 251 ads discovered
```

So roughly half the listing fetches are refused and the other half work.
OLX has kept delivering a few pets a day throughout. This is lost
coverage — the ads on the six refused listings are invisible to us —
rather than an outage. §5 already flagged "OLX ingestion is dead" as too
strong once; the heading kept saying it anyway.

Buying a proxy therefore buys back missing coverage. It does not restart
a dead pipeline, and nothing is on fire while it is unbought.

CloudFront's WAF serves `403` to datacentre IPs. Confirmed from two
independent hosts and in the production logs, and again on 11 Aug from a
third: six paced requests from a cloud session, all `403`, so the block
is per-address rather than rate-based. A full browser header set
(`sec-fetch-*`, `sec-ch-ua`, `accept`, `upgrade-insecure-requests`)
changes nothing. Why Fly's address gets part-way through while another
datacentre IP gets nothing is unexplained — one observation each, worth
more history before theorising.

The official route is a **dead end**, checked rather than assumed. OLX
has a Partner API, but every advert endpoint is scoped to the
authenticated partner's own listings (`GET /adverts` = "Get user
adverts"). There is no public search. It cannot see other people's
lost-pet ads.

So the plan agreed with the owner: **residential proxy**. PR #407 adds
the seam — set `SCRAPE_PROXY_URL` to any HTTP(S) proxy URL and scrape
traffic routes through it; unset, behaviour is unchanged. No provider is
hardcoded. Boot logs `[scrape] outbound: proxy <host>` so you can tell
from the logs whether it is actually on.

**The volume estimate here was wrong by ~24×.** "A few hundred requests
an hour" is really a few hundred a *day*. Measured from `scrape_log`
over 14–21 days:

```
13 listing URLs × hourly           = 312 requests/day
ad bodies actually fetched         ≈   4 requests/day
pets inserted                      = 2–9/day

14-day title filter: 926 title-filter + 386 rehoming rejected
                     BEFORE any page fetch; only 55 ads fetched
```

So ~99% of proxied traffic is the hourly listing sweep, and the whole
job is ~9,500 requests/month. Bandwidth is what a residential proxy
bills for and nothing records page sizes, so plan on a low single-digit
GB/month and measure once a proxy is on.

Because the volume is this small and nobody wants to babysit a proxy
pool, prefer a **managed unblocker in proxy mode** over raw residential
IPs: the provider absorbs WAF changes instead of you. It must expose a
`host:port` proxy endpoint — the seam feeds `SCRAPE_PROXY_URL` to an
undici `ProxyAgent`, so an API-wrapper service (`GET api.x.com/?url=…`)
would need code, not just an env var.

Still to do: pick a provider, set the secret, confirm the boot log says
`[scrape] outbound: proxy <host>` and that the next tick stops erroring.

Telegram was previously written off here as an unaffected fallback that
"is not" one. **That was wrong** — it is unaffected, it is free, and it
is one env var from working. See 3.3. Do that before paying anyone.

### 3.2 Eighty-nine active pets are invisible on the map

261 active pets in the table; the map draws 172. `/dogs/nearby` filters
out the ungeocoded fallback pin (`50.4501, 30.5234`) and bounds the rest
by radius, so a row can be active, correct, and undrawable.

Measured composition of the 89:

```
56  medium
33  urgent
 0  rehoming
(0 of them have no description text to re-geocode from)
```

The counts above are the pre-sweep numbers, kept as written because the
reasoning below refers to them. Current state: **244 active, 81 on the
pin.**

**Two claims above were wrong, and were corrected by measurement on
11 Aug.** Kept here because the reasoning that produced them is the
trap, not the numbers.

**"Nothing to expire; entirely a rescue job."** No. At least 17 active
pets are in other cities — Dnipro, Cherkasy, Vinnytsia, Odesa,
Zaporizhzhia, Zhytomyr, Kharkiv, Mykolaiv, Uzhhorod, Khmelnytskyi,
Boryslav, Kryvyi Rih, and a village in Chernihiv oblast. Nine of them
are **drawn on the map right now**, not sitting invisibly on the pin.
`upsert.ts` documents the hole it has: coords outside the Greater Kyiv
bbox are refused, but the ungeocoded fallback coord is let through on
purpose — and a post about a cat in Uzhhorod is exactly the post that
fails to geocode, so it lands on the fallback and stays active.

**"The `mentions.length > 0` gate is a live bug."** It is load-bearing.
Measured: feeding raw post words to the gazetteer resolves 64 of 88
titles, and the hits are mostly garbage — `котика` ("kitten") matches
провулок Валі Котика at 1.00, `Ужгород` matches Ужгородський провулок
at 0.88. There are 15,948 streets in the table and many are named after
people, so collisions with ordinary words are the norm rather than the
exception. Widening that gate would scatter dozens of real pets onto
confident, wrong streets. **A wrong pin is worse than no pin** — it
sends searchers to the wrong neighbourhood. Any rescue needs precision
work first (place-type markers, a higher similarity floor, common-noun
rejection), and its precision has to be measured before a single row is
written.

**The transliteration wrinkle is mostly not real.** 88 of the 89 have a
`scrape_log.title` in the original Ukrainian; 259 of 261 active rows do.
A backfill has better evidence than the English description. Note that
the ad *body* is stored nowhere — only the title, the URL, and the
parser's English summary — so ingest is the only moment the full text
exists.

**Done on 11 Aug (PR #409), gate and sweep both.**
`pipeline/outOfArea.ts` reads the city out of the post text at parse time
and `upsert` skips it, closing the hole for new arrivals.
`expire:out-of-area` was the catch-up pass for rows already in the table:
dry run read, then applied with the owner's go-ahead.

```
before   261 active, 89 on the fallback pin
apply    17 status → expired   (8 on the pin, 9 drawn on the map)
after    244 active, 81 on the fallback pin
```

Reversible, and the exact ids were captured before the write:

```sql
UPDATE lost_dogs SET status = 'active' WHERE id IN (
  'olx-jvM_QEx8nN','olx-Xa3ySjWw8H','olx-Yj8xS_Dgql','olx-gd4a1YexUH',
  'olx-COZ9PTTAI7','olx-SH-tsAJjOF','olx-qmCz-xGyCf','olx-yNui4Alzrv',
  'olx-Bv4hUsyBIW','olx-xTwS1MWT6h','olx-t4Q_h71h9w','olx-vLlLPgfjS8',
  'olx-oHmvyqIMEM','olx-m6R90LwAcs','olx-fQiphYCSQj','olx-K18NaYRweI',
  'olx-53ulPMqq2N');
```

Two rows were flagged only by the parser's English description and were
deliberately **not** written — `Чак` (a Kyiv dog titled "КИЇВ!!! ЗНИК
собака!!" whose description mentions being evacuated from Kramatorsk)
and `Барбі` (description says Chernihiv district, coords are in Obolon).
Both are still active. Decide them by hand or leave them.

The 81 still on the pin are the genuine geocoding-failure population.
That is the rescue job, and it is the one that needs precision work
before anything is written.

### 3.3 Telegram is unconfigured, not broken — and it is not blocked

**This section previously said "both Telegram sources are dead" and that
"nobody has looked at why". Both were wrong.** Corrected 11 Aug by the
owner and by measurement.

The heartbeat entries that looked stale:

```
45.7d ago  telegram:webhook:-1003509554251
48.1d ago  telegram:webhook:-4625589963
```

are **the owner's own test chats**, ingested through the Mini App bot's
webhook (`routes/telegram.ts` → `services/telegramIngest.ts`). That bot
is part of a wider Telegram bot suite and was never pointed at a public
pet source. Nothing died; those numbers are two manual tests going quiet
after the tests ended, which is the expected outcome and not a fault.

**The real Telegram source is a different code path and has never been
switched on.** `pipeline/sources/telegram.ts` scrapes the anonymous web
preview at `t.me/s/<channel>` — no Bot API, no auth, no MTProto. Its
channel list comes from `TELEGRAM_CHANNELS`, and the file says plainly
"Empty or unset = source is a no-op." That variable is not in Fly
secrets and not in `fly.toml`, so the source has been a no-op since it
was written.

Measured 11 Aug, and this is the part that matters for 3.1:

```
GET https://t.me/s/telegram   from the Fly datacentre IP
  -> 200, 134 KB, 227 messages parsed
```

**Telegram is not behind a WAF and does not need the proxy.** A second
ingestion path is one env var away from working, at no cost.

What it needs is curation, which the source file already calls out.
Guessing channel names is a poor method — of 12 candidates probed with
the project's own parser and keyword filter, most do not exist. Two
real ones:

```
poshuk_tvaryn      20 msgs   1 lost, 4 rehoming
                   e.g. "В районе Тираспольской площади найден кот"
pets_share_Kyiv    10 msgs   0 lost, 1 rehoming (mostly adoption)
```

One page each, so treat those as a sample and not a rate. Set
`TELEGRAM_CHANNELS=chan1,chan2` and the hourly cron picks them up; the
existing rehoming filter already keeps adoption posts out.

**Facebook is deliberately parked, not mysterious.** Testing never
finished because it needs a burner account the owner has not created
yet. Nothing to diagnose until then.

### 3.4 Six dead photos, ready to clean

`clean:lost-dogs` finds 6 pets whose OLX CDN photo 404s, with 0
inconclusive — so all six are genuine, not throttling artefacts. Safe to
apply whenever:

```
fly ssh console -a shukajpes-api -C "node dist/db/clean-lost-dogs.js --apply"
```

Nulls those `photo_url`s (cards fall back to the pet's emoji) and does
nothing else. The city half of the same sweep cannot run from the app
host — it needs a connection OLX will talk to — and it gives up after 8
consecutive 403s rather than hammering the WAF.

---

## 4. Tools built this session

- `GET /admin/lost-dogs/report[?format=text]` — the counting half of the
  audit (source counts, invisible counts, ingest heartbeat, fallback-pin
  breakdown). Read-only, `REPORT_TOKEN` or `ADMIN_TOKEN`. **Use this
  before reaching for SSH** — it needs no network access and no shell.
- `pnpm --filter @shukajpes/server clean:lost-dogs [--apply]` — the half
  that has to go out and ask the internet questions. Dry run by default.
- `services/lostDogsReport.ts` — one query, one renderer, shared by both
  so the CLI and the endpoint cannot describe the database differently.
- `pipeline/outOfArea.ts` — `detectOtherCity(text)`, the named-city gate
  wired into the parser and enforced in `upsert`. Built around the trap
  that Kyiv has streets named after other cities (Львівська площа,
  Харківське шосе, метро Чернігівська): matching is token-exact and
  adjectival endings are rejected, so a pet on Львівська площа is not
  read as a pet in Lviv. Skips anything that names Kyiv itself.
- `pnpm --filter @shukajpes/server check:out-of-area` — 31 fixture cases
  for the above, 18 of which must NOT flag. Run it after touching the
  city list; its failure mode is expiring a real Kyiv pet.
- `services/ingestAlert.ts` — says something when pets stop arriving.
  Two questions, both edge-triggered: *is a source blocked* (three
  consecutive ticks that discovered items, ingested none and errored)
  and *has everything stopped* (nothing inserted by any source for
  `INGEST_STALL_HOURS`, default 36 — the measured baseline is 2–9/day
  with no zero days in 21). Alerts once on the way in, once on the way
  out, and never repeats in between; a monitor that nags hourly gets
  muted, and a muted monitor is the same silence it was built to remove.
  State is in redis so a deploy doesn't re-announce everything.
  **Needs `ALERT_CHAT_ID`** — unset ships it dormant and log-only.
  The blocked threshold (`INGEST_BLOCKED_ERRORS`, default 10) is
  calibrated against a single observed tick where OLX errored 7 times
  and was still delivering pets — alerting on that steady state would
  have cried wolf on day one. Thin calibration; revisit with history,
  and note it assumes OLX's 13 listing URLs.
  Verify with `check:ingest-alert`, which exercises the transitions
  against an in-memory store and messages nobody.
- `pnpm --filter @shukajpes/server expire:out-of-area [--apply]` — the
  catch-up sweep. Dry by default. Only a city named in the **ad title**
  is ever written; a city named in the parser's English description is
  reported and left alone, because a description narrates history as
  readily as location ("evacuated from Kramatorsk" on a dog lost by the
  Olimpiiska stadium, titled "КИЇВ!!!"). Needs no network, so unlike the
  city half of `clean:lost-dogs` it actually runs from the app host.

---

## 5. Things I got wrong, so you don't repeat them

- **"0 pets on the fallback pin, the filter works."** I checked by
  reading `/dogs/nearby` — the one endpoint that filters that pin out.
  The real number is 89. Never audit a filter through the filter.
- **"The 89 are probably rehoming ads."** Plausible (the parser does park
  rehoming posts on that pin, and `upsert` only converts
  `urgency: 'resolved'` to `status: 'found'`, so a rehoming post does
  stay `active`). Measured: zero of them. Measure before building.
- **"OLX ingestion is dead / nothing new can enter the table."** Too
  strong. The heartbeat showed a pet inserted ~19h earlier. The block is
  recent or intermittent, not long-standing.
- **"~25% of pets have no permalink."** Wrong, from bad sampling. The
  real number is 2 of 261.
- **`source = 'scrape'`** matches nothing. `lost_dogs.source` stores the
  ingest's actual name (`olx`, `telegram:<channel>`, `admin-sideload`),
  never the literal `'scrape'` the column comment implies.
- **Raw `sql` fragments in Drizzle render interpolated columns
  unqualified.** `${schema.scrapeLog.dogId} = ${schema.lostDogs.id}` came
  out as `"dog_id" = "id"`. Prefer two plain queries and a Map. Render
  with `.toSQL()` before shipping — it needs no database and it caught a
  bug that would otherwise have been silent.
- **Advising the environment-variables field as a place for secrets.**
  The docs say the opposite. Check the docs before advising, not after.
- **Writing an alert rule from a log line instead of from data.** The
  first version fired when a source "discovered things, parsed none, and
  errored" — the condition the cron logs. The first live tick showed why
  that cannot drive an alert: OLX discovers ~250 already-seen ads every
  hour and parses none of them, because only ~4 genuinely new ads exist
  per day against 24 ticks. Most honest ticks parse nothing. The rule
  would have fired on a normal quiet hour. Alert conditions need the
  distribution of the normal case, not the shape of the bad one.
- **"The gazetteer resolves none of the 88 titles."** It resolves plenty.
  My tokenising regex lost its backslash passing through `fly ssh`, so
  `\p{L}` became a character class that split on every Cyrillic letter
  and produced zero tokens. A check that read nothing, reported as a
  check that found nothing — the exact failure this file already warns
  about, committed again one section later. Print the intermediate
  before trusting the aggregate.
- **Reaching for the gate before asking whether the gazetteer worked.**
  The plan was "fix the gate, then backfill through it", written without
  ever asking what the gazetteer returns for these rows. It returns
  confident nonsense, which makes the gate a guard rather than a bug.
  One query would have said so.
- **Filing "rotate `REPORT_TOKEN`" as the top priority.** The exposure was
  real but the fix was the wrong shape: I never asked what the token
  still bought once the same session held `FLY_API_TOKEN`. It bought
  nothing — a lesser key constrains only a holder who lacks the greater
  one. Ask what a credential is a boundary *against* before spending
  effort protecting it.

---

## 6. Standing rules

- Work on the branch the session was given — it changes per session, and
  `claude/project-sync-handoff-a2odxl` is merged and finished. Never push
  elsewhere without asking.
- Open a PR when a task is finished; the owner merges manually. A merged
  PR is finished — restart the branch from `origin/main` for follow-up
  work rather than stacking onto merged history.
- Deploys are automatic: any push to `main` runs typecheck + lint and
  then `flyctl deploy`. The frontend deploys via Vercel's own git
  integration.
- `pnpm -r typecheck` and `pnpm -r lint` before every PR. Lint currently
  carries 21 pre-existing `react-hooks/exhaustive-deps` warnings and 0
  errors; that is the baseline, not a regression.

---

## 7. Known, deferred, nobody has asked for it yet

- **Territory decay** is undesigned. Ground only ever ratchets upward;
  the owner deferred this but the motive is real.
- `groundIn` takes 240 pieces with no `ORDER BY` — harmless at current
  fragmentation, will bite eventually.
- Sync payload is ~215KB with every nearby owner drawn (~52MB/hour on
  cellular). `rivalPiecesDrawn` in `server/src/config/balance.ts` is the
  dial.
