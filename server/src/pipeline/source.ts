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
  // First 5 error messages from this tick. Surfaced via /stats so
  // we can diagnose "source ran zero" without Fly log access.
  errorMessages?: string[];
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

// Caller-side error helper. Each source uses this in catch blocks so
// error counts + messages stay co-located in the summary, which the
// scrape cron passes to scrape-history for /stats visibility.
export function recordError(summary: SourceRunSummary, message: string): void {
  summary.errors++;
  const trimmed = message.slice(0, 200);
  const list = summary.errorMessages ?? [];
  if (list.length < 5) list.push(trimmed);
  summary.errorMessages = list;
}
