# Handoff — production state, 11 Aug 2026

Written at the end of a long session so the next one can pick up cold.
Read this top to bottom before touching anything; several of the numbers
below contradict what an earlier version of me confidently reported, and
the corrections are recorded here on purpose.

Updated later the same day: the two items that used to be section 1 are
both done — see 1.1 for what happened to them.

**Updated 13–14 Aug** with a beta-readiness pass. Section 0 below is the
current state and supersedes anything older it contradicts; sections 1–7
are kept because their reasoning still holds.

---

## 0. State as of 14 Aug 2026

### 0.1 Shipped since 11 Aug

Phase 1 of the closed-beta plan is complete except two items that are the
owner's. Merged, deployed, and verified in production unless noted:

| | |
| --- | --- |
| Rate limiting | was GLOBAL, not per-user — `@fastify/rate-limit` installs at `onRequest`, `req.userId` is set at `preHandler`, so every key fell through to `req.ip` and, behind Fly's proxy, to one bucket for the world. Chat's 30/min was thirty for everybody at once. Fixed with `hook: 'preHandler'` + `trustProxy`. Proven per-user on production with two device ids. |
| Route coverage | nine routes had no limit at all, including `/state`. `pnpm check:route-coverage` asks Fastify what it registered rather than grepping; 43 routes, 40 limited, 3 knowingly exempt. |
| `/stats` | was unauthenticated and republished users' Telegram messages, DMs included, plus private chat ids. Now behind a token. |
| Invite gate | built, **and deliberately switched OFF** — see 0.2. Existing accounts can never be gated; `check:invites` asserts it exhaustively. |
| Chat spend | per-user daily budget + global cap + a kill switch that needs no deploy. |
| Server safety nets | `setErrorHandler` masks 5xx (was returning raw Postgres constraint names), plus `unhandledRejection` / `uncaughtException`. |
| Crash reporting | root `ErrorBoundary` + `window.onerror` + `unhandledrejection` → `POST /client-errors`. There was none of this; four white-screen incidents are on record. |
| Dev affordances | `?terrReset=1`, `?terrRaid=1`, `?sim=1`, `/preview` are gated out of the shipped build. `/dev` + `DEV_TOOLS_PASSWORD` turns them back on per browser. |
| `search_results` | every completed search now recorded, found or not. |
| Takedown | `expire:pet --id=<id>` — dry run, `--apply`, `--photo`, `--restore`. |
| Data bill | halved. See 0.3. |
| Connection banner | failures were written to `lastSyncError` at 19 sites and read by NONE. Plus the first fetch timeout in the app's history. |
| Three silent no-ops | lost-pet cleanup never ran, two quest effects never re-ran, Vercel shipped without a typecheck. |
| Admin console | `/admin/console`, read-only, plus `/admin/metrics` (`?format=text` for a terminal). One self-contained page served by the API — NOT the plan's Vite+React workspace, see the note in routes/adminConsole.ts. Needs `DASHBOARD_TOKEN`. |
| Auth statuses | a 500-instead-of-401/403 regression from this same session, fixed and verified on production. See §5 — it was blocking owner item #2 without anyone knowing. |

### 0.1b 17 Aug — OLX was never blocked, and the docs said it was

The biggest correction in this file. `scrapeFetch.ts` opened by asserting
"CloudFront blocks the address, not the request". Measured, from Fly, no
proxy, the SAME url eight times in a row:

    403 200 403 200 403 200 403 200

Fifty per cent, alternating, deterministic. Not a block — a coin flip.
The retry that fixes it already existed and was switched OFF unless a
proxy was configured, on the reasoning that retrying a fixed address is
"pure waste: the answer is the same every time". It is not.

**A residential proxy is NOT the fix**, and this cost a subscription to
establish: four Ukrainian residential exits, two in Kyiv, with a full
browser header set, returned 403/919 every single time. `SCRAPE_PROXY_URL`
stays as a seam and is unset.

**The retry must fire with NO delay.** The first attempt at this shipped
with a 500ms pause for politeness and changed nothing — the tick after
deploy logged the same seven failures. Measured:

    no delay      424242     <- every second request succeeds
    500ms apart   444444     <- all refused
    3s apart      444444     <- all refused

Back-to-back requests reuse the warm connection and the second is let
through; any pause opens a fresh one and is refused. **Do not add a
backoff to that retry loop.** It looks like an obvious improvement and it
silently disables the whole thing.

Result, measured on the tick after the fix landed:

    before   discovered 251, errors 7
    after    discovered 508, errors 0

Coverage of LISTINGS doubled. Whether that yields more PETS is not yet
known — every ad discovered in that first tick was already known, because
one lost-pet ad matches several of the thirteen queries. Watch `inserted`
over the coming days before claiming otherwise.

Also shipped 17 Aug: `scrape_log.raw_body` stores the ad text the parser
read (migration 0034), and `GET /dogs/:id/post` serves it one pet at a
time behind auth. Contact details are stored and shown DELIBERATELY —
owner's decision — and the safeguard is that they never enter a bulk
payload: verified 0 occurrences in /sync/map, /dogs/nearby and /stats.
Expired pets 404, so `expire:pet` doubles as contact removal.

**18 Aug — the client half landed, and the bounce is gone.**
`components/ui/PostModal.tsx` reads the post in a top sheet, reachable
from two places: «читати оголошення» on the pet card (mid-search — this
is the one that answers "is this the dog?") and the end-of-search prompt,
which used to `window.open` OLX.

**The link is gated with the contacts, and that was a change of mind
during the work.** The first pass masked the phone in the body while
still handing over the OLX url — one tap and the mask was decoration.
`sourceUrl` is now `seen ? url : null`, which is exactly what MapView did
before this route existed. Consequence: a pet with NO stored body and no
sighting shows only an explanation and a close button. That is deliberate
and the copy says so (`t.modals.post.originalAfterSighting`); the
alternative was a gate anybody could walk around.

`check:ad-body` is the eighth fixture check. It scans the source and
fails if any file outside a five-name allowlist mentions `raw_body`, and
if `routes/dogs.ts` stops mentioning `redactContacts` or
`schema.sightings`. Source-level on purpose: a response check only sees
the pets a seeded database happens to hold, and passes happily if the
leak sits behind a branch the fixture never takes. Both mutations were
run and both failed the check.

Verified in Chromium against the built production bundle and a local
Postgres, all four states: body + no sighting (masked, description
intact), body + sighting (phone visible), no body (fallback copy), and a
404 (the "try again" state, which must not read as "no ad"). **Not**
verified through the map itself — `tiles.openfreemap.org` is unreachable
from the sandbox and MapView aborts init when the style fetch fails, so
the card was driven directly instead of by tapping a pin.

### 0.1c 18 Aug — production holds ZERO ad bodies, and nobody had looked

The first read-only dry run of `reopen:ads` against production:

    ledger rows:            12393
      … with a stored body: 0
         olx                12381  (0 with body)
         telegram:webhook   12      (0 with body)

`raw_body` shipped on 17 Aug and the scrape cron is alive —
`ANTHROPIC_API_KEY` is set (checked via `fly secrets list`, which is the
gate at `services/scrape.ts:85`), and the cron runs on boot with a
30–120s jitter, so it is NOT the reset-`setInterval` bug that bit
`lostDogCleanup`. **Unresolved at the time of writing** whether zero
means "no new lost-pet-titled ad has passed the title filter in the
window" or "the write is not landing". Watch a tick before believing
either.

This matters because everything about the refresh assumes re-fetched ads
come back with bodies. `expire:no-post` refuses to write when no scraped
pet has one, which is exactly this state — the guard covers it.

**And the shape of the ledger is not what the plan assumed.** Of 12,067
clearable rows, only **226 point at an active pet**; 11,780 point at no
pet at all. Those are ads the pipeline already rejected — rehoming,
wrong city, title-filtered — and most are decided from the LISTING TITLE
before `fetchText` is called (`olx.ts:214`), so re-opening one is not
even a re-fetch, just the same verdict recomputed. The first version of
`reopen:ads` defaulted to clearing all of them: a 50× burst for nothing.
Default is now rows attached to an active pet; `--orphans` and `--all`
widen it deliberately.

### 0.2 THE OWNER'S OPEN ITEMS — nothing here is blocked on the agent

Ordered by what hurts first if forgotten.

1. **Google Maps key — the only genuinely urgent one.** The repo is
   PUBLIC and the committed key is the one serving production (confirmed
   by hashing the committed value against the deployed bundle). Do the
   cheap half today: a **billing quota and a budget alert**, which touch
   no key and cap what a harvested one can cost. Precedent: ~$100 of
   Places burned in days (`docs/project/07-operations.md:214`). Then
   restrict to HTTP referrers + only the APIs in use. Rotation can wait
   until before invites, and the ORDER matters or the map goes dark:
   new key → restrict → set in Vercel → redeploy → confirm the map draws
   → only then delete the old one.
2. **`INVITE_REQUIRED` is UNSET, so the door is open.** The gate is built
   and tested but off. Before invites: mint codes with
   `pnpm --filter @shukajpes/server invite --new --uses=N --note=...`,
   then set the flag. Turning it on does not lock out the ~543 existing
   accounts — that invariant is the whole point of `check:invites`.
3. **`DASHBOARD_TOKEN` is unset**, so `/admin/console` and
   `/admin/metrics` refuse everyone. It is read-only and the only one of
   the three keys safe to keep in a browser.
   `fly secrets set DASHBOARD_TOKEN='…' -a shukajpes-api`, then open
   `https://shukajpes-api.fly.dev/admin/console`.
4. **`DEV_TOOLS_PASSWORD` is unset**, so `/dev` refuses everyone and the
   walk simulator is off everywhere, including for the agent.
   `fly secrets set DEV_TOOLS_PASSWORD='…' -a shukajpes-api`.
5. **A way for an owner to reach you.** The takedown CLI is the operator
   half only. There is no contact route on the landing and no address in
   the app, so you can act in seconds once you know, and nothing
   guarantees you are told. Owner is thinking about a support ticket.
6. **External uptime monitor on `/health/deep`.** It works and returns
   503 correctly; nothing watches it. Fly's own check points at
   `/health`, which returns `ok` unconditionally and passes while the
   database is down. **Do not simply repoint Fly at `/health/deep`** —
   see 0.4.
7. **Presence consent.** Every walker's position is broadcast to anyone
   within 8km, jittered ~25m, with no opt-in, no opt-out, no disclosure.
   Product decision: presence off, or opt-out plus a plain note.
8. **`TELEGRAM_CHANNELS` is still unset** — a free, unblocked second
   ingest source doing nothing. Needs a curated channel list
   (`poshuk_tvaryn` verified working).
9. **Parse accuracy over ~50 real posts.** The docs call this the single
   biggest unknown in the product and no measured number exists. It is
   also the strongest slide in a deck. Needs a decision about reading
   production ad text.
10. **The rival dials.** `rivalMarksPerOwner: 24` and
   `rivalPiecesDrawn: 140` are 47% of what a sync now costs; halving
   them is another ~23%. Left alone because it changes how dense the map
   LOOKS, which is the art director's call.
11. **`force: true` stays** — owner decided to keep tap-to-collect while
    the animation is being tuned. Consequence to remember when reading
    beta numbers: collection counts will not prove anybody walked.
    `search_results` and distance still will.

### 0.3 The data bill, measured

The roadmap blamed the `/state` poll and the rival dials. Both were wrong
about the biggest item, and its 57MB/hour figure was ~4× too high.

Measured against a local Postgres seeded to production's shape (244
active pets, six rivals holding full territory):

```
dogs        29,300 B   49.3%   <- changes ~17 times a WEEK
rivalMarks  12,960 B   21.8%
rivals       9,570 B   16.1%
tokens       5,848 B    9.8%
TOTAL       54,234 B  = ~13 MB/hour at one sync per 15s
```

The pets list was half of every response and re-sent byte-for-byte every
fifteen seconds. It is now conditional on a fingerprint the client echoes
back; `/state` is no longer polled on the map (it returned the same
fifteen fields `/sync/map` already nests under `state`, byte-identical);
and neither loop runs while the tab is hidden.

```
before        54,234 B   ~13.0 MB/hour
steady state  27,380 B    ~6.6 MB/hour   -49.5%
backgrounded       0 B          0
```

### 0.4 Do not repoint Fly's health check at `/health/deep`

The roadmap suggests it. It is worse. `/health/deep` fails on Redis too;
Redis is free-tier and flaky and the app degrades gracefully without it,
so a Redis blip would mark a SERVING machine unhealthy and take the app
down. And on a real database outage, restarting the machine fixes
nothing while costing you the logs and the endpoint you would diagnose
from. The right fix is an external monitor telling a human.

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
| `ALERT_CHAT_ID` | **Set** 11 Aug to the owner's DM with the bot. Ingest alerts are live. Not a secret — a chat id. |
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
independent hosts and in the production logs. A full browser header set
(`sec-fetch-*`, `sec-ch-ua`, `accept`, `upgrade-insecure-requests`)
changes nothing.

**Do not probe OLX by hand to learn more. It does not work and it is the
one action that can make things worse.** Tried on 11 Aug and recorded so
nobody repeats it: ~23 paced requests from the Fly host itself, covering
10 of the 13 listing URLs, returned `403` on every single one — while
the scheduled tick minutes either side of that probe was getting 6 of
those same 13 through and discovering 251 ads. The scraper's request is
not special: `scrapeFetch` sends the same user-agent and
accept-language, no cookies, no extra headers.

So a hand-run request and the cron's request get different answers from
the same address, for reasons this session could not explain and stopped
trying to. Two things follow. **A by-hand `403` proves nothing about
whether ingestion works** — check `scrape_log` instead, which is free
and cannot be misread. And the probing itself risks the coverage that
still works: the tick before it and the tick after both showed exactly
7 errors, so no harm was done that time, but that was luck rather than
judgement.

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

Added 13–14 Aug:

- **I broke every auth response for a day and CI never noticed.** The
  `setErrorHandler` added in the safety-nets change read `err.statusCode
  ?? 500`. This app's auth hook refuses by setting the code on the REPLY
  and then throwing a plain Error, which carries no statusCode — so every
  401 and 403 became a 500 with the message masked. Verified live on
  production before the fix: `GET /state` with no device id returned
  `500 {"error":"internal error"}`.

  The 403 is the part that mattered. `InviteRequiredError` reaches the
  client as `res.status === 403 && text.includes('invite')`, so the door
  screen could never have rendered and every uninvited tester would have
  seen the silently-broken app that screen exists to prevent. It was
  harmless only because INVITE_REQUIRED is still unset — i.e. the bug was
  waiting precisely for owner item 0.2 #2 to be actioned.

  Found by accident: a browser test of the admin console noticed a stray
  500 on `/favicon.ico`. It was not looking for this, and neither its own
  PR, nor CI, nor a production check had caught it. When adding a global
  error handler, test the paths that set a status and THEN throw — this
  codebase has two, and both are auth.

- **Metro's cache will tell you a working thing is broken, twice.** The
  `EXPO_PUBLIC_DEV_TOOLS` opt-in reported as not working; it was a cached
  module re-emitting the old literal. Later a browser test failed because
  the bundle still had a previous build's `EXPO_PUBLIC_API_URL` inlined,
  so the harness waited on a host the app never called. Pass `--clear`
  when changing an env variable locally. Vercel builds clean and is
  unaffected. Both times the wrong conclusion was one grep of the bundle
  away from being caught.
- **The GitHub API does not match short SHAs.** Four separate status
  reports this session were wrong because a query returned an empty list
  and empty was read as an answer: "CI complete" when it had not started,
  "the workflow never triggered" when it had, "the deploy is still
  running" when it had succeeded twenty minutes earlier. Use the full
  40-character SHA, and make any status check say explicitly when it read
  NOTHING rather than falling through to a conclusion. This is the same
  failure the standing rules already warn about, in a new costume.
- **A CI gate's first catch may be your own commit.** Testing the new
  Vercel typecheck gate surfaced a variable referenced 270 lines above
  its declaration in the very change that added the gate. `pnpm -r
  typecheck` had passed before those edits. Re-run the check AFTER the
  last edit, not before it.
- **The roadmap's data-bill numbers were guesses.** 57MB/hour was ~4×
  high, and both named culprits were minor next to the pets list nobody
  had measured. See 0.3. Measure the payload before tuning the dial.

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
- **Probing OLX by hand to see whether a proxy could be avoided.** Three
  measurement artefacts in one session, all the same shape: a check that
  produced a number, and the number described my test rather than
  production. This one was the worst, because unlike a bad regex it
  spends something — every probe is a request at a WAF that has already
  refused us, and a widened block would have cost real coverage on the
  only source that inserts pets. It happened to cost nothing (7 errors
  before, 7 after). `scrape_log` answers the same question for free.
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
  integration, whose build command now runs `pnpm typecheck && pnpm lint`
  FIRST and fails on either — a frontend that does not typecheck can no
  longer reach users.
- `pnpm check` is a seventh gate beyond typecheck and lint, and runs in
  CI. All seven checks are pure: no database, no network, no secrets.
- `pnpm -r typecheck` and `pnpm -r lint` before every PR. Lint currently
  carries 21 pre-existing `react-hooks/exhaustive-deps` warnings and 0
  errors; that is the baseline, not a regression.

---

## 7. Known, deferred, nobody has asked for it yet

- **Territory decay** is undesigned. Ground only ever ratchets upward;
  the owner deferred this but the motive is real.
- `groundIn` takes 240 pieces with no `ORDER BY` — harmless at current
  fragmentation, will bite eventually.
- ~~Sync payload is ~215KB (~52MB/hour)~~ — SUPERSEDED, see 0.3. Measured
  at 54KB and now 27KB in steady state (~6.6MB/hour). `rivalPiecesDrawn`
  and `rivalMarksPerOwner` remain the dials for another ~23%, untouched
  because they change how dense the map looks.
