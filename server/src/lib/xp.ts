// Companion progression. Triangular XP curve, 50-level cap.
//
// Design intent: friendly motivational pacing — fast early dopamine,
// realistic months-long road to L50 for engaged users, indefinite
// rewarding drift for casual ones.
//
//   xpForLevel(N) = (XP_BASE * (N-1) * N) / 2
//
//   L1:  0          (start — instant)
//   L2:  20
//   L3:  60
//   L5:  200
//   L10: 900
//   L20: 3 800
//   L30: 8 700
//   L40: 15 600
//   L50: 24 500     (cap)
//
// At ~40 XP/casual-walk-day → L30 in ~7 months.
// At ~220 XP/active-day (paws + bone + dailies + a quest) → L50 in
// ~3.5 months.
// XP only ever grows; missed days never lose XP, never lose levels.
//
// Level is derived from xp on read — we don't persist a separate
// level column. Sidesteps level-up race conditions and means the
// curve can be retuned without migrations.

export const MAX_LEVEL = 50;
export const XP_BASE = 20;

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
