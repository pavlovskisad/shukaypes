// Companion progression. Triangular XP curve, 10-level cap.
//
// xpForLevel(N) = cumulative XP needed to BE at level N. Triangular
// shape means each level needs more than the last but the slope is
// gentle — XP gap per level is XP_BASE * (level - 1).
//
//   L1: 0       (start)
//   L2: 50
//   L3: 150
//   L4: 300
//   L5: 500
//   L6: 750
//   L7: 1050
//   L8: 1400
//   L9: 1800
//   L10: 2250    (max — ~750-2250 paws to top out, comfy for the pilot)
//
// Level is derived from xp on read in /state and /profile/me — we don't
// persist a separate level column. That sidesteps level-up race
// conditions and means the curve can be tuned without migrations.

export const MAX_LEVEL = 10;
export const XP_BASE = 50;

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  const cap = Math.min(level, MAX_LEVEL);
  return (XP_BASE * (cap - 1) * cap) / 2;
}

export function levelForXp(xp: number): number {
  for (let L = MAX_LEVEL; L >= 1; L--) {
    if (xp >= xpForLevel(L)) return L;
  }
  return 1;
}

// Returns xp progress within the current level, plus how much xp the
// next level requires from the current floor. At MAX_LEVEL both equal
// each other and the bar reads as "full forever."
export function xpProgress(xp: number): {
  level: number;
  xpInLevel: number;
  xpForNextLevel: number;
} {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) {
    return { level: MAX_LEVEL, xpInLevel: 1, xpForNextLevel: 1 };
  }
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    xpInLevel: Math.max(0, xp - cur),
    xpForNextLevel: next - cur,
  };
}
