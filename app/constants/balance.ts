export const balance = {
  hunger: { start: 80, decay: 2, interval: 8000 },
  happiness: { start: 80, decay: 1, interval: 8000 },
  bone: { hunger: 20, happiness: 18 },
  token: { hunger: 2, happiness: 12 },
  lowThreshold: 30,
  tokenCount: 15,
  bonusPerDog: 6,
  foodCount: 8,
  roamRadius: 0.001,
  // Bumped from 100ms — that loop scans the full token list to
  // auto-collect anything within 90m of user/companion. Token list
  // grows during a session (5min expiry, but high spawn density),
  // so the per-tick cost compounds. 300ms is still well below the
  // human perception threshold for "I walked over a paw and it
  // disappeared" feedback (~500ms before the delay reads as
  // sluggish). Same interval drives the quest waypoint check.
  roamTick: 300,
  roamRadiusWobble: 0.0003,
  roamRadiusWobblePeriod: 7000,
  autoCollectToken: 90,
  autoCollectFood: 130,
  foodCheckInterval: 500,
  ambientInterval: 40000,
  ambientChance: 0.25,
  ambientMax: 10,
  bubbleDuration: 7000,
  menuRadius: 60,
  subMenuRadius: 100,
  mapZoomMin: 16,
  mapZoomMax: 19,
  mapZoomDefault: 16,
  gpsCircleRadius: 60,
} as const;
