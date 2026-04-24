// Server-authoritative balance. Mirror of app/constants/balance.ts for values
// the server controls. Client values may display faster/slower animations;
// these are the canonical numbers for state transitions and reward math.
export const balance = {
  hunger: { start: 80, decay: 2, intervalMs: 8000, min: 0, max: 100 },
  happiness: { start: 60, decay: 1, intervalMs: 8000, min: 0, max: 100 },
  bone: { hunger: 20, happiness: 8 },
  token: { hunger: 2, happiness: 5 },
  // Seeding radii (approx degrees at Kyiv latitude ≈ 0.016° ≈ 1.2km).
  // Tokens cluster around the walker so there's always some to pick up
  // as they move; far ones get culled each sync (see ensureTokensForUser).
  // Bones scatter wider on purpose — they're not a walking beacon, just
  // treats the companion stumbles on.
  // 0.00175° at Kyiv ≈ ±195m lat / ±125m lng → ~490×250m box (≈3× the
  // previous 0.001° area, packed with more pins so the cluster reads
  // as a dense trail without bleeding off the viewport).
  tokenSpreadDeg: 0.00175,
  foodSpreadDeg: 0.014,
  // Anything farther than this from the walker gets expired on the next
  // sync. Scales with the wider spread so tokens behind the walker stick
  // around briefly after they move instead of vanishing instantly.
  tokenCullRadiusM: 900,
  tokenCount: 35,
  foodCount: 8,
  // Anti-cheat: max distance between client-reported collect position and target.
  collectMaxDistanceM: 80,
  // Rate limit (hits) per 1min window on /collect.
  collectRateLimitPerMin: 120,
} as const;
