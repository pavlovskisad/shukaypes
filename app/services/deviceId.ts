// Stable anonymous device ID. Swapped for Firebase ID tokens in a later phase.
// On web: localStorage. On native: AsyncStorage (swap import when native ships).
const KEY = 'shukajpes.deviceId';

function randomId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let cached: string | null = null;

/**
 * Forget who this device was. A logout on the device that REGISTERED
 * needs this: its x-device-id maps to the registered row, so clearing
 * the login alone changes nothing and the person is straight back in.
 * With a new id the page is a stranger to the server again — a fresh
 * anonymous row at the door, where they log in by e-mail.
 */
export function rotateDeviceId(): string {
  const id = randomId();
  cached = id;
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(KEY, id);
  } catch {
    /* private mode: this page only */
  }
  return id;
}

export function getDeviceId(): string {
  if (cached) return cached;
  if (typeof window !== 'undefined' && window.localStorage) {
    const existing = window.localStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const id = randomId();
    window.localStorage.setItem(KEY, id);
    cached = id;
    return id;
  }
  // Native fallback (no AsyncStorage yet) — session-scoped id.
  cached = randomId();
  return cached;
}
