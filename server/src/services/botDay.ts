// A bot's day (D-77): WHEN a bot is out with its person.
//
// Before this the walker sim was online around the clock — a 14% chance
// to "log off" for one to four minutes after each stop, which came to
// about 22 hours a day per bot. Fine for populating a map, useless as a
// picture of how the game plays: a person walks their dog two or three
// times a day for half an hour, and everything the bots are supposed to
// measure (D-76: hunger, happiness, the index, what gets found and
// eaten) depends on that rhythm — a dog that is never left alone never
// gets hungry.
//
// So each bot gets a TIMETABLE, drawn once per Kyiv calendar day:
//
//   morning   start 06:30–09:30   nearly always
//   midday    start 12:00–16:00   most days
//   evening   start 18:00–22:00   nearly always
//
// each 20–45 minutes long. Roughly 2.6 walks and 85 minutes a day, which
// is about what a real owner does.
//
// Midday was drawn at half the days on the first cut, and the owner —
// who watches the real street — said it is busier than that: "i think
// midday its more dogs than you assume … is quite active time". At 0.8
// a pool of 120 shows about thirteen dogs at one in the afternoon
// against nine, which sits just under the evening's fifteen. Widening
// the window instead was measured and is worse: the same walks spread
// over six hours put FEWER dogs on the map at any one moment (eight at
// 13:00), so the chance is the lever, not the hours. Between walks the bot is OFFLINE: not
// in presence, not polled, its dog's meters frozen the same way a
// person's are when the app is closed (decay.ts only touches rows polled
// in the last 90 s).
//
// DETERMINISTIC on (bot, day): the plan is a seeded draw, so a deploy or
// a restart puts every bot back exactly where its day says it should be
// instead of marching all thirty online at once, and two machines would
// agree. Nothing is stored.
//
// `MULTIPLAYER_BOTS_ALWAYS_ON=1` skips the timetable (bots.ts) — for a
// local stack, where a test at three in the morning still needs someone
// on the map.

export interface Walk {
  // Minutes since local midnight, fractional.
  start: number;
  end: number;
}

export interface DayPlan {
  day: number; // Kyiv calendar day index (see kyivClock)
  walks: Walk[];
}

export interface KyivClock {
  day: number; // days since the epoch, counted on the Kyiv calendar
  minute: number; // minutes since Kyiv midnight, fractional
}

// The shape of a day. Start windows are where the walk BEGINS; a walk
// that starts at the end of a window runs past it.
export const BOT_DAY = {
  windows: [
    { name: 'morning', from: 6 * 60 + 30, to: 9 * 60 + 30, chance: 0.9 },
    { name: 'midday', from: 12 * 60, to: 16 * 60, chance: 0.8 },
    { name: 'evening', from: 18 * 60, to: 22 * 60, chance: 0.95 },
  ],
  minMinutes: 20,
  maxMinutes: 45,
} as const;

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Kyiv',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// The wall clock in Kyiv, where the bots live — not the server's zone
// (Fly runs UTC) and not a fixed offset (Ukraine keeps summer time).
export function kyivClock(nowMs: number): KyivClock {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date(nowMs))) p[part.type] = part.value;
  const day = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000;
  const minute = Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
  return { day, minute };
}

// Small seeded PRNG (mulberry32) — the plan must be the same draw for the
// same bot on the same day, on every boot.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planDay(botIndex: number, day: number): DayPlan {
  const rng = mulberry32(Math.imul(botIndex + 1, 0x9e3779b1) ^ Math.imul(day, 0x85ebca6b));
  const walks: Walk[] = [];
  for (const w of BOT_DAY.windows) {
    // Always draw all three numbers, so skipping a window doesn't shift
    // the later ones' draws.
    const goes = rng() < w.chance;
    const start = w.from + rng() * (w.to - w.from);
    const len = BOT_DAY.minMinutes + rng() * (BOT_DAY.maxMinutes - BOT_DAY.minMinutes);
    if (goes) walks.push({ start, end: start + len });
  }
  return { day, walks };
}

// Is the bot out right now, by its plan for today?
export function isOut(plan: DayPlan, minute: number): boolean {
  return plan.walks.some((w) => minute >= w.start && minute < w.end);
}
