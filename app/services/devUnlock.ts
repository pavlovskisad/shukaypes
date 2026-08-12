// The key that turns the dev affordances back on, in a real build, on a
// real phone.
//
// WHY A TYPED PASSWORD AND NOT A BUILD FLAG. EXPO_PUBLIC_* values are
// inlined into the bundle at build time, so a secret shipped that way is
// not a secret — anyone can read it out of the JavaScript. This one is
// never built in: it is typed into /dev, checked by the server against a
// Fly secret, and only then stored in this browser.
//
// WHAT IT IS AND IS NOT. It is not a security boundary, and pretending
// otherwise would be the wrong story to tell about it. The simulator
// grants no capability a determined person lacks: the client is trusted
// for its own position, so anybody can POST invented coordinates with
// curl whether or not `?sim=1` exists. What this stops is an ACCIDENT —
// a tester who was handed a link, turned on a synthetic walk without
// understanding it, and quietly marked territory they never walked onto
// a map other people compete on.
//
// Held per-browser with an expiry, so a phone borrowed for a demo does
// not stay unlocked forever.

const STORAGE_KEY = 'shukajpes.devKey';
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

interface Stored {
  key: string;
  at: number;
}

function read(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.key !== 'string' || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return { key: parsed.key, at: parsed.at };
  } catch {
    // Private mode, disabled storage, or something else wrote junk here.
    // A dev affordance that cannot read its own flag is simply off.
    return null;
  }
}

/** The stored key, for the header on the routes that require it. */
export function getDevKey(): string | null {
  return read()?.key ?? null;
}

/** Has this browser been unlocked? Read once at module init by devTools. */
export function isDevUnlocked(): boolean {
  return read() != null;
}

export function storeDevKey(key: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, at: Date.now() }));
  } catch {
    /* nothing to do — the unlock simply will not persist */
  }
}

export function clearDevKey(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see above */
  }
}
