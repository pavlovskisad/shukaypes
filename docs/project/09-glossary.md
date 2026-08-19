# 09 — Glossary

The vocabulary this project uses for its own parts. Several terms are
overloaded or are fossils from an earlier design, and those are flagged.

---

**Ambient turn** — a companion chat message the server initiates rather than
the user. Runs on Haiku, ~60% of all chat calls. Contrast **active turn**,
which is user-initiated and runs on Opus.

**Bone** — the food item. Only bones feed the dog; paws are a treat. Spawns
in and around parks. Table `food_items`.

**Bot** — a simulated walker. 30 of them (`MULTIPLAYER_BOTS` in `fly.toml`),
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

**Fallback pin** — `50.4501, 30.5234`, Kyiv city centre. Where the parser
puts a pet whose location it could not resolve. `/dogs/nearby` filters it
out, so a pet on the fallback pin is active, correct and **invisible**. 81
pets sat there as of 11 Aug 2026.

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
Dormant until the flag is set.

**Mark** — one point where the dog claimed ground. Decided server-side on
`/collect/path`, at most once per `cooldownMs` (20s) and never within
`minDistanceM` (40m) of the last one. Expires after `markTtlDays` (4), which
only limits the hull the *next* mark draws. Every mark is equal — there are
no strength tiers any more.

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

**Spot** — a POI from Google Places (vet, pet shop, park, café…), served
through the server's cache. The Spots tab and the map markers.

**Standing** — the territory leaderboard: total area held, ranked, summed
straight off `territory_ground.area_m2`. Lives in the quests tab, served by
`/territory/leaderboard`, deliberately **not** on the 15s sync.

**Supersniff** — the app's second mode: the dog-cam camera, the lost-pet
carousel, and the guided search. Entered from the logo. See **dog-cam**.

**Walk stop** — a `kyiv_lore` landmark a planned walk is routed *through*,
rather than past. `/lore/route` picks two to four of them along the candidate
routes the client offers and the client spends its walk on whichever route
passes the most; they render as numbered discs on the line
(`WalkStops.tsx`), tap to expand the dog's sentence, tap again for the
Wikipedia summary. Zero stops is a valid walk — most of the left bank has
nothing in `kyiv_lore` near it. Same corpus as the **sniff press**, reached
from the other direction.

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
