# 07 — Operations

How to run it, what to reach for first, and every way it has gone down so
far.

## Deploys

**There is no deploy step to run by hand.**

```
push to main
  ├── GitHub Actions: checks (typecheck + lint) → flyctl deploy   [server]
  └── Vercel git integration                                       [web app]
```

Both fire on the same push. The server deploy is gated on the checks job;
the Vercel build is not gated by anything.

Every branch gets a Vercel preview URL. That is the review surface — the
working rhythm on this project is: small change, open a PR, look at the
preview, merge or iterate.

Manual server deploy, if one is ever genuinely needed:

```sh
flyctl deploy --remote-only          # from repo root; fly.toml is here
```

Deploying is a mutating action. Ask first.

## Access and credentials

| Thing | State |
| --- | --- |
| `FLY_API_TOKEN` | App-scoped deploy token for `shukajpes-api`. May be present in a session's cloud environment. Real production access. |
| `ADMIN_TOKEN` | Gates the write endpoints and opens the read ones. Value is unknown to anyone — Fly secrets cannot be read back. |
| `REPORT_TOKEN` | **Deliberately unset** (PR #408). `checkReportAuth` still accepts it, so re-opening the read endpoint to a narrow reader is one `fly secrets set` away. |
| `ALERT_CHAT_ID` | ✅ **Set (as of 25 Aug).** Ingest alerts land here, and the owner-report review button rides on it. |
| `CROSSPOST_CHANNEL_ID` / `_USERNAME` | ✅ **Set.** Owner reports publish to the public channel. `CROSSPOST_GROUP_IDS` is still unset, so district groups get no copy. |
| `TELEGRAM_CHANNELS` | **Not set.** The channel-scrape source is a no-op until it is. |
| `SCRAPE_PROXY_URL` | **Not set, and should stay that way.** Measured 17 Aug: residential exits are refused *more* than the Fly datacentre, not less. The seam is for the day the edge really hardens. |
| `DASHBOARD_TOKEN` | **Not set.** Read-only key for `/admin/console` + `/admin/metrics` — the only one of the three keys safe to keep in a browser. Until it is set the console 401s for everyone. |
| `DEV_TOOLS_PASSWORD` | **Not set.** Unlocks `/dev` (walk simulator + destructive territory test routes) per browser. Until it is set the dev affordances are off everywhere. |
| `SESSION_SECRET` | **Set it now** (≥16 chars): since D-69 a slip can carry an e-mail login, and the key should not be the bot token's shadow. Was optional: key for session tokens (`lib/session.ts`, D-62). Unset, the key is derived from `TELEGRAM_BOT_TOKEN`, which is already the key Telegram's own signatures rest on, so tokens work with no action. Set it (≥16 chars) to rotate sessions independently of the bot token; changing it logs every phone out once, transparently — the next request re-identifies the old way. |
| `INVITE_REQUIRED` | **Not set — the door is open.** With it set, new device ids must redeem an invite code; existing accounts are never gated. Mint codes with `pnpm --filter @shukajpes/server invite --new --uses=N --note=...` before flipping it. |
| `CHAT_DISABLED` | Not set (chat on). The no-deploy kill switch for all model calls. |
| `RESEND_API_KEY` + `EMAIL_FROM` | **Must be set before the door ships** (D-69). The verification and reset mails. `EMAIL_FROM` is `шукайпес <dog@<the domain>>` (a non-ASCII name is RFC 2047-encoded on the way out, stray quotes dropped; a value that cannot be parsed is named in the boot log as `[auth] EMAIL_FROM cannot be sent from` and does not switch verification on) and the domain must be verified in Resend (SPF + DKIM records at the DNS host) — mail cannot go out from `vercel.app`. Without both the door still asks for registration but cannot require verification, and says so in the boot log. Resend's free tier caps at 100 mails a day, which launch day will exceed: budget the $20 plan. |
| `APP_URL` | The public web app, where mail links point (`?verify=` / `?reset=`). Defaults to `https://shukaypes.vercel.app`; set it to the domain. |
| `REGISTRATION_REQUIRED` / `EMAIL_VERIFY_REQUIRED` | Unset = strict (the door is up, the link is required when mail is configured). `0` on either is the launch-day switch: the first takes the door down, the second keeps it up without the link. |
| Database | Supabase (Postgres). No direct credentials held in the repo. Reachable from the app host and from anywhere with the connection string. |

`flyctl` is **not preinstalled** in cloud sessions:

```sh
curl -sL https://fly.io/install.sh | sh
export PATH="/root/.fly/bin:$PATH"
```

### Rules about credentials

**Fly secrets cannot be read back.** Fly's own words: "we do not allow read
access to the plain-text values of secrets." A value not written down
elsewhere is gone — rotate rather than hunt for it.

**Cloud-environment variables are not a secrets store.** Anyone using the
environment can read them. The Fly token lives there anyway as a deliberate
tradeoff on a personal account, and it is app-scoped and revocable. Prefer
short expiries and re-minting.

**A token used in a `curl` is a token in the transcript.** "Generate it and
tell the human" reproduces the exact exposure it is meant to fix. There is
no way to both use a value in a session and keep it private. If a session
needs a report token while holding the Fly token: mint it, use it, unset it
in the same session.

**Never put a trailing `# comment` on a command handed to someone using
zsh.** Interactive zsh does not strip them — that is how a placeholder value
ended up as a live secret once.

**When printing a proxy or database URL, print the host and drop the
credentials.**

### What the permission file does and does not do

`.claude/settings.json` allows read-only `fly` commands, prompts on
mutating ones, and denies destroying an app or a volume outright. That file
cannot reason, so two things are on you:

**Ask before anything a person would want to have been asked about** —
deploying, restarting a machine, setting or rotating a secret, changing
scale, running a migration, or executing anything that writes to the
database. Not because a rule says to, but because the outcome is somebody
else's to accept.

**Nothing enforces the shape of a command you build yourself.** A permission
rule matches `fly ssh …`, not `bash -c "fly ssh …"`, not an absolute path to
the binary, not a script that shells out. Do not route around the rules. If
a call is prompting, that is the system working.

## Answering questions about production

**Read-only first, and the read-only tool is an HTTP endpoint:**

```
GET /admin/lost-dogs/report?format=text
```

Source counts, per-source ingest heartbeat, invisible-pet counts, and the
fallback-pin breakdown — no shell, no writes, no network egress. It answers
most questions about the pet table. Reach for it before `fly ssh`.

Authenticated by `ADMIN_TOKEN` (or `REPORT_TOKEN`, if one is ever minted
again). Both are checked by `checkReportAuth`, which **fails closed** on an
undefined token — with `REPORT_TOKEN` unset, a junk bearer and no bearer
both get 401.

Other read surfaces:

| Endpoint | Auth | Returns |
| --- | --- | --- |
| `/health` | none | `{ ok: true }` unconditionally. Fly's rotation check. |
| `/health/deep` | none | Checks Postgres and Redis; 503 if either is unhealthy. **Point an *external* uptime monitor here — do not repoint Fly's own check at it** (see the note below). |
| `/admin/metrics[?format=text]` | `DASHBOARD_TOKEN` or admin | Users, DAU/WAU, retention, ingest heartbeat, search funnel, chat token spend by model. Bots excluded structurally. |
| `/admin/console` | `DASHBOARD_TOKEN` | The same numbers as a page. Open with `…/admin/console?k=<token>` — the key is stripped from the URL bar on load and redacted in the request log. Read-only by construction. |
| `/stats` | bearer | Active counts, per-source breakdown, last 30 scrape-log rows. **No longer public** — it was leaking bot-ingested users' DM text. |
| `/admin/lost-dogs/scrape-log` | admin | The same, with auth and filters. |

**Why Fly's own health check stays on `/health`:** `/health/deep` fails on
Redis too, Redis is free-tier and flaky, and the app degrades gracefully
without it — so a Redis blip would mark a *serving* machine unhealthy and
take the app down. On a real database outage, restarting the machine fixes
nothing while costing the logs you would diagnose from. The deep endpoint
is for an external monitor that tells a human.

## Server-side CLIs

Run in the container (`fly ssh console -a shukajpes-api -C "node dist/…"`)
or locally against a `DATABASE_URL`.

| Command | Notes |
| --- | --- |
| `db:migrate` | Runs at container start automatically. |
| `clean:lost-dogs [--apply]` | Dead-photo and city sweep. **Dry by default.** The city half needs a connection OLX will talk to and so cannot run from the app host; it gives up after 8 consecutive 403s. |
| `expire:out-of-area [--apply]` | Catch-up sweep for out-of-city rows. **Dry by default.** Needs no network. Since #559 it also reads the stored **ad body** as a third, report-only bucket (a body is a story and can name another city in passing), and its "drawn on the map" warning asks `placementConfidence` rather than the fall-through pin. Excerpts go through `redactContacts`. |
| `expire:pet --id=<id> [--apply] [--photo] [--restore]` | **The takedown tool.** Dry by default; expire is reversible, `--photo` is not (opt-in, and the dry run says so); `--restore --photo` is refused rather than half-done. An unknown id fails loudly — a takedown that quietly matched nothing is the worst outcome, because somebody would report it as done. |
| `invite --new --uses=N --note=...` | Mint beta invite codes. Held in reserve — the beta is open. |
| `audit:pins` | Compare where each ad says the pet was lost against where it was pinned. **Independent of the parser on purpose** — matches text against the gazetteer directly, because a check that reproduces the thing it checks cannot fail. Prints no ad text. |
| `resolve:pins [--apply] [--apply-landmarks]` | Re-place pets from the owner's words. Dry by default; prints every candidate move with the pet's stored description beside it, and emits a **per-pet reversal UPDATE with the previous coordinates**. `--apply` is the invisible group only; `--apply-landmarks` moves pets that are already visible, which is the riskier half. Since #541 the groups come from `placement_source`, not from recomputing jitter — the jitter test silently skipped 28 pets on the parser's own hint table. |
| `label:pins [--apply]` | Backfill `placement_source` for rows placed before the column existed, by recomputation. **Never touches coordinates.** |
| `relabel:marked [--apply]` | Re-stamp a `gazetteer-bare:` label as `-marked:` where the resolver now reads the address as marked **and names the same place**. A changed answer is printed under its own heading and left for `resolve:pins`. Coordinates never touched; active rows only. |
| `judge:pins [--apply]` | Ask the placement judge about every bare/fuzzy-placed active pet. **Never moves a pet** — changes the label from unjudged to `gazetteer-judged:` (shown) or refused (hidden, with the model's one-line reason). The dry run **writes a plan file**; `--apply` replays it with no model call, skips rows whose label changed since, and refuses to run without a plan. First run 8 Sep: 33 kept, 11 refused. |
| `probe:location-text`, `probe:crosspost`, `probe:ad-phone` | Read-only probes. |
| `backfill:ad-bodies [--apply] [--repair]` | Fetch each pet's ad by its stored URL. **Three outcomes kept apart:** 200 stores the body, 404/410 marks `ad-gone`, anything else is left alone. `--repair` re-fetches bodies already stored (used to undo the CSS pollution). |
| `expire:no-post [--apply]` | Expire only the `ad-gone` rows. Refuses to write if no scraped pet has a body at all. Dry run lists **newest first** behind an age histogram. |
| `census-contacts` | How much owner contact the corpus holds, in counts only — never a fragment of a body. |
| `audit-ingest` | What the ingest missed and what it let through. |
| `clean:ad-bodies [--apply]` | Strip OLX section labels welded to the next word (`Описменя`). |
| `flag-found-reports [--apply]` | Mark ads where somebody *found* an animal, so they stop appearing as pets to go looking for. |
| `revive:live-ads` | Bring back a pet whose ad is serving again. |
| `check` (`pnpm check`) | All **nineteen** fixture checks — placement judge, placement confidence, lore walk, lore match, enrich parse, out-of-area, ingest alert, pet identity, per-user rate limiting, invite gate, dev auth, session token, contact redaction, ad-body containment, ad extraction, found reports, owner reports, place resolution, route coverage. **Runs in CI on PRs and before deploy.** |
| `seed:lore`, `seed:gazetteer` | One-off corpus builds from OSM. |
| `enrich:lore [--apply] [--only osm\|links\|detail\|case\|title] [--limit N] [--id osm:…]` | Gives `kyiv_lore` its "read more". **Dry by default.** `osm` stores each row's OSM facts (inscription, description, date, commemorated subject, artist…) — the seed only ever read `name`, and 888 of the 2405 unlinked rows carry one of these. `links` finds the Wikipedia article for rows without one, most certain first: the `wikidata=` entity's sitelink (+24), the `subject:*` tags' article about whom the memorial is for (+122), the row's own name as an article title when it reads as a person's name (~+316, 70/120 sampled all correct), and last the uk.wikipedia article geotagged at the spot matched by name (~+58, fuzzy). Each handle is stamped in `wiki_source` so a tier can be audited or reverted as a group. `detail` has the model write the dog's 2–4-sentence telling from the article and facts for every row with research, and rewrites the one-liner of rows whose story was written before they had any. Facts and links cost nothing; detail is one Sonnet call a row (~$0.006) and the dry run prints the total. Idempotent — a crashed run resumes. The phases feed each other, and a dry run carries each phase's plan forward in memory so its counts match what the apply will do. `--only case` (opt-in, not part of the default run) puts the capitals back on proper names in every story and detail through Haiku, with a guard that throws away any answer that changed anything but letter case. `--only title` (also opt-in) gives rows named after a person a `title` that says what the object is — "Будинок, де працював Лесь Курбас" rather than "Лесь Курбас" — from the facts and detail through Haiku; the app shows `title ?? name`. Refused unless the answer keeps a word of the name, stays under 72 characters and is not a sentence, so a hallucinated title cannot replace a real name. Artworks skip the model: their title is built from the row's `artwork_type` alone ("Мурал «BB King»", "Скульптура «Корова»", and "Стріт-арт «…»" when OSM gave no type), with names that already say what they are left alone. First production run (6 Sep 2026): facts 2000, handles 226 → 745, details 1147, 926 one-liners rewritten; a snapshot of the pre-run stories sits in `kyiv_lore_story_backup`. |
| `db:seed-dogs` | Local dev only. Production runs on real scraped pets. |
| `wipe:stats` | Clears stats. |
| `wipe:users [--list] [--apply] [--snapshot=<file>]` | **The fresh start the door ships with (D-69).** Deletes every human `users` row and, by cascade, everything they own; keeps the `bot:N` rows; pets, sightings and search results stay with their reporter link set to NULL. Dry by default and prints the counts for every affected table; `--list` prints the rows; `--snapshot` writes them to JSON before the delete. Not reversible. Run **after** the door is deployed, once, before announcing. |

## Data changes

Anything that writes to `lost_dogs`, `sightings` or `users`:

1. **Dry run first.** `clean:lost-dogs` and `expire:out-of-area` are built
   this way on purpose — dry by default, `--apply` explicit, and they print
   exactly what the apply would do.
2. **A human reads the dry run before the apply.**
3. **Capture the affected ids before the write**, so the reversal exists.
   The 17 rows expired on 11 Aug have their reversal SQL recorded in
   `HANDOFF.md` §3.2.
4. **Prefer the reversible form.** `status = 'expired'` hides a row from
   every query the app makes and undoes with one UPDATE. `DELETE` cascades
   to sightings and does not. Nulling a photo URL is not reversible.

## Monitoring, such as it is

| Signal | State |
| --- | --- |
| Fly health check on `/health` | Running, every 30s. Only catches a dead process, not a wedged one. |
| Watchdog | Armed. Kills a process whose event loop has been blocked 30s. |
| Client crash reporting | **Exists since PR #419.** Root boundary + global handlers → `POST /client-errors` → Fly logs (`kind: 'client_error'`). Capped and deduped client-side. |
| Server error visibility | `setErrorHandler` masks 5xx bodies; `unhandledRejection` / `uncaughtException` handlers installed (several jobs are deliberately unawaited and Node's default is to crash). |
| Admin console / metrics | Built, **dark** — `DASHBOARD_TOKEN` unset, so it 401s for everyone. |
| Ingest alert | Built and **armed** since 25 Aug (`ALERT_CHAT_ID` set; the same chat receives owner-report review buttons). 36h of zero inserts should fire it. **Whether it has ever fired is not verifiable from Fly logs** — the log window is hours, and the tick on 12 Sep still read `inserted 0`. Ask the chat. |
| Spent-item janitor | Running daily since 6 Sep (`kind: 'spent_item_cleanup'` in logs). Bounded per tick, so a backlog shows as several days of full batches, not one big one. |
| External uptime monitor on `/health/deep` | **Does not exist.** Recommended by the audit; still not done. Needs an account, so it is the owner's. |
| Redis uptime alert | **Does not exist.** Redis silently degrades everywhere. |
| Scrape tick history | In-memory only (`routes/stats.ts`). Gone on every restart. |

## Incident history

Every one of these is in the codebase as a comment next to the fix. They are
collected here so a new session does not have to find them one at a time.

### 5 Aug 2026 — eleven-hour silent outage

Something blocked the event loop and never returned. A process that cannot
run its event loop also cannot log, cannot answer a health check, and cannot
crash — so it sat there looking healthy. Fly's health check noticed within
thirty seconds and had no way to act on what it noticed.

**Fix:** `services/watchdog.ts`. The main thread stamps the current time
into a `SharedArrayBuffer` once a second; a worker thread with its own event
loop reads that stamp and kills the process if it goes stale for 30s. Shared
memory rather than `postMessage`, because a message would land in exactly
the queue that is not being drained. Armed first thing at boot and stood
down last, *through* `app.close()` — a close that hangs is the same outage
as any other hang.

The suspected cause was territory geometry, which now runs in a worker
thread with a 2s bound (`services/groundWorker.ts`). The watchdog fixes the
class, not just the instance.

### Territory leaderboard took `/health` down

The leaderboard under the derived-shape model was a city-wide hull
computation. It once timed out at 60s and took the health endpoint down
behind it. Fixed by PR #363 — the leaderboard is now a `GROUP BY` over
stored `area_m2`.

### Redis idle-reaped

A free Upstash database was reclaimed by the provider for having nothing
connecting to it — the `lazyConnect` client only connected on first use, and
several guarded call sites meant "first use" sometimes never arrived.

**Fix (PR #265):** eager connect at boot, `redis.status === 'ready'` guards
everywhere, throttled error logging. The eager connect is doing two jobs:
keeping the database in use, and making the guards reliable (they would
otherwise skip forever if nothing ever connected).

**Still open:** confirm the current Redis is a paid/persistent tier and not
another idle-reapable free database.

### White-screen crashes from Rules-of-Hooks violations

At least four: #124, #136, #212, and #261 (the multiplayer PR, hotfixed
eleven minutes later). Each one made the app render nothing.

**Fix (PR #274):** real ESLint with `eslint-plugin-react-hooks`,
`rules-of-hooks` set to **error**, and the Fly deploy gated on it. The
frontend deploy is still not gated, so this class of bug can still reach the
web app first.

### `~$100 of Google Places burned in days`

The client called Google Places directly from every device on every map pan,
and each fetch is five Places calls.

**Fix:** `services/placesCache.ts` — the server proxies and caches by a
coarse (cell, category) key. Cell size 0.01° (~1.1km × 0.7km at Kyiv
latitude); a typical user fetch covers 2–6 cells. First user to ping a cell
pays one Google call per category; everyone else is served from
`places_cache`.

### OLX blocked, silently, for days

CloudFront's WAF began serving 403 to datacentre IPs. Every listing and
every ad fetch failed, and the tick still logged as complete at info level
with the errors folded into a field nobody greps for.

**Fix (PR #402, #403):** a tick that discovered items but ingested none of
them, or that recorded errors at all, is no longer a complete tick and says
so at a level that shows up. Plus a give-up threshold at 8 consecutive 403s.
**PR #412** added the alert that would have caught it in 36 hours instead of
days — and that alert is still dormant for want of `ALERT_CHAT_ID`.

*Postscript, 17–18 Aug: the 403s were never a block at all, and the reason
nothing new was arriving was a third thing again. See below.*

### OLX: a month spent working around a diagnosis that was wrong

The most expensive mistake in the record, and it was a *reasoning* failure
rather than an outage. `scrapeFetch.ts` asserted "CloudFront blocks the
address, not the request", and that sentence disabled the retry sitting
directly below it. Half of every scrape tick was thrown away for weeks,
described as "OLX is half-blocked", and planned around — including a proxy
subscription bought to solve it.

The original observation was real but **confounded**: it compared a home
*browser* with a datacentre *Node client* and attributed the difference to
the address. Two variables, one conclusion. A later probe that seemed to
confirm the block used a URL that had been **invented** rather than taken
from the source, so its "page not found" was evidence about a fake path.

Separating the variables took eight requests: `403 200 403 200 403 200 403
200`. Fixed by deleting one condition. Errors 7 → 0, discovery 251 → 508.

Then the *real* reason no pets were arriving turned out to be different
again — the scraper had saturated against relevance-ordered page one and
had literally run out of new ads to see, while every log line read `tick
complete`.

**Operational rules that came out of it:** do not add a backoff to the
scrape retry (it rides the warm connection; any pause disables it); do not
set `SCRAPE_PROXY_URL` on the current evidence; and read `scrape_log` or a
tick summary rather than probing OLX by hand — a hand-run request and the
cron's get different answers from the same address.

### 3 Sep 2026 — a placed pet vanished the evening he was placed

«Коля» was re-placed at his circus from his own ad on the morning of 3 Sep.
That evening a sighting arrived carrying the client's Kyiv-centre fallback —
geolocation refused, the device did not know where it was — and the server
measured it inside 2× the pet's radius, trusted it, and moved him onto the
parser's fall-through pair, which both map queries filter out by exact
match. One constant did three jobs (parser fall-through, client fallback,
map filter), so no one of them could see the failure. Fixed in #544:
`POST /sightings` answers 400 to an invented position; the walk still pays
the paws. See D-65.

### 5 Sep 2026 — 270 of 500 MB, and the pets were not what filled it

Checked while asking whether the database was near its tier. 175 MB was
collected tokens and eaten bones that nothing had ever deleted since
April; May alone added 226,309 tokens. A daily janitor now prunes spent
rows older than seven days in bounded batches (#545, D-66). **The file
does not shrink until somebody runs `VACUUM FULL` in a chosen window** — it
takes an exclusive lock, so it is not in a cron. Open as P2-20.

### 8 Sep 2026 — the app locked itself behind its own gate during an alarm

Reported from Kyiv during an air-raid alarm: map loads, no «нюх-нюх», no
buttons, no HUD, nothing to tap, and it does not recover. Alarms come with
GPS spoofing that jumps people across the city; the dog's steps are capped
at a jog, so it was left kilometres behind, and `MapView` hides an
off-screen companion — including the gate that is its child. Reproduced by
driving the real bundle with fixes teleporting around Kyiv every 30–100ms.
Fixed in #561 with a 300m snap on fix and tick, and the off-screen rule
stopping at the gate (D-67).

### Rate limiting was global, silently, since it was added

The plugin installed at `onRequest`; auth sets `req.userId` at
`preHandler`, which runs later — so the per-user keyGenerator never saw a
userId, fell through to `req.ip`, and behind Fly's proxy with `trustProxy`
unset, that was the proxy's address: **one bucket for the entire service**.
Chat's "30/min per user" was thirty per minute for everybody combined. It
read completely correct in review.

**Fix (PRs #417, #418):** `hook: 'preHandler'` + `trustProxy`, proven
per-user against production with two device ids, then named tiers on the
nine routes that had none at all. `check:route-coverage` asks Fastify what
it registered and fails CI if a route ships unlimited.

### Every auth failure returned 500, briefly

The `setErrorHandler` added for safety read only `err.statusCode ?? 500`,
and the auth hook refuses by setting the code on the reply *then* throwing
a plain `Error` — so the handler overrode the 401/403 already sitting on
the reply. Latent but serious: the client detects the invite-gate door with
`status === 403`, so flipping `INVITE_REQUIRED` on would have shown
uninvited testers a silently-broken app instead of the door screen.

**Fix (PR #428):** the handler respects a status already set on the reply.
Found by a browser test noticing a stray 500 on `/favicon.ico` while
checking something else. A regression shipped and fixed within the same
session, recorded because the *shape* — a safety net masking the signal it
sits in front of — is worth remembering.

### 12 Sep 2026 — no verification mail came

The door's first real registration: the verify screen said the letter
went, no letter came. `fly logs` had the answer in one line —
`kind:"email_send", status:422, "Invalid \`from\` field"`: Resend
refused `EMAIL_FROM`, set as the docs said (`шукайпес <dog@…>`), and
the value could not be read back to see why. Registration completed
regardless (mail failure is a return value, by design), so the person
was stuck on a verify screen that could never be passed.

Two things fixed: the sender is now parsed and re-formatted before the
call (`lib/mailFrom.ts` — non-ASCII name encoded, quotes dropped), and
a value that cannot be parsed is named in the boot log and does NOT
switch verification on. The lesson is older than this incident: a
config value that a vendor validates must be validated at boot, where
the operator is looking, not at the first request, where a stranger
is.

## Standing rules

- Work on the branch the session was given. It changes per session. Never
  push elsewhere without asking.
- Open a PR when a task is done; the owner merges manually.
- **A merged PR is finished.** Restart the branch from `origin/main` for
  follow-up work rather than stacking onto merged history.
- `pnpm -r typecheck`, `pnpm -r lint` and `pnpm check` before every PR. The
  lint baseline is **0 errors, 21 `react-hooks/exhaustive-deps` warnings**;
  `pnpm check` is fourteen fixture checks and all must pass. Verified on
  20 Aug at `43808c6`. **The lint baseline is 23, not the 21 `CLAUDE.md`
  still states** — it drifted to 22 during the walk work and to 23 with
  `LostFlowModal`, both ordinary `exhaustive-deps` warnings matching
  sibling modals.
- When a check cannot run — blocked, throttled, unauthenticated — **say so
  loudly.** A check that read nothing must never be reported as a check that
  found nothing.
