// Shared types for the lost-dog ingestion pipeline. Every source — admin
// sideload today, Telegram/OLX/shelter scrapers later — parses raw text into
// ParsedDog, then `upsertLostDog` is what actually touches the DB.

export type Urgency = 'urgent' | 'medium' | 'resolved';

export interface ParsedDog {
  name: string;
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

export type IngestAction = 'inserted' | 'updated' | 'duplicate';

export interface IngestResult {
  id: string;
  action: IngestAction;
  parsed: ParsedDog;
}
