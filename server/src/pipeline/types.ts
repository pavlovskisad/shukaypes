// Shared types for the lost-dog ingestion pipeline. Every source — admin
// sideload today, Telegram/OLX/shelter scrapers later — parses raw text into
// ParsedDog, then `upsertLostDog` is what actually touches the DB.

// "rehoming" is a signal from the parser that the post is offering a pet for
// adoption, not reporting a lost one. Callers are expected to drop these
// before upsert — they're not lost pets, they don't belong on the map.
export type Urgency = 'urgent' | 'medium' | 'resolved' | 'rehoming';

// Pets we ingest. Dogs were the original target; cats joined when we saw the
// OLX byuro-nahodok category mixes both freely. The parser, dedupe, upsert,
// and map overlay are all species-agnostic — only the regexes and prompts
// needed widening.
export type Species = 'dog' | 'cat';

export interface ParsedDog {
  name: string;
  species: Species;
  breed: string;
  emoji: string;
  lastSeenLat: number;
  lastSeenLng: number;
  lastSeenDescription: string;
  // ISO8601. If the post has no timestamp, the parser falls back to "now".
  lastSeenAt: string;
  urgency: Urgency;
  searchZoneRadiusM: number;
  rewardPoints: number;
  photoUrl: string | null;
  // 0..1 — parser's own confidence. Low confidence rows still land in the DB
  // but get logged so we can eyeball them in `fly logs`.
  parseConfidence: number;
  parseNotes: string;
}

export type IngestAction = 'inserted' | 'updated' | 'duplicate' | 'skipped';

export interface IngestResult {
  // null only when action='skipped' before we touched any row.
  id: string | null;
  action: IngestAction;
  // Set when action='skipped' so callers can log a meaningful
  // scrape_log row instead of an opaque skip.
  skipReason?: string;
  parsed: ParsedDog;
}
