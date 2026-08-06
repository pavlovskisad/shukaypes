export const balance = {
  hunger: { start: 80, decay: 2, interval: 8000 },
  happiness: { start: 80, decay: 1, interval: 8000 },
  bone: { hunger: 20, happiness: 18 },
  // Paws are a treat: happiness only, no hunger. Only bones feed.
  token: { hunger: 0, happiness: 12 },
  lowThreshold: 30,
  tokenCount: 15,
  bonusPerDog: 6,
  foodCount: 8,
  // Orbit radius around the walker. 0.0003° ≈ 33 m — close enough
  // the dog reads as a companion right beside you, not a far-flung
  // satellite. Was 0.001° ≈ 111 m which felt distant and forced the
  // dog into constant cross-screen sprints when the user moved.
  roamRadius: 0.0003,
  // Bumped from 100ms — that loop scans the full token list to
  // auto-collect anything within 90m of user/companion. Token list
  // grows during a session (5min expiry, but high spawn density),
  // so the per-tick cost compounds. 300ms is still well below the
  // human perception threshold for "I walked over a paw and it
  // disappeared" feedback (~500ms before the delay reads as
  // sluggish). Same interval drives the quest waypoint check.
  roamTick: 300,
  // Wobble proportional to the new tighter roamRadius — keeps the
  // orbit from feeling perfectly geometric without flinging the dog
  // 30 m off the new ring.
  roamRadiusWobble: 0.0001,
  roamRadiusWobblePeriod: 7000,
  autoCollectToken: 90,
  autoCollectFood: 130,
  foodCheckInterval: 500,
  ambientInterval: 40000,
  ambientChance: 0.25,
  ambientMax: 10,
  bubbleDuration: 7000,
  // Radial menu rim — bumped 60 → 78 (and submenu 100 → 124) to
  // match the bigger BUTTON.size, so the buttons still have a
  // breathing gap from the companion's centre instead of crowding it.
  menuRadius: 78,
  subMenuRadius: 124,
  mapZoomMin: 12,
  mapZoomMax: 19,
  // The game camera: how far out the map sits on load, and what it
  // returns to after a dog view or supersniff hands the camera back.
  //
  // Was 17.5, which opened almost on top of the dog — a few hundred
  // metres of city and not much else. Territory changed what the map is
  // for: the interesting thing on screen is now who holds which blocks
  // around you, and at 17.5 you could see about two of them. 15.6 shows
  // roughly a kilometre across, which is enough neighbours to read the
  // shape of the fight while the dog is still clearly the subject.
  //
  // Pitch stays at 74 (see MapView) — the steep tilt is what makes it a
  // world you look across rather than a map you look at, and pulling
  // back doesn't change that.
  mapZoomDefault: 15.6,
  gpsCircleRadius: 60,
} as const;
