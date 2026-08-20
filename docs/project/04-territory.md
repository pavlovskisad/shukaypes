# 04 — Territory

The dominant mechanic since late July 2026, and the single largest system in
the codebase (`services/territory.ts`, 1,021 lines, plus `ground.ts`,
`groundGeometry.ts`, `groundWorker.ts`, `utils/territoryShapes.ts`).

It was designed and rebuilt in public over 65 PRs (#328–#392). This document
describes the model that survived, and — because that matters more — why
each of the three earlier models did not.

## The one-line version

Your dog marks ground as you walk. What it marks, you hold. You lose a piece
when somebody else walks over it and marks. Holding ground pays passively,
and there is a city-wide standing.

## The model

### Ground is stored; marks grow it

Two tables:

- **`territory_marks`** — where the dog has been. Individual points, with
  `closed_loop` set when a mark completed a ring.
- **`territory_ground`** — **the ownership record.** One row per piece: a
  ring plus its holes in `[lng, lat]` order (the winding both polygon
  clipping and GeoJSON use, so it goes in and out of the clipper without
  conversion), plus bbox columns and a stored `area_m2`.

A mark does exactly two things, both **once, at the moment of marking**:

- **GROW** — the hull of the mark and its nearby marks (within
  `claimNeighbourM`) is unioned into what the owner holds.
- **CUT** — the same hull is subtracted from every rival piece it covers,
  and the rival marks inside it go with the ground.

That single design choice is what makes everything else work: two owners can
never overlap, a loss is permanent without anything having to remember it
later, and a read is a **box query** rather than a city-wide partition.

### Why this, and not the three things it replaced

**Model 1 — a cell grid with strength (PR #328).** ~110m lat/lng
quantisation, each cell carrying a `strength` that decayed 25/day computed
on read, rendered as a MapLibre heatmap so it read as scent rather than a
boardgame. Retired because ownership on a grid cannot make a shape, and the
shape is the thing people look at.

**Model 2 — the hull of your live marks (PRs #333–#338).** A territory *was*
the polygon around your live marks, recomputed on every read with rival
overlaps subtracted at draw time. This is the elegant version and it is
wrong, because it cannot express the one thing territory has to do: **lose a
piece and keep the rest.** A shape recomputed from dots has nowhere to
remember a bite. An overrun dot could only

- **survive** → the ground came back when the rival's marks faded,
- **die** → the whole shape collapsed, to *nothing* at three dots, the
  minimum that encloses anything, or
- **move** → the shape changed into something that was never the cut.

All three are wrong and no fourth answer exists while the shape is derived.

**Model 3 — global claims.** Under stored ground, a claim was initially the
hull of the whole transitive cluster of your marks. That meant every mark
re-claimed everywhere the dog had ever walked: districts of paint, and
captures on the far side of the city from a mark made here. **A claim is
LOCAL now** (PR #364) — the union is what accumulates a territory, so a
claim only has to cover the ground around the mark that made it.

The cost side of model 2 is worth recording too. It clustered every mark
within 5km, built a hull per cluster and ran polygon subtraction between
neighbours — per sync, per player, on a shared vCPU. That measured
0.96–3.5s on prod, behind a stale-while-revalidate cache that existed only
to stop it running every time. The leaderboard was the same computation
city-wide, which is why it once timed out at 60s and took `/health` down
behind it.

Under stored ground, measured against the same 30-bot city:

```
owners pieces    area   verts  maxring |  sync   payload
  30     45     887ha    477      31   | 0.00s   21.9KB
```

The cache, its cell grid, its single-flight guard, the event-loop yielding,
a `TERRITORY_PARTITION` kill switch and ten balance knobs all went with it.
The leaderboard is now a `GROUP BY`.

## The rules

These are invariants, not preferences. Breaking one breaks the mechanic.

**Marking is the same gesture for attack and defence.** You do not press a
"raid" button. You walk somewhere and the dog does what dogs do.

- Near **your own** live marks → they renew, and the hull they draw extends
  what you already hold.
- Over a **rival's** ground → they lose exactly the piece your new shape
  covers, and the marks inside it go with it. Everything outside stands:
  their other ground, their other dots. To take it back they walk it and
  mark it out again, which is what it cost to take in the first place.

**Territory is the polygon between your dots.** Nothing is grown outward,
nothing is inflated to meet a neighbour. Two owners share a border when one
of them has actually walked into the other's ground. Open country between
two dogs that never meet stays open country.

**What you see is what you hold.** A mark only ever sits on ground its owner
holds or on nobody's, because a capture takes the marks inside it along with
the ground. No dot is quietly waiting under someone else's colour to spring
the border back.

**No marking on ground you already hold** (`markOnlyOutsideOwnGround`). A
mark inside your own territory moves no border, so the dog only marks at the
frontier or on somebody else's ground. Every mark either extends a territory
or takes one. This is a direct question — is this point inside a piece I own
— rather than the two proxies it went through while ground was derived.

**Every mark is equal.** There was a strength tier once: marks hardened to 3
on repeat visits and took as many rival marks to remove. It made the state
of a border impossible to read or count — two zones touching told you
nothing about who was winning without knowing the hidden number under each
dot. One mark, one claim.

**Marks decay; ground does not.** `markTtlDays` is 4, applied as a read-time
filter on `created_at` rather than a sweep, so an untouched mark costs
nothing until someone looks at it. Expiry only limits the hull the *next*
mark draws — it never takes back ground already held. Ground changes hands
one way: somebody walks in and marks over it.

## Where it hangs off the system

**The mark hook is `POST /collect/path`** (`routes/path.ts` →
`markIfDue`). That endpoint already owns the previous position anchor in
Redis and rejects teleports, so territory inherits the anti-cheat for free:
a tampered client cannot claim ground it did not walk to any more than it
can farm paws it did not walk to. **No new trust surface.**

A territory hiccup never breaks a walk — the mark is attempted after the
paw/bone sweep and its failure is logged and swallowed.

**Reads come through `/sync/map`**, first and alone, because the spawn
top-up branches on the `home` flag it produces. One box query serves the
dots, your shapes, everyone else's, the rival marks and `home`.

**`on_home_ground` is denormalised onto `companion_state`** and written on
sync. The decay cron is one bulk UPDATE across every row; it can branch on a
column but it cannot go and compute a hull per user.

**Raids are queued in Postgres**, not Redis. A raid that lands overnight
still has to reach you, and a 2-minute TTL would drop it.
`territory_raids` rows are delivered on the victim's next sync and then
marked seen. `raiderName` is denormalised so the notification needs no join
on the sync path and does not break if the raider is ever removed.

**The standing lives in the quests tab**, not on the map, and
`/territory/leaderboard` is its own trip — putting a scoreboard on the 15s
sync would recompute something nobody is looking at. The board and your
standing are computed **sequentially on purpose**: the standing needs the
board to find your rank in it, and running both concurrently would have each
miss the cache and recompute every hull in the city twice.

**Area held is deliberately absent from `/sync/map`.** One endpoint owns
that number. Two places computing it is how they drift.

## Home ground

Holding ground pays, and all of it is passive — nothing to activate, nothing
to remember, and the reward still lands on a player who never learns the
mechanic has a name.

| Perk | Value |
| --- | --- |
| Extra paws in the spawn pool on your own streets | `homeExtraPaws: 10` |
| Happiness decay rate on home ground | `homeHappinessDecayFactor: 0.5` |
| Tolerance around a piece's edge that still counts as home | `homeEdgeM: 60` |

Plus the standing, which is the part that makes people care: total area
held, ranked, summed straight off the ground each owner is standing on.

## The knobs

`server/src/config/balance.ts`, the `territory` block. The two that set the
whole feel are env-overridable, because finding the right pair takes walking
around with it rather than a redeploy per guess.

| Key | Value | What it does |
| --- | --- | --- |
| `cooldownMs` | 20,000 (`TERRITORY_COOLDOWN_MS`) | Minimum time between marks |
| `minDistanceM` | 40 (`TERRITORY_MIN_DISTANCE_M`) | Minimum distance between marks |
| `claimNeighbourM` | 250 | How far from the dog a single mark paints |
| `markTtlDays` | 4 | Mark lifetime |
| `hungerCost` / `happinessGain` | 1 / 1 | Wire into the bones/paws economy |
| `minHappiness` / `minHunger` | 0 / 0 | **Mood gates, temporarily off** |
| `shapeEdgeMaxM` | 120 | Longest edge a claim hull may span |
| `shapeMinMarks` | 3 | Minimum marks to enclose anything |
| `contestM` / `refreshM` | 110 / 110 | Capture and renew radii |
| `rivalViewRadiusM` | 5,000 | How far out rival ground is fetched |
| `rivalPiecesDrawn` | 140 | Payload dial — see below |
| `groundPiecesInView` | 240 | Cap on pieces returned per sync |
| `raidTtlHours` | 48 | How long an undelivered raid survives |
| `leaderboardSize` / `leaderboardCacheMs` | 10 / 5 min | Standing |
| `botMaxMarks` | 12 | Ceiling on a bot's live marks |

### The cadence, and why it changed

**150s / 140m → 20s / 40m.** The old pair was sized around a mark being a
rare, deliberate claim: 8–13 on a 30-minute walk, each one a big step of a
border. It made territory out of a handful of far-apart points, so every
outline was a wide polygon between four or five dots — the straight-edged
look.

Marks 40m apart draw a boundary that *follows* the walk instead of spanning
it: the hull has a dozen points around a corner rather than one, so ground
comes out curved and shaped like the streets somebody actually walked.
Marking is the loop now, not a rare event.

20s is set **below** the spacing for an ordinary walker (40m at 1.4 m/s is
~29s), deliberately: distance should be what paces a claim, so a dog that
stands still claims nothing however long it waits, and one that covers
ground claims as fast as it covers it.

The costs came down with it — 3 hunger and 4 happiness per mark became 1 and
1 — because sixty marks a walk at 3 hunger apiece would starve the dog from
doing the thing the game is about.

### `claimNeighbourM`, and what the number means

350 → 1000 → 500 → **250**, and the last step is the one that matters,
because what the number *means* changed underneath it.

While a territory was recomputed from marks, this was the **linking**
distance: how far apart two marks could be and still belong to one shape. It
had to be generous or a walk came out as confetti, and the price was that
one mark could bridge two clusters and swallow everything between them at a
stroke.

Ground is stored now, so linking is not this number's job — the union is
what turns many claims into one territory. All it decides is how far from
the dog a single mark paints. At 500 that was a disc up to a kilometre
across per mark: whole screens of colour, and a mark on one edge quietly
re-cutting a neighbour on the far side. Measured on prod, pieces spanned up
to 1184m. At 250, with marks landing every ~55m, a claim is the polygon
around the eight or ten marks nearest the one that made it.

## How it looks

The data model and the render are separate concerns, and the render was
reworked across ~25 PRs in August (#433–#484) without the ownership rules
moving at all.

**Ground is drawn as a soft "scent field", not as polygons**
(`territoryHeatLayer.ts`, PR #433). The server's shapes are triangulated
with `earcut` into a quarter-resolution offscreen buffer, blurred by a
separable gaussian whose radius tracks zoom so the soft edge stays a
roughly constant **~22 metres of ground** — soft underfoot at street zoom,
near-crisp when the whole city is on screen — then re-thresholded with a
smoothstep centred on 0.5 so **borders stay exactly where the server put
them**. A world-anchored noise wobble gives the edge a meander, and
un-premultiplying the blurred colours makes two owners' ground crossfade
through a gradient where they meet instead of butting at a hairline. Your
own ground still draws last, so "which bit is mine" stays authoritative.

This deliberately revisits the heat look that **Model 1 died with** — and
the distinction matters: Model 1's failure was the *grid data model*, not
the softness. Soft rendering over stored polygons is not the same thing as
owning ground on a grid.

`TerritoryLayer.tsx` keeps the old flat fill as a fallback: if the custom
layer's GL setup fails on a device it reports once and swaps back, so
territory never silently disappears.

**Buildings take their paint from the ground field** so they fade with it,
and the territory lens desaturates the base map so ownership colours read
against a calm ground. The leaderboard draws each owner's actual territory
as a portrait silhouette (`BoardRow.tsx`, `TerritoryMini.tsx`) in the map's
own palette, and tapping a row jumps the camera to that ground — to the
owner's dog itself when they are online.

## Reliability

**Geometry runs in a worker thread** (`services/groundWorker.ts`), bounded
by a 2s timeout, and is warmed at boot so the spawn cost is not paid inside
the first claim's transaction where it would be held under advisory locks.

**Vertex growth is the standing risk.** Union and difference both add points
and never remove them. Every write simplifies — points within 3m collapse,
and a ceiling of 120 drops the shallowest corners. After eight minutes of
thirty bots fighting, the largest ring was 31 points and the average 10.6.
Worth re-checking after long stretches of real play.

**Sliver sweeps** (migration `0029`) close pockets too small to mean
anything while keeping the ones that do.

**Concurrent claims** take advisory locks so two owners cannot both cut the
same piece.

## Wipes

Territory has been wiped from production **five times**, deliberately, and
each wipe has its own migration: `0028`, `0030`, `0031`, plus the truncate
in `0027`. Every one for the same reason — every claim in the database had
been produced under a rule that no longer existed, so the map was showing
geometry that the current code could never have made.

Wipes are **irreversible**. If a sixth is ever needed, it needs the same
treatment: its own migration, stated in the PR body, with the reason.

`POST /territory/reset` wipes *your own* ground only, so it needs no special
guard and makes the mechanic re-testable from a clean slate without going
near the database. `POST /territory/raid-test` sends a bot onto your newest
mark so the raid path can be exercised without waiting for one to wander in.

## Known and deferred

- **Territory decay is undesigned.** Ground only ever ratchets upward.
  The owner deferred this, but the motive is real: with no decay and no
  contest, a city eventually saturates.
- **`groundIn` takes 240 pieces with no `ORDER BY`.** Harmless at current
  fragmentation, will bite eventually.
- **Sync payload is ~215KB with every nearby owner drawn** (~52MB/hour on
  cellular). `rivalPiecesDrawn` is the dial.
- **The mood gates are off** (`minHappiness: 0`, `minHunger: 0`). The idea —
  a miserable or starving dog will not mark — is what wires territory into
  the bones economy. They came off because a walk that silently stops
  producing claims is impossible to tell apart from a bug in the claiming.
  Restore to roughly 30 / 15 to switch them back on; the code that reads
  them is untouched.
- **Bot tuning has been reverted to walking pace**, and that is worth
  knowing because the code comments still narrate the sprint era. During
  PR #363's tuning, bots ran at 9–12 m/s on a 15s cooldown so a city's
  worth of borders would move while you watched. Both are back: `SPEED_MIN`
  / `SPEED_MAX` are 2.0–3.0 m/s, dwell is 8–30s, and the cadence is now one
  pair for bots and players alike (`botMarkCooldownMs` survives only in a
  comment). At 10 m/s a 20s cooldown put marks 200m apart, which is exactly
  the wide-polygon look the cadence change was trying to leave behind.
