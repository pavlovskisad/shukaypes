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
  // The companion decides on its own; the human's only lever is walking
  // it somewhere worth marking and keeping it in the mood.
  territory: {
    // The dog marks at most this often. Sized so a 30-minute walk yields
    // roughly 8-13 marks — enough that a walk visibly grows your range,
    // few enough that each one is a real claim you can't spam.
    //
    // This and the spacing below are env-overridable because the whole
    // feel of the mechanic lives in these two numbers, and finding the
    // right pair takes walking around with them — not a redeploy per
    // guess. Set TERRITORY_COOLDOWN_MS / TERRITORY_MIN_DISTANCE_M on the
    // API (e.g. 20000 / 60 to watch a ribbon build in a couple of
    // minutes) and unset them to fall back to the tuned defaults.
    cooldownMs: envNum('TERRITORY_COOLDOWN_MS', 150_000),
    // …and never within this distance of its last mark, so two marks in a
    // row can't land on the same patch and go to waste. Combined with the
    // cooldown this is what actually paces claims on a fast walk.
    minDistanceM: envNum('TERRITORY_MIN_DISTANCE_M', 140),
    // A mark claims every grid cell whose centre falls inside this radius
    // (~1-5 cells at CELL_M=110). Chunky on purpose.
    radiusM: 100,
    // The TRAIL — the second, weaker tier of claim. Marks are discrete, so
    // on their own they leave a string of disconnected islands. The ground
    // you actually walked between them gets a thin claim too, which is
    // what stitches those islands into one territory (and, later, what
    // makes a far-flung mark part of your mainland rather than an
    // orphan). Narrow and weak: a single pass fades within the day, but a
    // route you walk daily builds into real ground of its own.
    //
    // The radius is NOT free to tune down: a point can sit up to half a
    // cell diagonal (78m at CELL_M=110) from its own cell's centre, so
    // any radius below that claims nothing at all while you walk near a
    // cell corner — and the ribbon comes out with holes in it. Measured
    // at 45m: ~1 walk in 4 produced a disconnected trail, which defeats
    // the entire point of having one. Keep this comfortably above 78.
    trailRadiusM: 85,
    trailStrength: 12,
    // ENCLOSURE — the payoff move. When the chain of marks loops back on
    // itself, everything inside the ring becomes yours, not just the path
    // you walked. That's what turns "a line of dots" into "a piece of the
    // city", and it gives walking a deliberate shape: go around the block
    // and the block is yours.
    //
    // A new mark closes the loop when it lands within this distance of an
    // earlier mark in the chain.
    loopCloseM: 170,
    // …provided at least this many marks separate them, so two marks in a
    // row can't count as a "loop".
    loopMinMarks: 3,
    // Only the recent chain is considered, so a mark you left across town
    // last week doesn't suddenly enclose half of Kyiv.
    loopChainLength: 40,
    // Enclosed ground comes in solid but not maxed: you own it, and
    // walking it properly is still what makes it a core.
    loopFillStrength: 30,
    // Hard ceiling on how much one enclosure can claim, so a very long
    // loop can't spend a minute of server time filling thousands of cells.
    loopMaxCells: 1500,
    // Mood gates. Below the low-happiness threshold the dog isn't feeling
    // it, and an empty stomach means no marking either — which is what
    // wires territory into the existing bones/paws economy.
    minHappiness: 30,
    minHunger: 15,
    // Marking costs a little (effort + water) and gives back a little
    // (dogs love doing it).
    hungerCost: 3,
    happinessGain: 4,
    // Claim strength. One mark puts `strengthPerMark` into every cell it
    // covers, capped at `maxStrength`; strength then bleeds away at
    // `decayPerDay`. So a single mark fades to nothing in ~1.5 days,
    // while a spot marked repeatedly (a core) holds for ~4 — edges go
    // soft first, exactly where we want the fighting to happen.
    strengthPerMark: 40,
    maxStrength: 100,
    decayPerDay: 25,
    // Viewport radius for the territory the map asks for each sync.
    fetchRadiusM: 3000,
    maxCellsPerFetch: 900,
  },
} as const;
