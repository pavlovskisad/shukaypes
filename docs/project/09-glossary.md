# 09 — Glossary

The vocabulary this project uses for its own parts. Several terms are
overloaded or are fossils from an earlier design, and those are flagged.

---

**Ambient turn** — a companion chat message the server initiates rather than
the user. Runs on Haiku, ~60% of all chat calls. Contrast **active turn**,
which is user-initiated and runs on Opus.

**Bone** — the food item. Only bones feed the dog; paws are a treat. Spawns
in and around parks. Table `food_items`.

**Bot** — a simulated walker. `MULTIPLAYER_BOTS` moved from `fly.toml` into
a **Fly secret**, so the count is no longer readable from the repo — confirm
it before reading any engagement number. Bots are
written to the same Redis presence set and marking territory on the same
cadence rule as real players, so they render and compete identically. Cannot
be poked.

**Chat budget** — the spend ceilings on model calls (`chatBudget.ts`):
per-user daily, global daily, ambient cap, and the `CHAT_DISABLED` kill
switch. Counters in Redis; fails open on a Redis outage by design.

**Claim** — what a single territory mark takes: the hull of that mark and
its neighbours within `claimNeighbourM` (250m), unioned into the owner's
ground and subtracted from every rival piece it covers. A claim is **local**
— it covers ground around the mark that made it, not everywhere the dog has
ever walked.

**Companion / the dog** — the pixel-art dog that follows your GPS. Also a
Claude agent with memory. The two are the same character; "companion state"
in the schema means the game-mechanical half (hunger, happiness, level, XP,
last mark).

**Console** — `/admin/console`, the read-only ops/metrics page: one
self-contained HTML file served by the API, no build step, no dependencies.
Opened with `?k=<DASHBOARD_TOKEN>`; the key is stripped from the URL bar
and redacted in logs. Distinct from `/admin/metrics`, the JSON/text
endpoint behind it — one computation, two renderers.

**Crayon style** — the hand-written MapLibre style override
(`crayonStyle.ts`) applied over OpenFreeMap's "liberty" vector tiles. B&W
base, only parks and water painted. The app's visual signature.

**Cut** — the half of a territory mark that takes ground *away*: the claim
hull is subtracted from every rival piece it overlaps, and the rival marks
inside it go with the ground. Paired with **grow**.

**Dog-cam** — the low, close chase camera heading-locked to the dog's
travel. The flag is `DOG_CAM`; the user-facing name is **supersniff**. The
store field is `dogCam`. Same thing, three names — this trips people up.

**Explore / district / supersniff** — the three modes the corner logo
rotates through since PR #494. Explore is the ordinary map; district is the
territory lens (base map desaturated so ownership colours read against a
calm ground); supersniff is the search mode. The logo is the switch, and
the first thing the dog points at when the screen goes idle.

**Fallback pin** — `50.4501, 30.5234`, Kyiv city centre. Where the parser
puts a pet whose location it could not resolve. `/dogs/nearby` filters it
out, so a pet on the fallback pin is active, correct and **invisible**. 81
pets sat there on 11 Aug 2026; **71** after the placement campaign of
21–22 Aug. See **Maidan trap** for the near-miss that is worse than a
fall-through.

**Found report** — an ad where somebody *has* an animal and wants its
owner, rather than having lost one (`is_found_report`, migration `0035`).
Ingested deliberately — a found stray needs its owner found — but kept off
the map, because presenting one under «загублені» asks a walker to go
search the streets for an animal already sitting in somebody's flat. Their
own screen and their own call to action are an open product decision.

**Ground** — the stored polygons in `territory_ground` that are the
ownership record. Distinct from **marks**, which are the dots showing where
a dog has been. Ground does not decay; marks do.

**Grow** — the half of a territory mark that adds ground: the claim hull is
unioned into what the owner already holds. Paired with **cut**.

**Dev tools** — the gated test affordances (`?sim=1` walk simulator,
`?terrReset=1`, `?terrRaid=1`, `/preview`). On via `__DEV__`, a test build,
or a password typed at `/dev` and checked server-side against
`DEV_TOOLS_PASSWORD`. Not a security boundary — the client is trusted for
its own position regardless — a guard against a beta tester wrecking their
own progress by accident.

**Heartbeat (ingest)** — per-source "when did this last insert something"
derived from `scrape_log`, surfaced by `/admin/lost-dogs/report`. The thing
you read to find out whether a source has quietly died.

**Home ground** — ground you hold, and the passive perks that come with
standing on it: denser paws (`homeExtraPaws`), half-rate happiness decay
(`homeHappinessDecayFactor`), within a 60m edge tolerance. Denormalised onto
`companion_state.on_home_ground` because the decay cron is a bulk UPDATE and
cannot compute a hull per user.

**Invisible pet** — an active `lost_dogs` row the map cannot draw, almost
always because it is on the **fallback pin**. Not a status; a consequence of
`/dogs/nearby`'s filters.

**Invite gate** — the door in front of account creation
(`lib/inviteGate.ts`): with `INVITE_REQUIRED` set, a new device id must
redeem a code; an existing account is *never* gated, exhaustively checked.
**Off by choice since 25 Aug** — the beta is open, and the gate is a
throttle held in reserve rather than the safety net Phase 1 designed it as.

**Mark** — one point where the dog claimed ground. Decided server-side on
`/collect/path`, at most once per `cooldownMs` (20s) and never within
`minDistanceM` (40m) of the last one. Expires after `markTtlDays` (4), which
only limits the hull the *next* mark draws. Every mark is equal — there are
no strength tiers any more.

**PostModal** — the top sheet that shows the owner's actual ad text during
a search (`components/ui/PostModal.tsx`), reachable from the pet card and
the end-of-search prompt. Contacts are redacted and the link to the
original ad is withheld until a sighting is reported — the two are gated
together on purpose, since a masked phone next to a working link is
decoration.

**Owner report** — a lost pet posted by its owner **from the app** rather
than scraped (`POST /dogs/report`, since 24 Aug). Nothing is inferred:
structured fields, own photo, own pin, `placement_source: 'owner'`,
confidence 1. Publishes to the crosspost channel on submit and is reviewed
after the fact.

**Placement source** — how a pin got its coordinates
(`lost_dogs.placement_source`, migration `0037`): `owner`,
`gazetteer-marked:<name>`, `model-landmark:<name>`, `fall-through`,
`sighting`. The ledger that turned "are the pins any good" from an argument
into a `GROUP BY`.

**Paw** — the collectible token. Pure happiness, no hunger effect. Table
`tokens`. Also the currency search results are paid in (20 for a find, 10
for a zone walked and found empty).

**Piece** — one row of `territory_ground`: a ring plus its holes, with bbox
columns and a stored `area_m2`. One owner can hold many pieces.

**Poke** — tap another walker on the map. Queued in Redis, delivered on the
target's next sync as a toast plus haptic plus camera fly-to. Cannot poke
yourself or a bot.

**Presence** — the multiplayer position system. Redis GEO set `mp:pos`, a
`seen` ZSET with 45s TTL, an `mp:meta` hash. Positions carry a **stable
per-id jitter** of ≤25m, so averaging many reads will not de-jitter them.
8km search radius.

**Raid** — somebody marked over your ground. Queued in `territory_raids` in
Postgres rather than Redis, so a raid that lands overnight still reaches
you. Delivered on your next sync, then marked seen.

**Maidan trap** — the reason "the pet was in the centre" happened. Asked to
place a pet it cannot locate, the model answers **Maidan**, whose
coordinate sits 22m from the fall-through constant — not an exact match, so
it escapes the invisible-pin filter, and is then jittered into a ring
around Khreshchatyk. Every pipeline stage reports success throughout. Found
by `audit:pins`, fixed by wiring the gazetteer into placement.

**Rehoming post** — an adoption ad ("в хороші руки"). Structurally almost
identical to a lost-pet post and the hardest thing the keyword filter has to
separate. Rejected at both filter stages; 386 rejected over 14 days.

**Search zone** — the circle around a lost pet's last-seen point,
`search_zone_radius_m`, default 500m, capped at 1.25km, expanded over time
by the zone-expansion cron. Walking it is the search.

**Search result** — one row per *completed* search, found or not
(`search_results`, since 14 Aug 2026). Deliberately not a **sighting**: a
sighting asserts the pet was here and can move the pin; a search result may
assert only that somebody looked.

**Sighting** — a user report that they saw a specific lost pet. Written to
`sightings`; if the reported point is within 2× the pet's search radius it
also refreshes the pet's last-seen coordinates and timestamp, closing the
user→system loop.

**Sniff mode** — **dead**. A logo-toggled awareness view (dark map, inverted
markers, off-screen edge chips) that was unreachable for weeks and was
removed entirely in PR #381, 777 lines net. If you see `sniffMode` in an old
doc or comment, it means nothing now. Not to be confused with **supersniff**
or with the **sniff press**.

**Sniff press** — the long-press-on-the-map gesture (`SniffPress.tsx`). Hold
for 2.4s and the dog surfaces a nearby `kyiv_lore` entry with a story bubble
and a "let's go here" button. Alive and unrelated to sniff mode.

**Read more** — the "ще ▾" under a landmark's one-liner, on the sniff press
and on a walk stop alike (`LoreMore.tsx`). Opens the dog's longer telling
(`kyiv_lore.detail`, instant, offline), then the Wikipedia lead under it when
the row has an article, with a link to the article as attribution. Both used
to be rare: the seed only linked rows whose OSM object carried a `wikipedia=`
tag — 8% of the corpus, measured — and wrote no detail at all. `enrich:lore`
fills both in, from Wikidata, from the plaque's own inscription and subject
tags, and from the person's article when the plaque is named after one — see
[operations](07-operations.md#server-side-clis).

**Spot** — a POI from Google Places (vet, pet shop, park, café…), served
through the server's cache. The Spots tab and the map markers.

**Standing** — the territory leaderboard: total area held, ranked, summed
straight off `territory_ground.area_m2`. Lives in the quests tab, served by
`/territory/leaderboard`, deliberately **not** on the 15s sync.

**Supersniff** — the app's second mode: the dog-cam camera, the lost-pet
carousel, and the guided search. Entered from the logo. See **dog-cam**.

**Walk destination** — where a planned walk ends. Comes from `/walk/destinations`
(307 parks and 82 squares in `kyiv_gazetteer`, plus the museums, churches and
attractions in `kyiv_lore`), merged with Google Places **parks** only, deduped by
position at 120 m because the two sources have unrelated ids for the same park.
Places is not required: with its key off the whole pool comes from our own
tables.

Places **spots** — cafés, bars, pet shops, vets — are deliberately NOT walk
destinations, though they were until PR #493. Going to a named business is a
different mechanic with its own three entry points (`visit:spot:<id>` in the
radial menu, the chat's `walk_to_spot`, and the spot card's route button); a
walk is a small local tour, and mixing the pools meant "take me for a walk"
could answer with the vet. Streets, neighbourhoods, districts, metro stations
and `kyiv_lore`'s 1676 `historic` rows are excluded too — a street is not a
destination and a wall plaque is a **walk stop**, not somewhere to walk to.

**Walk stop** — a `kyiv_lore` landmark a planned walk is routed *through*,
rather than past. `/lore/route` picks two to four of them along the candidate
routes the client offers and the client spends its walk on whichever route
passes the most. Same corpus as the **sniff press**, reached from the other
direction.

They render per the product reference (`WalkStops.tsx`): plain **green** dots
(`colors.walkStop`, `#7CFB00`) on a chunky **cyan dashed** line
(`colors.walkLine`) — a tour is a route *with stops*, so it does not reuse
`routeBlue`, which paints quest routes and the sniff ring. Tap a dot for the
dog's sentence, tap "ще" for the **read more**.

The dots are **not numbered** and carry no ring. Numbering promised a sequence
the walk doesn't enforce — which stop you reach first depends on which way you
turn — and these are simply three places near your route. Three is the cap at
every distance: a fourth fits on the ground but not on a phone screen.

A dashed line needs **butt caps**. A round cap extends each dash by half the
line width at both ends, so at weight 9 the caps close an 8 px gap and the
"dashes" render as one solid line with bulges.

**Route line** — how the app draws *any* route: a planned walk, a detective
quest, the line the dog leads you along in supersniff. Cyan
(`colors.routeLine`), dashed, weight 9, opacity 0.95 — and all of that lives in
`CrayonRoute`'s own defaults, so a route is drawn by rendering one and passing
no styling at all. The three used to differ in weight and opacity, including a
thinner "this is only the fallback" variant on quests; that is gone, since one
app should not have four ways of saying *go this way*. Not to be confused with
`colors.sniffBlue`, the older `#2f6bff`, which is the app pointing AT something
— the sniff ring, a search zone, a selected pet — and is never a route.

The card lists the stops, opens itself when the walk starts, and is reopened
from a pill under the HUD beside "cancel walk". It sits at `Z.HUD_WALK_CARD`
(50) — above the companion at 42 — and its container must set **no z-index**,
or the card is trapped under the dog. Only the cancel pill ends a walk;
tapping the map does not, and neither does working through the stops.

Zero stops is a valid walk, and on short ones it is common. Measured against
all 2671 production rows from the 36 neighbourhood centroids in
`pipeline/landmarks.ts`: a **3 km** walk reaches two stops **95%** of the time
(best of the client's four candidates), and only Pushcha-Vodytsia is dry in
every direction. A **1 km** walk reaches two stops **58–72%** of the time, and
six to twelve of the 36 neighbourhoods — Troieshchyna, Vyrlytsia, Pozniaky,
Heroiv Dnipra, Hydropark among them — have no direction that does. The corpus
is centre-weighted: 16% of it sits east of `lng 30.56`. That floor is density,
not tuning; widening the corridor past 240 m buys a few points for a third
more walking.

**Wipe** — a deliberate truncate of the territory tables, done via its own
migration, because every claim in the database was made under a rule that no
longer exists. Five so far. Irreversible.

---

## Fossils

Names that no longer mean what they say. Left alone because renaming
cascades.

| Name | Says | Means |
| --- | --- | --- |
| `ParsedDog`, `parseDogPost`, `lost_dogs`, `/dogs/nearby` | dogs | dogs **and cats**, since PR #14 |
| `lost_dogs.source` comment: `scrape \| in_app` | those two values | the ingest's actual name: `olx`, `telegram:<channel>`, `admin-sideload`. `'scrape'` matches nothing |
| `tokens` schema comment: "PostGIS point added via raw SQL migration" | PostGIS | there is no PostGIS anywhere |
| `DOG_CAM` / `dogCam` | a camera mode | the whole **supersniff** mode |
| `experiments.ts` header: "toggled per-branch … while `main` / prod stays on the shipped MapLibre render" | the flags are off in prod | `GAME_RENDER`, `MULTIPLAYER` and `DOG_CAM` are all `true` and have been live in prod since July |
| `botMarkCooldownMs` | a bot-specific cadence knob | nothing — it survives only in a comment. Bots and players share one cadence pair |
