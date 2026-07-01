// Daylight cycle for the game render — one profile per time-of-day phase,
// shared by BOTH the Three buildings layer and the ground-fog/sky layer so
// the whole world (building light, mist, sky, sun glow, god rays, and the
// sun's position) shifts together. Selected by the device's local clock
// (see MapView), with a `?daylight=` URL override for previewing any phase.

export type DaylightPhase = 'morning' | 'day' | 'evening' | 'night';

export interface DaylightProfile {
  // Buildings (threeBuildingsLayer)
  building: number; // mesh base colour
  fog: number; // mist colour (shared with the ground)
  fogNear: number; // clear radius (m)
  fogDensity: number; // exp mist density (per m)
  ambient: number; // fill light
  ambientI: number;
  sun: number; // directional building light colour
  sunI: number;
  lightAzimuth: number; // deg from north, CW — where the sun/moon sits
  lightElevation: number; // 0..1 height of the building light direction
  // Sky + on-screen sun glow / god rays (groundFogLayer)
  skyTop: number;
  skyHorizon: number;
  glow: number; // warm sun glow / cool moon glow colour
  glowStrength: number;
  sunScreenY: number; // baseline ndc.y the glow sits at (low at dawn/dusk)
}

export const DAYLIGHT: Record<DaylightPhase, DaylightProfile> = {
  // Soft cool dawn with a peach horizon; low sun rising in the east.
  morning: {
    building: 0xf1f2f6,
    fog: 0xe9e8f0,
    fogNear: 540,
    fogDensity: 0.01,
    ambient: 0xdfe3f2,
    ambientI: 2.0,
    sun: 0xffe2c2,
    sunI: 2.3,
    lightAzimuth: 80,
    lightElevation: 0.42,
    skyTop: 0xbcd2ee,
    skyHorizon: 0xf3ddc9,
    glow: 0xffd39a,
    glowStrength: 0.72,
    sunScreenY: 0.52,
  },
  // Bright neutral-warm midday; sun high in the south-east.
  day: {
    building: 0xf4f5f7,
    fog: 0xedf0f3,
    fogNear: 560,
    fogDensity: 0.009,
    ambient: 0xdfe6f0,
    ambientI: 2.1,
    sun: 0xffe9c4,
    sunI: 2.7,
    lightAzimuth: 125,
    lightElevation: 0.85,
    skyTop: 0xdbe8f7,
    skyHorizon: 0xe6eaee,
    glow: 0xffcf83,
    glowStrength: 0.72,
    sunScreenY: 0.72,
  },
  // Golden hour: warm dusty mist, orange horizon, low raking sun in the
  // west, strong long god rays.
  evening: {
    building: 0xf1e7dc,
    fog: 0xe8cfb6,
    fogNear: 520,
    fogDensity: 0.0115,
    ambient: 0xe9d2bf,
    ambientI: 1.95,
    sun: 0xffb266,
    sunI: 2.8,
    lightAzimuth: 255,
    lightElevation: 0.4,
    skyTop: 0x9fb2d6,
    skyHorizon: 0xf2a35c,
    glow: 0xff9636,
    glowStrength: 0.98,
    sunScreenY: 0.47,
  },
  // Hushed night with a cool moon glow (also used by sniff/search mode).
  night: {
    building: 0x20242c,
    fog: 0x2c3646,
    fogNear: 470,
    fogDensity: 0.011,
    ambient: 0x2a3550,
    ambientI: 1.6,
    sun: 0x9fb4d8,
    sunI: 1.3,
    lightAzimuth: 200,
    lightElevation: 0.7,
    skyTop: 0x0d1626,
    skyHorizon: 0x3d4960,
    glow: 0xacc0e0,
    glowStrength: 0.34,
    sunScreenY: 0.62,
  },
};

// Map a local hour (0–23) to a phase. Rough but readable boundaries.
export function resolveDaylightPhase(hour: number): DaylightPhase {
  if (hour >= 5 && hour < 9) return 'morning';
  if (hour >= 9 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// `?daylight=morning|day|evening|night` — a preview override so any phase can
// be seen on the branch without waiting for the clock. Returns null if absent.
export function daylightOverrideFromUrl(): DaylightPhase | null {
  try {
    if (typeof window === 'undefined') return null;
    const v = new URLSearchParams(window.location.search).get('daylight');
    if (v === 'morning' || v === 'day' || v === 'evening' || v === 'night') {
      return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}
