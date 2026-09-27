// A stable but NON-INVERTIBLE positional offset for showing another user's
// position (live presence, rival territory marks).
//
// The old scheme hashed the user id alone (FNV) into a fixed offset. The id
// is public — it ships in the same response so the client can poke — and the
// hash was pure, so anyone could recompute the offset and subtract it to
// recover the true point to the metre. The ~25m obfuscation was cosmetic.
//
// Here the offset is derived with HMAC-SHA256 keyed on a SERVER SECRET the
// client never sees. It is still deterministic per id (the marker doesn't
// jump between polls, and averaging many reads can't cancel it), but without
// the key an observer cannot reproduce or invert it. The offset is a
// property of the owner, so it is computed once per owner and applied to
// each of their points.

import crypto from 'crypto';
import type { LatLng } from '../utils/geo.js';

const JITTER_M = 25;

function secret(): string {
  // SESSION_SECRET is the app's real server secret; fall back to the bot
  // token, then a dev constant so local runs still jitter (just not
  // secretly). Never the empty string — that would make the offset public
  // again.
  return (
    process.env.SESSION_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN ||
    'shukajpes-local-dev-jitter-salt'
  );
}

export interface JitterOffset {
  r: number; // metres
  ang: number; // radians
}

// The fixed offset for one owner. HMAC(secret, id) → 8 bytes → angle+radius.
export function offsetFor(id: string): JitterOffset {
  const mac = crypto.createHmac('sha256', secret()).update(id).digest();
  const angRaw = mac.readUInt32BE(0);
  const rRaw = mac.readUInt32BE(4);
  const ang = (angRaw % 3_600_000) / 3_600_000 * 2 * Math.PI;
  const r = (rRaw % 1_000_000) / 1_000_000 * JITTER_M;
  return { r, ang };
}

export function applyOffset(pos: LatLng, off: JitterOffset): LatLng {
  const dLat = (off.r * Math.cos(off.ang)) / 110_540;
  const dLng =
    (off.r * Math.sin(off.ang)) / (111_320 * Math.cos((pos.lat * Math.PI) / 180));
  return { lat: pos.lat + dLat, lng: pos.lng + dLng };
}

// Convenience for a single point (presence writes one position per user).
export function jitteredPos(id: string, pos: LatLng): LatLng {
  return applyOffset(pos, offsetFor(id));
}
