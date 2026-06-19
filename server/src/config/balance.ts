// Server-authoritative balance. Mirror of app/constants/balance.ts for values
// the server controls. Client values may display faster/slower animations;
// these are the canonical numbers for state transitions and reward math.
export const balance = {
  hunger: { start: 80, decay: 2, intervalMs: 8000, min: 0, max: 100 },
  // Happiness starts high (the dog is excited), decays slow, and gets
  // big visible bumps on collect + quest milestones. Decay runs at the
  // hunger cron's interval so SQL ROUND lands on a non-zero step;
  // raising decay's intervalMs above the cron rate would round-to-zero
  // and stall the meter entirely.
  happiness: { start: 80, decay: 1, intervalMs: 8000, min: 0, max: 100 },
  bone: { hunger: 20, happiness: 18 },
  token: { hunger: 2, happiness: 12 },
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
    maxRadiusM: 2500,
    intervalMs: 60 * 60 * 1000,
  },
} as const;
