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
  // Token spawning is location-driven: a base pool around the walker
  // (always something underfoot) plus extra pools inside each nearby
  // active lost-pet search zone, so following a pet's zone earns more
  // pickups than walking random streets.
  tokensInUserArea: 10,
  userAreaRadiusM: 800,
  // Inner exclusion radius for the user-area pool — paws never spawn
  // inside this disk. Without it, the 15s topup keeps dropping new
  // paws inside the 90m auto-collect radius and they get vacuumed
  // instantly, ticking the counter up while the user is standing
  // still. Sized comfortably above autoCollectToken (90m).
  userAreaInnerRadiusM: 130,
  tokensPerDogArea: 18,
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
  // Anti-cheat: max distance between client-reported collect position
  // and target. Sized slightly above the client's auto-collect radius
  // (130m for food, 90m for tokens) so the auto-collect band doesn't
  // race the server gate and cause "disappear without payoff" bugs.
  collectMaxDistanceM: 150,
  // Rate limit (hits) per 1min window on /collect.
  collectRateLimitPerMin: 120,
} as const;
