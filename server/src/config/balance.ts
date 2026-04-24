// Server-authoritative balance. Mirror of app/constants/balance.ts for values
// the server controls. Client values may display faster/slower animations;
// these are the canonical numbers for state transitions and reward math.
export const balance = {
  hunger: { start: 80, decay: 2, intervalMs: 8000, min: 0, max: 100 },
  happiness: { start: 60, decay: 1, intervalMs: 8000, min: 0, max: 100 },
  bone: { hunger: 20, happiness: 8 },
  token: { hunger: 2, happiness: 5 },
  // Seeding radii (approx degrees at Kyiv latitude ≈ 0.016° ≈ 1.2km).
  // Tokens spawn across a neighborhood-sized box around the walker, with
  // far ones culled on each sync so the set drifts with them. Bones scatter
  // wider on purpose — they're not a walking beacon, just treats the
  // companion stumbles on.
  // 0.011° at Kyiv ≈ ±1.2km lat / ±0.8km lng but halved in area vs the
  // original 0.016° spread. Keeps the familiar "pins across the block"
  // feel without bleeding to the edge of the viewport.
  tokenSpreadDeg: 0.011,
  foodSpreadDeg: 0.014,
  // Anything farther than this from the walker gets expired on the next
  // sync. Sized a touch beyond the spread box so a token the walker
  // just passed sticks around briefly instead of vanishing the moment
  // they move.
  tokenCullRadiusM: 1200,
  tokenCount: 30,
  foodCount: 8,
  // Anti-cheat: max distance between client-reported collect position and target.
  collectMaxDistanceM: 80,
  // Rate limit (hits) per 1min window on /collect.
  collectRateLimitPerMin: 120,
} as const;
