# Working on шукайпес

## Production is real

This app coordinates searches for pets that real people have lost. The
lost-pet table is not test data; the sightings table holds reports from
real people who walked real streets. Losing a row loses somebody's
information about their animal.

## The Fly token

Sessions may hold `FLY_API_TOKEN`, an app-scoped deploy token for
`shukajpes-api`. It is real production access. `.claude/settings.json`
enforces the coarse rules — read-only `fly` commands run freely,
mutating ones prompt, and destroying an app or a volume is denied
outright. That file cannot reason, so:

**Ask before anything a person would want to have been asked about.**
Not because a rule says to, but because the outcome is theirs to accept:
deploying, restarting a machine, setting or rotating a secret, changing
scale, running a migration, or executing anything that writes to the
database.

**Nothing enforces the shape of a command you build yourself.** A
permission rule matches `fly ssh …`, not `bash -c "fly ssh …"`, not an
absolute path to the binary, not a script that shells out. Do not route
around the rules; if a call is prompting, that is the system working.

**Read-only first.** `GET /admin/lost-dogs/report?format=text` answers
most questions about the pet table — counts, per-source ingest
heartbeat, what the invisible rows are — with no shell and no writes.
Reach for it before `fly ssh`.

**A token is not a mandate.** Having access to do something is not the
same as having been asked to. The scope of the work is what the human
asked for.

## Data changes

Anything that writes to `lost_dogs`, `sightings`, or `users` gets a dry
run first, and the dry run gets read by a human before the apply.
`clean:lost-dogs` is built this way on purpose: dry by default, `--apply`
explicit, and it prints exactly what the apply would do.

Prefer the reversible form. Expiring a row (`status = 'expired'`) hides
it from every query the app makes and can be undone with one UPDATE;
deleting it cascades to sightings and cannot. Nulling a photo URL is not
reversible — the URL is gone — so only do it on a definitive 404.

## Measure before building

Several confident conclusions in this project's history were wrong
because they were reasoned rather than counted: a population guessed at
instead of measured, a filter audited through the filter it was testing,
an intermittent outage called permanent. The database is one query away.
Ask it.

When a check cannot run — blocked, throttled, unauthenticated — say so
loudly. A check that read nothing must never be reported as a check that
found nothing.

## Workflow

- Develop on the branch the session was given. Never push elsewhere
  without asking.
- Open a PR when a task is done; the owner merges manually. A merged PR
  is finished — restart from `origin/main` for follow-up work rather
  than stacking onto merged history.
- `pnpm -r typecheck` and `pnpm -r lint` before every PR. Lint carries
  21 pre-existing `react-hooks/exhaustive-deps` warnings and 0 errors;
  that is the baseline, not a regression.
- Pushing to `main` deploys automatically (typecheck + lint gate, then
  `flyctl deploy`). There is no separate deploy step to run, and no
  reason to run one by hand.

## Secrets

Fly secrets cannot be read back — "we do not allow read access to the
plain-text values of secrets." A value not written down elsewhere is
gone; rotate rather than hunt for it.

Cloud-environment variables are **not** a secrets store: anyone using
the environment can read them. Prefer short-lived, narrowly-scoped
tokens, and never echo a credential into a commit, a log line, a PR
body, or the transcript. When printing a proxy or database URL, print
the host and drop the credentials.
