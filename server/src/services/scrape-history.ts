// In-memory ring buffer of recent scrape ticks. The scrape_log table
// only records per-item outcomes — a tick that returns zero items
// (bridge empty, fetch errored, channel list unset) leaves no trace
// there, which makes "is the source actually running?" hard to answer
// without Fly log access. /stats reads from here.
//
// Single-machine assumption: server runs on Fly with min_machines=1
// today. If we scale beyond that we'd promote this to a tiny redis
// list — not worth it yet.

import type { SourceRunSummary } from '../pipeline/source.js';

const HISTORY_PER_SOURCE = 10;

interface TickEntry {
  ts: string;
  summary: SourceRunSummary;
}

const history = new Map<string, TickEntry[]>();

export function recordTick(summary: SourceRunSummary): void {
  const list = history.get(summary.source) ?? [];
  list.push({ ts: new Date().toISOString(), summary });
  if (list.length > HISTORY_PER_SOURCE) {
    list.splice(0, list.length - HISTORY_PER_SOURCE);
  }
  history.set(summary.source, list);
}

export function getTickHistory(): Record<string, TickEntry[]> {
  return Object.fromEntries(history.entries());
}
