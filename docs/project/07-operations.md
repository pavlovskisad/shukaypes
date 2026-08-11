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
| `ALERT_CHAT_ID` | **Not set.** The Telegram chat ingest alerts go to. Until it is set, a stalled pipeline is logged and nothing is sent. Not a secret — a chat id. |
| `TELEGRAM_CHANNELS` | **Not set.** The channel-scrape source is a no-op until it is. |
| `SCRAPE_PROXY_URL` | **Not set.** The proxy seam is inert; scrape traffic goes out direct. |
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
| `/health/deep` | none | Checks Postgres and Redis; 503 if either is unhealthy. **Point an uptime monitor here.** |
| `/stats` | none | Active counts, per-source breakdown, last 30 scrape-log rows. |
| `/admin/lost-dogs/scrape-log` | admin | The same, with auth and filters. |

## Server-side CLIs

Run in the container (`fly ssh console -a shukajpes-api -C "node dist/…"`)
or locally against a `DATABASE_URL`.

| Command | Notes |
| --- | --- |
| `db:migrate` | Runs at container start automatically. |
| `clean:lost-dogs [--apply]` | Dead-photo and city sweep. **Dry by default.** The city half needs a connection OLX will talk to and so cannot run from the app host; it gives up after 8 consecutive 403s. |
| `expire:out-of-area [--apply]` | Catch-up sweep for out-of-city rows. **Dry by default.** Needs no network. |
| `check:out-of-area` | 31 fixture cases for `detectOtherCity`. Run after touching the city list — its failure mode is expiring a real Kyiv pet. |
| `check:ingest-alert` | Exercises the alert state machine in memory. Messages nobody. |
| `seed:lore`, `seed:gazetteer` | One-off corpus builds from OSM. |
| `db:seed-dogs` | Local dev only. Production runs on real scraped pets. |
| `wipe:stats` | Clears stats. |

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
| Ingest alert | Built, **dormant** — `ALERT_CHAT_ID` unset. |
| External uptime monitor on `/health/deep` | **Does not exist.** Recommended by the audit; still not done. |
| Client error tracking | **Does not exist.** Crashes surface when a human notices. |
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

## Standing rules

- Work on the branch the session was given. It changes per session. Never
  push elsewhere without asking.
- Open a PR when a task is done; the owner merges manually.
- **A merged PR is finished.** Restart the branch from `origin/main` for
  follow-up work rather than stacking onto merged history.
- `pnpm -r typecheck` and `pnpm -r lint` before every PR. The baseline is
  **0 errors, 21 `react-hooks/exhaustive-deps` warnings** — verified on
  11 Aug at `f421b7e`. That is not a regression.
- When a check cannot run — blocked, throttled, unauthenticated — **say so
  loudly.** A check that read nothing must never be reported as a check that
  found nothing.
