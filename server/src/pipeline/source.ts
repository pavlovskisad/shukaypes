// Shared Source contract. Each source (olx, telegram, a specific shelter)
// implements `runOnce()` → returns a summary of what it did this tick.
// Sources must be idempotent — runOnce() called every hour on the same
// pages must not create duplicates. The scrape_log table backs that.

export interface SourceRunSummary {
  source: string;        // 'olx' | 'telegram:channel' | etc
  discovered: number;    // distinct ad urls seen this run (including already-known ones)
  skipped: number;       // already-seen, or title-filtered, or off-topic
  parsed: number;        // Haiku parse calls made
  inserted: number;
  updated: number;
  duplicate: number;
  errors: number;
}

export interface Source {
  name: string;
  runOnce(): Promise<SourceRunSummary>;
}

export function emptySummary(source: string): SourceRunSummary {
  return {
    source,
    discovered: 0,
    skipped: 0,
    parsed: 0,
    inserted: 0,
    updated: 0,
    duplicate: 0,
    errors: 0,
  };
}
