// Server-authoritative balance. Mirror of app/constants/balance.ts for values
// the server controls. Client values may display faster/slower animations;
// these are the canonical numbers for state transitions and reward math.

// A handful of values are env-overridable so they can be tuned on a live
// API without a redeploy per guess (see `territory` at the bottom). A
// missing or unparseable var always falls back to the tuned default —
// never to zero, which would silently disable whatever it gates.
function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
export const balance = {
  hunger: { start: 80, decay: 2, intervalMs: 8000, min: 0, max: 100 },
  // Happiness starts high (the dog is excited), decays slow, and gets
  // big visible bumps on collect + quest milestones. Decay runs at the
  // hunger cron's interval so SQL ROUND lands on a non-zero step;
  // raising decay's intervalMs above the cron rate would round-to-zero
  // and stall the meter entirely.
  happiness: { start: 80, decay: 1, intervalMs: 8000, min: 0, max: 100 },
  bone: { hunger: 20, happiness: 18 },
  // Paws are a treat, not a meal: pure happiness, no hunger effect.
  // Only bones feed the dog. (token.hunger stays in the schema as 0 so
  // the collect SQL's `hunger + token.hunger` is a clean no-op.)
  token: { hunger: 0, happiness: 12 },
  // Per-waypoint progression bump + extra payoff at the final waypoint.
  // Walking the route is the main "we did it together" signal in v1.
  quest: { happinessPerWaypoint: 8, happinessOnComplete: 25 },
  // XP sources. Sized so a casual day (~10 paws, 1 bone) earns ~40 XP
  // and an active day (paws + bones + dailies + a quest) earns ~220.
  // See lib/xp.ts for the curve — 50-level cap at ~24 500 XP, ~3-4
  // months active to max, casual users drift indefinitely earning
  // skin / prestige tiers along the way.
  xp: {
    perPaw: 3,
    perBone: 8,
    perQuestWaypoint: 25,
    perQuestComplete: 100,
    // Happiness bonus: when the dog is happy enough (>= the threshold
    // below) every paw has a chance to be a "lucky" 2× XP one. Pure
    // bonus — never penalises low happiness, just rewards keeping the
    // dog cheerful. Reads to the user as 'oh nice, a lucky paw!'.
    luckyPawHappinessThreshold: 70,
    luckyPawChance: 0.2,
    luckyPawMultiplier: 2,
  },
  // Token spawning is location-driven: a base pool around the walker
  // (always something underfoot, regardless of nearby lost pets) plus
  // extra pools inside each nearby active lost-pet search zone, so
  // following a pet's zone earns more pickups than walking random
  // streets. The user-area pool is sized so even a quiet block has
  // paws to find — 20 in a 1200m disk = ~4 per km², a paw every
  // ~180m on a typical walk. Cut from 35 after the gate + cap fixes
  // shifted the visible density problem to be sheer count, not
  // stacking.
  tokensInUserArea: 20,
  userAreaRadiusM: 1200,
  // Inner exclusion radius for the user-area pool — paws never spawn
  // inside this disk. Without it, the 15s topup keeps dropping new
  // paws inside the 90m auto-collect radius and they get vacuumed
  // instantly, ticking the counter up while the user is standing
  // still. Sized comfortably above autoCollectToken (90m).
  userAreaInnerRadiusM: 130,
  // Was 18 — but with the 1500 m dog scan radius dense Kyiv ends up
  // with 5-10 active pets at once, so 18 each piled to 100+ tokens
  // just from dog zones. 8 each keeps following a zone meaningfully
  // denser than random streets without flooding the map.
  tokensPerDogArea: 8,
  // Per-park pool — paws cluster around parks as a soft "trail to a
  // walking destination". Tuned down from 4 → 2 because 4 piled up
  // visibly when Google's dedupe still left near-overlapping park
  // entries; the neighbourhood pool was getting drowned out. 2 paws
  // in a 70m ring still reads as a hint without being a carpet.
  tokensPerPark: 2,
  parkPawRadiusM: 70,
  // Walking-radius scoping: 20-30min reach rather than 1-2hr. Previously
  // seeded paws in zones up to 4km away; combined with lots of active
  // pets that'd load 50+ pins the walker will never reach. 1500m keeps
  // the cluster "next neighborhood over" — the natural exploration
  // range — while the per-pet pool is still visible when you wander
  // toward a zone.
  dogAreaScanRadiusM: 1500,
  // Uncollected tokens older than this get soft-collected on the next
  // sync. Kept short so the per-pool top-up (both user-area and
  // per-pet zones) re-seeds positions every few minutes, and legacy
  // tokens from previous spawn strategies don't pile up with new
  // pools stacking on top. The pools self-heal on every 15s poll, so
  // shuffled positions just read as "fresh paws", not flicker.
  tokenExpireMinutes: 5,
  // Defensive global ceilings — applied AFTER per-pool topups. If a
  // race, a server restart that wipes Redis gates, or a Places drift
  // pushes us over these, the oldest uncollected items are culled
  // so on-screen density stays bounded. Soft caps; we don't surface
  // an error, we just thin the surplus. Cut from 90/35 once the
  // gate race was closed — those bigger ceilings only existed to
  // absorb the race's overshoot. With the per-pool quotas honoured,
  // 55/20 is what the design actually intends.
  maxTokensPerUser: 55,
  maxFoodPerUser: 20,
  // Radial density bias inside the user-area pool. 0 = uniform disk,
  // 0.5 = areal density ∝ 1/r (visibly denser near the walker), 1 =
  // strong nest. Dog-area pools spawn uniformly (bias=0) so zones
  // read evenly inside the circle.
  tokenCenterBias: 0.5,
  // Bones drop in parks (see ensureFoodForUser). The client fetches
  // nearby parks via Google Places and passes them as a query param;
  // the server tops up each park to `bonesPerPark` within a small
  // `parkScatterRadiusM` so bones read as "dropped at the park edge"
  // instead of stacked at the pin. foodSpreadDeg/foodCount are the
  // fallback shape when the client hasn't supplied parks yet.
  bonesPerPark: 1,
  parkScatterRadiusM: 35,
  foodExpireMinutes: 5,
  foodSpreadDeg: 0.014,
  foodCount: 8,
  // Spawn-topup cooldowns. Without these the user-area / per-park /
  // per-dog-zone pools "self-heal" on every 15s sync — collected
  // items reappear within seconds, making the eat/collect gesture
  // feel meaningless. The gates kill the standing-still respawn
  // while preserving the walking-forward feed (user-area refills
  // when the walker actually moves to a new patch).
  // - User-area: refill if user has moved this far since the last
  //   topup OR the cooldown has elapsed (whichever fires first).
  userAreaMovementThresholdM: 300,
  userAreaCooldownMs: 5 * 60 * 1000,
  // - Per-park / per-dog-zone: simple time-based cooldown. Long
  //   enough that eating a bone reads as "park is empty for a few
  //   minutes" instead of "bone instantly back".
  poolCooldownMs: 3 * 60 * 1000,
  // Anti-cheat: max distance between client-reported collect position
  // and target. Sized slightly above the client's auto-collect radius
  // (130m for food, 90m for tokens) so the auto-collect band doesn't
  // race the server gate and cause "disappear without payoff" bugs.
  collectMaxDistanceM: 150,
  // Rate limit (hits) per 1min window on /collect.
  collectRateLimitPerMin: 120,
  // Search-zone slow-grow. Active lost pets get a wider walking
  // circle as days-since-last-seen grows — the post is older, the
  // pet has had more time to drift. Computed against last_seen_at,
  // capped at maxRadiusM so we don't blow up the map. The cron
  // bumps every row to LEAST(maxRadiusM, GREATEST(current, base +
  // days * growthPerDayM)) so a row that was reduced by hand never
  // shrinks back. Hourly tick is plenty — the curve moves slowly.
  zoneExpansion: {
    baseRadiusM: 500,
    growthPerDayM: 150,
    // 1.25 km cap (was 2.5 km — a 5 km-wide circle spanned several districts
    // and made searches/quests feel scattered). Because the cron clamps with
    // LEAST(maxRadiusM, …), lowering this also shrinks any existing oversized
    // zones down to the new cap on the next tick, not just new ones.
    maxRadiusM: 1250,
    intervalMs: 60 * 60 * 1000,
  },
  // Daily janitor for lostDogs. Two sweeps so noisy parses and
  // long-abandoned posts auto-leave the active map without us
  // touching anything by hand:
  //   - low-confidence sweep: anything ingested with parseConfidence
  //     below the threshold and untouched for the grace window goes
  //     to status='expired'. Keeps the floor as our safety net even
  //     if the parser drifts.
  //   - stale-active sweep: anything with no last_seen update in
  //     staleAfterMs (and no sighting in sightingsGraceMs) is
  //     presumed found-and-not-reported and expires. Recoverable —
  //     we mark expired, not delete.
  lostDogCleanup: {
    intervalMs: 24 * 60 * 60 * 1000,
    lowConfidenceThreshold: 0.6,
    lowConfidenceGraceMs: 24 * 60 * 60 * 1000,
    staleAfterMs: 90 * 24 * 60 * 60 * 1000,
    sightingsGraceMs: 30 * 24 * 60 * 60 * 1000,
  },
  // Territory marking — the dog claims ground the way a real one does.
  // The companion decides; the human's only lever is walking it somewhere
  // worth marking and keeping it in the mood.
  //
  // MARKS ARE THE ONLY TRUTH. Territory is the hull of your live marks —
  // there is no separate ownership record to drift out of sync with what
  // the map draws. An earlier cut kept per-cell ownership alongside the
  // shapes and the two diverged immediately: you owned a trail ribbon and
  // a blob around each mark that were never drawn.
  territory: {
    // The dog marks at most this often. Sized so a 30-minute walk yields
    // roughly 8-13 marks — enough that a walk visibly grows your range,
    // few enough that each one is a real claim you can't spam.
    //
    // This and the spacing below are env-overridable because the whole
    // feel of the mechanic lives in these two numbers, and finding the
    // right pair takes walking around with them — not a redeploy per
    // guess. Set TERRITORY_COOLDOWN_MS / TERRITORY_MIN_DISTANCE_M on the
    // API and unset them to fall back to the tuned defaults.
    cooldownMs: envNum('TERRITORY_COOLDOWN_MS', 150_000),
    // …and never within this distance of its last mark, so two marks in a
    // row can't land on the same patch and go to waste. Combined with the
    // cooldown this is what actually paces claims on a fast walk.
    minDistanceM: envNum('TERRITORY_MIN_DISTANCE_M', 140),
    // Mood gates — TEMPORARILY OFF (both at 0, so both comparisons are
    // always satisfied). The idea is that a miserable or starving dog
    // won't mark, which is what wires territory into the bones/paws
    // economy. But while the mechanic itself is still being tuned, a walk
    // that silently stops producing claims is impossible to tell apart
    // from a bug in the claiming — so the gates come off until the rest
    // is settled. Restore to roughly 30 / 15 to switch them back on; the
    // code that reads them is untouched.
    minHappiness: 0,
    minHunger: 0,
    // Marking costs a little (effort + water) and gives back a little
    // (dogs love doing it).
    hungerCost: 3,
    happinessGain: 4,
    // DECAY, at the level of the mark rather than the ground. A mark's
    // scent lasts this long; after that it stops counting and the shape
    // shrinks to the hull of what's left. Visible, unlike a per-cell
    // strength nobody could see — you watch your edge recede — and it
    // gives marking inside your own territory a purpose: it doesn't
    // expand the shape, it renews it.
    markTtlDays: 4,
    // SHAPES. Marks near each other form one shape; three of them enclose
    // ground. Beyond the link distance a mark starts its own island,
    // which is what stops one stray mark across town from stretching a
    // single triangle over half the city.
    // How far apart two marks can be and still count as ONE territory.
    //
    // Raised 350 -> 1000 so a dog builds a main territory rather than a
    // scatter of separate patches. At 350 anything past a few streets
    // started a new island, which with the halo gone looked like confetti;
    // at 1000 a normal day's walking links into one shape.
    //
    // Worth knowing what this buys and costs, because it is a convex hull:
    // linking two marks a kilometre apart claims the whole span between
    // them, including ground never walked. That is the same over-claiming
    // the 150m halo was doing, just earned by walking further rather than
    // handed out for free — and it is bounded by where the dog has actually
    // been at both ends, which the halo never was.
    shapeLinkM: 1000,
    shapeMinMarks: 3,
    // Bound on the geometry work per mark. Older marks past this count
    // are ignored for shape-building (they're near expiry anyway).
    shapeMarkWindow: 300,
    // How far a claim reaches PAST the hull of its own marks.
    //
    // ZERO. A territory is the polygon between your dots and nothing more.
    //
    // This was 150m, on the theory that claims had to overlap for
    // neighbours to share a border rather than leave a strip of nobody's
    // ground between them. That solved the wrong problem, and expensively:
    // on a minimal three-dot patch, 94% of the ground claimed was halo
    // rather than anywhere the dog had walked (13.66 ha against 0.85), and
    // even a 400m walked loop came out 65% halo. It is what made three
    // dots look like an island.
    //
    // Borders now come from territories genuinely overlapping — you walked
    // into someone's range — rather than from inflating everyone until
    // they bump into each other. Two neighbours who never walk near each
    // other simply do not share a border, which is honest: there is open
    // ground between them because neither has been there.
    claimReachM: 0,
    // How many of each neighbour's marks the map draws, newest first.
    //
    // A shape needs shapeMinMarks to exist, so showing fewer than that
    // makes territory look like it appeared from nothing — which is
    // exactly how one dot beside a zone reads. Enough to see the cluster
    // the hull was drawn around, few enough that fourteen neighbours are
    // still a map rather than a scatter plot.
    rivalMarksPerOwner: 4,
    // How long a rival's fresh mark is worth showing. Long enough that a
    // 15s sync can't miss one, short enough that it reads as "that just
    // happened" rather than a scatter of everyone's history.
    rivalMarkFlashMs: 45_000,
    // CONTEST — the PvP half. Ground changes hands where marks overlap.
    //
    // How close a rival's dot has to be for this mark to count as landing
    // ON them — which no longer removes anything, it just decides whether
    // they hear about it and whether the dog says something. Ground
    // actually changes hands through the hulls overlapping, not here.
    contestM: 110,
    // Ceiling on how many of their dots one mark counts as landing among,
    // nearest first. Only affects the 'how deep in are we' number behind
    // the bubble now that nothing is deleted.
    contestMaxHits: 2,
    // REFRESH — the defence. Marking within this distance of your own
    // live marks restarts their clocks, so a corner you walk every day
    // never decays out from under you. It does NOT make those marks
    // harder to take: every mark is worth exactly one, so the state of a
    // border is readable straight off the map instead of depending on a
    // hidden number under each dot.
    refreshM: 110,
    // A dog only marks where the mark DOES something — outside the ground
    // its owner already holds. Inside, the hull is unchanged, no border
    // moves, and the cooldown is spent on a scent nobody can see.
    //
    // The consequence is deliberate and worth knowing: territory is no
    // longer topped up from the inside, so it lives or dies on whether
    // its owner keeps walking the edge. A patch whose owner stops going
    // out decays away on markTtlDays like any other.
    markOnlyOutsideOwnGround: true,
    // How far out other people's ground is drawn. Effectively the whole
    // map view: seeing the city carved up between neighbours is the point
    // of a territory game, and a 900m keyhole (the first cut) meant you
    // only ever saw your own paint plus a sliver.
    rivalViewRadiusM: 5000,
    // Ceiling on how many neighbours are drawn at once, nearest first.
    // Past a certain count the map stops saying anything — it's just a
    // quilt — and the payload grows for ranges you can't make out anyway.
    maxRivalsDrawn: 14,
    // HARD BOUNDS on the partition. Every one of these exists because the
    // unbounded version took the API down: buffered claims overlap far more
    // often than raw hulls did, so a patch could be handed a bite polygon
    // for every mark of every neighbour — ~170 clip polygons per patch,
    // across ~30 patches, synchronously, on every 15s sync from every
    // client. polygon-clipping is pure JS, so that blocks the event loop
    // outright: /health stopped answering, not just /sync/map.
    partitionMarkLimit: 2500,
    // Nearest N patches take part. Anything further is off-screen anyway.
    partitionMaxPatches: 18,
    // Most bites any one patch can take, largest first. A backstop, not a
    // working limit: a dense city hands a patch ~145, so 200 almost never
    // bites. Deliberately loose, because capping it tight is a correctness
    // bug wearing a performance costume — at 24 the same city came out 49%
    // over-claimed (10.6km² held against 7.2km² of actual ground), which
    // on screen is neighbours painted on top of each other, which is the
    // exact confusion the partition exists to remove. The event loop is
    // protected by yielding between patches instead, which costs nothing.
    partitionMaxBites: 200,
    // Cached partition lifetime.
    //
    // Was 20s, against a client that syncs every 15s — almost perfectly
    // tuned to miss, so a real client paid for a fresh partition nearly
    // every time. Measured on prod: 3.57s per sync on a miss against 1.10s
    // on a hit, with the partition itself 2.47s of it. At 60s, three syncs
    // in four hit and the median sync roughly halves.
    //
    // Safe to make this long only because a mark landing in a cell drops
    // that cell explicitly (see invalidatePartitionCell). Without that, a
    // border could sit still for a minute after someone visibly marked.
    partitionCacheMs: 60_000,
    // Grid the cache is keyed on, in degrees (~1.1km of latitude). Coarse
    // enough that a walking user reuses a cell for minutes at a time.
    partitionCacheCellDeg: 0.01,
    // How many partitions are remembered at once. One per populated cell;
    // a few dozen cells is a whole city, and each entry is small.
    partitionCacheMax: 64,
    // A partition slower than this gets logged with its shape. The bounds
    // above are guesses about a moving target — bot count, mark density,
    // how much people walk — so the useful thing is knowing when they stop
    // holding, before /health does the telling.
    partitionSlowMs: 400,
    // A raid waits this long to be delivered. Long enough to survive a
    // night's sleep, short enough that coming back after a week doesn't
    // dump a month of history on you at once.
    raidTtlHours: 48,
    // Bots hold ground too, so there's something to raid before the city
    // fills with real players. Each bot marks about this often while it's
    // out walking (they roam via the presence cron), which over an hour
    // gives every bot a small, defensible patch around the parks it
    // frequents.
    // Cut 6 -> 4 -> 2 minutes. Bots raid each other, and a raid that only
    // lands every few minutes barely moves a border.
    //
    // Note this is a CEILING, not the rate. What actually paces a bot is
    // the round trip: pick a target, walk to it, linger, mark. That cycle
    // runs several minutes, so this gate is rarely the thing being waited
    // on — it is here to stop a bot that happens to arrive somewhere twice
    // in quick succession from stacking marks, not to set the tempo. The
    // tempo lives in bots.ts (stroll chance, speed, dwell).
    botMarkCooldownMs: 2 * 60 * 1000,
    // Bots start with NOTHING and claim by walking, like a player does.
    //
    // Was 5, which handed every bot a finished patch the instant the
    // process booted — five marks clears the three-mark minimum outright,
    // and buffering the hull turns it into ~500m of ground before the dog
    // has taken a step. Useful when the point was having something to raid
    // on day one; the wrong thing entirely when the point is watching a
    // city get claimed.
    //
    // At 0 a bot needs three marks before it holds anything at all, so the
    // map fills over roughly the first quarter of an hour instead of in the
    // first second. It also makes elimination mean something: a bot driven
    // off its ground has to walk it back rather than respawning a patch.
    botSeedMarks: 0,
    botSeedSpreadM: 260,
    // Ceiling on the marks one bot holds at once. Their patch should grow
    // as they walk it and then STOP: a bot pacing the same streets for
    // days would otherwise stack marks forever and creep across the map.
    // Sized to what actually fits — a ~300m roaming disc at the 140m
    // minimum spacing holds about a dozen — so a bot fills its patch and
    // then spends its time hardening it, which is what makes one worth
    // taking off it.
    botMaxMarks: 12,
    // HOME GROUND — why holding territory is worth the walking.
    //
    // All of it is PASSIVE: nothing to activate, nothing to remember.
    // You walk your own streets and the city is quietly better there,
    // which is the reward that survives a player who forgets the
    // mechanic exists.
    //
    // Standing inside your own shape counts as home. The edge gets a
    // small grace band so the perk doesn't flicker on and off while the
    // dog wanders along a border.
    homeEdgeM: 60,
    // Paws are denser on your ground — the most legible of the perks,
    // because you can see it. Raises the user-area pool target rather
    // than the spawn rate, so it lifts the ceiling without changing how
    // often the topup runs.
    homeExtraPaws: 10,
    // The dog is relaxed at home: happiness drains at this fraction of
    // the usual rate. Hunger is deliberately untouched — that's the
    // bones economy, and slowing it would take the point out of parks.
    homeHappinessDecayFactor: 0.5,
    // Leaderboard. Recomputing everyone's hulls is real work, so the
    // board is cached — it's a standing, not a live scoreboard, and a
    // few minutes of lag is invisible.
    leaderboardSize: 10,
    leaderboardCacheMs: 5 * 60 * 1000,
    // Patch ceiling for the board's city-wide partition. Larger than the
    // map's, because this one is meant to cover everybody — but nothing
    // like unbounded: the pair loop behind it is quadratic and the machine
    // it runs on is a single shared vCPU, where the 150-patch version took
    // over a minute and starved everything else in the process.
    leaderboardMaxPatches: 60,
    // And a much tighter bite cap than the map's 200. The map needs exact
    // borders because you are looking straight at them; the board needs
    // the ORDER to be right, and the dropped bites are small enough to
    // move an area a few percent without moving anyone up or down.
    leaderboardMaxBites: 24,
  },
} as const;
