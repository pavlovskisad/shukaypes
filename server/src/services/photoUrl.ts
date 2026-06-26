// Build a client-facing photo URL for a lost-pet row.
//
// Bot-ingested rows store a Telegram `file_id` instead of a baked URL
// (the TG file_path URL only lives for ~1h). We rewrite those to point
// at our /photos/:fileId proxy, which re-resolves on demand. Rows with
// only the legacy photo_url (manual entries, older scrapes) pass
// through unchanged.

const DEFAULT_BASE = 'https://shukajpes-api.fly.dev';

function publicBase(): string {
  const raw =
    process.env.PUBLIC_API_URL ??
    process.env.TELEGRAM_PUBLIC_URL ??
    DEFAULT_BASE;
  return raw.replace(/\/$/, '');
}

export function buildPhotoUrl(
  photoFileId: string | null,
  photoUrl: string | null,
): string | null {
  if (photoFileId) {
    return `${publicBase()}/photos/${encodeURIComponent(photoFileId)}`;
  }
  return photoUrl;
}
