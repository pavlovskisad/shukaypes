# шукайпес — project documentation

The map and the source of truth. Ten documents, each with one job.
Written 11 Aug 2026 against `f421b7e`; last updated **20 Aug 2026** against
`43808c6` (PR #494 merged), folding in the beta-readiness pass, the
ingestion rescue, landmark walks and the mode-switcher front door.

## Read in this order

| # | Doc | What it answers |
| --- | --- | --- |
| — | this file | Where everything is, and how to keep it true |
| 01 | [`01-product.md`](01-product.md) | What the product is, who it's for, what the loops are, what's actually built |
| 02 | [`02-architecture.md`](02-architecture.md) | How the system is put together — stack, topology, data model, endpoints, deploy |
| 03 | [`03-lost-pet-engine.md`](03-lost-pet-engine.md) | The data engine: sources, parsing, dedupe, geo gates, and what the table looks like today |
| 04 | [`04-territory.md`](04-territory.md) | The territory mechanic: the model, the rules, the invariants, the knobs |
| 05 | [`05-decisions.md`](05-decisions.md) | Every architectural decision that is still load-bearing, with why and when |
| 06 | [`06-history.md`](06-history.md) | How we got here — the arc of 494 PRs and every pivot in it |
| 07 | [`07-operations.md`](07-operations.md) | Running it: deploys, secrets, admin tools, incidents, the things that have gone down |
| 08 | [`08-open-issues.md`](08-open-issues.md) | What is wrong right now, ranked, with what has already been fixed struck off |
| 09 | [`09-glossary.md`](09-glossary.md) | The vocabulary this project uses for its own parts |
| 10 | [`10-product-brief.md`](10-product-brief.md) | **Standalone** product outline + running costs — the substrate for business/strategy work; readable without the rest |

## Precedence

**The code wins.** Every doc here, including this one, is a description of
code that can change without the description changing with it. When they
disagree, the code is right and the doc is a bug.

After the code, in order: these docs → `CLAUDE.md` (working rules) →
`HANDOFF.md` (a point-in-time production snapshot) → the older docs listed
below.

### Older docs, and what is still true in them

None of these are deleted — they are the written record of decisions that
were real when they were made. But do not plan off them.

| File | Status |
| --- | --- |
| `AUDIT_BRIEF.md` (PR #267, 2 Jul) | Architecture map, accurate for its date. **Predates territory entirely.** Its §0-corrected claims about PostGIS are wrong — see `AUDIT_FINDINGS.md` §0. |
| `AUDIT_FINDINGS.md` (2 Jul) | Ranked P0–P3 findings. Several are fixed; see [`08-open-issues.md`](08-open-issues.md) for which. Still the best single writeup of the auth and abuse surface. |
| `PILOT_ROADMAP.md` (PR #275, 4 Jul) | Product state + road to pilot. Its "in-flight PRs" section stops at #274, and its §4 question ("what does pilot mean") has since been answered — a closed beta of 50–150 on real data. Read it for the gap-by-dimension framing, not for status. |
| `HANDOFF.md` (11 Aug, §0 rewritten 13–18 Aug) | Live production state as of the last session, and the deepest record of the August ingestion work — §0.1b–0.1g are worth reading in full before touching the pipeline. §0.2 is the owner's pre-beta checklist. Overlaps [`07-operations.md`](07-operations.md) and [`08-open-issues.md`](08-open-issues.md); those two are the durable versions, HANDOFF is the snapshot. |
| `README.md` (root) | Setup + deploy instructions. Its "Phases" list stops at Phase 6 and does not describe anything after Phase 5. |
| `docs/TECHNICAL.md`, `docs/PRODUCT_SPEC.md`, `docs/TRANSFORMATION.md`, `docs/PROJECT_README.md` | Written against the original single-file HTML prototype and the migration plan out of it. Historical. `TECHNICAL.md:236` still contains a compromised Google Maps key — see [`08-open-issues.md`](08-open-issues.md). |
| `docs/rfp/*` | Studio briefs and a binding tech spec, written for market price discovery (PR #197, #202). A snapshot of the product as pitched, not as built. |

## How to keep this true

Cheap rules, because expensive ones get skipped.

1. **A PR that changes behaviour updates the doc that describes that
   behaviour, in the same PR.** Not later. The docs above went stale
   because "later" is where documentation goes to die.
2. **A decision goes in [`05-decisions.md`](05-decisions.md) when it is
   made,** with the PR number. A decision nobody wrote down gets
   re-litigated in six weeks by someone who cannot tell it apart from an
   accident.
3. **A pivot goes in [`06-history.md`](06-history.md) with what it
   replaced and why.** The "why" is the part that has value; the "what"
   is recoverable from git.
4. **Numbers carry their date and their source.** "244 active pets
   (11 Aug, `/admin/lost-dogs/report`)" ages honestly. "244 active pets"
   becomes a lie in a week and nobody can tell when.
5. **A superseded doc gets a banner, not a delete.** The reasoning in a
   wrong doc is often the most useful thing in the repo — see
   `HANDOFF.md` §5, which is entirely a list of things that turned out
   to be false and is the most-cited section in it.

## Facts verified at the time of writing

Run against `43808c6` on 20 Aug 2026, with `pnpm install --frozen-lockfile`:

```
pnpm -r typecheck     shared / server / app — all clean
pnpm lint             23 problems (0 errors, 23 warnings)
pnpm check            12 fixture checks — all pass
                      (48 routes: 45 limited, 3 knowingly exempt)
```

The 23 warnings are all `react-hooks/exhaustive-deps` and that is the
current baseline. **Note it has drifted**: `CLAUDE.md` still says 21, which
was true on 11 Aug. PR #490 measured `origin/main` in a scratch worktree at
22, and PR #494 added one more from `LostFlowModal`'s effect, matching six
sibling modals. Anyone treating 21 as the bar will read two ordinary
warnings as a regression.

`pnpm check` has run in CI since PR #416 and now carries twelve checks:
out-of-area, ingest alert, pet identity, per-user rate limiting, invite
gate, dev auth, contact redaction, ad-body containment, ad extraction,
found reports, walk stops, route coverage.
