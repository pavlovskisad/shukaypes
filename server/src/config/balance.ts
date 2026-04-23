// Server-authoritative balance. Mirror of app/constants/balance.ts for values
// the server controls. Client values may display faster/slower animations;
// these are the canonical numbers for state transitions and reward math.
export const balance = {
  hunger: { start: 80, decay: 2, intervalMs: 8000, min: 0, max: 100 },
  happiness: { start: 60, decay: 1, intervalMs: 8000, min: 0, max: 100 },
  bone: { hunger: 20, happiness: 8 },
  token: { hunger: 2, happiness: 5 },
  // Seeding radii (approx degrees at Kyiv latitude ≈ 0.016° ≈ 1.2km).
  // Tokens cluster tight around the walker (~500m) so there's always a few
  // to pick up as they move; far ones get culled each sync (see
  // ensureTokensForUser). Bones scatter wider on purpose — they're not
  // a walking beacon, just treats the companion stumbles on.
  tokenSpreadDeg: 0.005,
  foodSpreadDeg: 0.014,
  // Anything farther than this from the walker gets expired on the next
  // sync — no point dragging a 2km-away paw around.
  tokenCullRadiusM: 1500,
  tokenCount: 15,
  foodCount: 8,
  // Anti-cheat: max distance between client-reported collect position and target.
  collectMaxDistanceM: 80,
  // Rate limit (hits) per 1min window on /collect.
  collectRateLimitPerMin: 120,
} as const;
