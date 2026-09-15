// WHAT THE PROCESS KNOWS ABOUT ITSELF, held in memory for the console.
//
// The heavy panels (services/metrics.ts) ask the database what is true
// over days. This holds the other half: what has happened in the last few
// minutes, inside THIS process, which no table records and which the logs
// only carry as text somebody has to grep.
//
// In memory on purpose. These are seconds-old facts about one machine —
// tick durations, the bots' last window — and writing them to Postgres
// every few seconds to read them back would cost more than the thing
// being measured. A restart empties it and that is correct: the numbers
// describe the process that is running, and after a deploy that is a
// different process.
//
// Nothing here is authoritative. Anything that has to survive a restart
// or be counted exactly lives in a table (collect_events is the bots'
// real ledger); this is the instrument panel, not the flight recorder.

// A completed cron tick. Kept with its timestamp so a window can be
// asked for rather than "the last N", which would mean something
// different for a 3.5s cron and a 60s one.
interface TickSample {
  at: number;
  ms: number;
}

// Per cron name. Capped so a process that runs for weeks cannot grow
// this without bound — the cap is generous against the fastest cron
// (multiplayer, every 3.5s → ~17 minutes of history at 300).
const MAX_SAMPLES = 300;
const ticks = new Map<string, TickSample[]>();

export function recordTick(name: string, ms: number): void {
  let arr = ticks.get(name);
  if (!arr) ticks.set(name, (arr = []));
  arr.push({ at: Date.now(), ms });
  if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
}

export interface TickStat {
  name: string;
  ticks: number;
  p50: number;
  max: number;
  // Over a second, which is the threshold the cron wrapper already warns
  // at — so this number is "how many lines would be in the log".
  slow: number;
}

export function tickStats(windowMs = 300_000): TickStat[] {
  const since = Date.now() - windowMs;
  const out: TickStat[] = [];
  for (const [name, arr] of ticks) {
    const ms = arr.filter((s) => s.at >= since).map((s) => s.ms).sort((a, b) => a - b);
    if (!ms.length) continue;
    out.push({
      name,
      ticks: ms.length,
      p50: ms[Math.floor(ms.length / 2)] ?? 0,
      max: ms[ms.length - 1] ?? 0,
      slow: ms.filter((m) => m >= 1000).length,
    });
  }
  return out.sort((a, b) => b.max - a.max);
}

// The bots' last completed five-minute window (D-76's mp_bot_life line,
// as a value instead of a log message).
export interface BotLifeWindow {
  online: number;
  pool: number;
  outings: number;
  paws: number;
  bones: number;
  marks: number;
  grumpy: number;
  hungry: number;
  windowS: number;
  at: number;
}

let lastBotLife: BotLifeWindow | null = null;

export function recordBotLife(w: Omit<BotLifeWindow, 'at'>): void {
  lastBotLife = { ...w, at: Date.now() };
}

export function botLife(): BotLifeWindow | null {
  return lastBotLife;
}

// When this process came up. The console shows it because "the numbers
// look odd" and "we deployed four minutes ago" are the same sentence
// often enough to be worth one line.
export const startedAt = Date.now();

// Fly hands the machine its own id and version; neither is a secret and
// both answer "which box am I looking at" when there is more than one.
export function machine(): { id: string | null; version: string | null; region: string | null } {
  return {
    id: process.env.FLY_MACHINE_ID?.trim() || null,
    version: process.env.FLY_MACHINE_VERSION?.trim() || null,
    region: process.env.FLY_REGION?.trim() || null,
  };
}
