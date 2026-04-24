// Server-authoritative balance. Mirror of app/constants/balance.ts for values
// the server controls. Client values may display faster/slower animations;
// these are the canonical numbers for state transitions and reward math.
export const balance = {
  hunger: { start: 80, decay: 2, intervalMs: 8000, min: 0, max: 100 },
  happiness: { start: 60, decay: 1, intervalMs: 8000, min: 0, max: 100 },
  bone: { hunger: 20, happiness: 8 },
  token: { hunger: 2, happiness: 5 },
  // Token spawning is location-driven: a base pool around the walker
  // (always something underfoot) plus extra pools inside each nearby
  // active lost-pet search zone, so following a pet's zone earns more
  // pickups than walking random streets.
  tokensInUserArea: 10,
  userAreaRadiusM: 800,
  tokensPerDogArea: 7,
  dogAreaScanRadiusM: 4000,
  // Uncollected tokens older than this get soft-collected on the next
  // sync. Replaces the old distance-based cull — a paw seeded inside a
  // dog's zone 3km away is legitimate even if the walker is elsewhere,
  // so age expiry keeps the set bounded without wiping valid zones.
  tokenExpireMinutes: 45,
  // Radial density bias inside the user-area pool. 0 = uniform disk,
  // 0.5 = areal density ∝ 1/r (visibly denser near the walker), 1 =
  // strong nest. Dog-area pools spawn uniformly (bias=0) so zones
  // read evenly inside the circle.
  tokenCenterBias: 0.5,
  foodSpreadDeg: 0.014,
  foodCount: 8,
  // Anti-cheat: max distance between client-reported collect position and target.
  collectMaxDistanceM: 80,
  // Rate limit (hits) per 1min window on /collect.
  collectRateLimitPerMin: 120,
} as const;
