// A photo the client sent as base64 (a data URL or the bare payload),
// turned back into bytes and sniffed for the three formats we accept.
// The magic bytes are the check, not the data URL's declared type: a
// declared type costs nothing to lie about, and Telegram (where every
// photo in this app ends up) refuses anything else anyway.
//
// Shared by the lost-pet report (routes/dogs.ts) and the avatar
// (routes/auth.ts). One decoder, one size ceiling.

// 5 MB decoded — a phone's downscaled JPEG is a few hundred KB; this is
// a ceiling against abuse, not a target.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface PhotoBytes {
  bytes: Buffer;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
}

export function decodePhoto(raw: unknown): PhotoBytes | null {
  if (!raw || typeof raw !== 'string') return null;
  const b64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (bytes.length < 12 || bytes.length > MAX_PHOTO_BYTES) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { bytes, mime: 'image/jpeg' };
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { bytes, mime: 'image/png' };
  }
  if (
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return { bytes, mime: 'image/webp' };
  }
  return null;
}
