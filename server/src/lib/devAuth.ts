// The server half of the /dev unlock.
//
// The client's DEV_TOOLS flag is a boolean in a browser, and a boolean in
// a browser is a suggestion — anyone can flip it in devtools. For the two
// affordances that DESTROY something (wiping a territory, spawning a raid)
// the server therefore asks for the password itself rather than trusting
// that flag. The walk simulator needs no such check, because it grants
// nothing the client could not already do: the client is trusted for its
// own position, so invented coordinates are a curl away with or without it.
//
// DEV_TOOLS_PASSWORD is a Fly secret and cannot be read back once set. It
// is a shared team password, not a per-person credential — treat it as
// something everyone testing knows, and rotate it when that set changes.
//
// Unset means off: no password, no dev routes, which is the correct state
// for a deployment nobody is actively testing against.

import { presentedToken, tokenMatches } from './adminAuth.js';

export const DEV_KEY_HEADER = 'x-dev-key';

/**
 * The blanket switch for a deployment given over to testing. Read per call
 * rather than captured at module load, so it reflects the current process
 * environment rather than whatever was set at boot.
 */
export function devRoutesEnabled(): boolean {
  return process.env.DEV_ROUTES === '1';
}

/**
 * Does this request carry the shared dev password? Constant-time compare,
 * borrowed wholesale from the admin token check so the two cannot drift
 * into asking the same question two different ways.
 */
export function hasDevKey(header: string | string[] | undefined): boolean {
  const password = process.env.DEV_TOOLS_PASSWORD;
  if (!password) return false;
  const presented = presentedToken(header);
  if (!presented) return false;
  return tokenMatches(presented, password);
}

/** Either the deployment is given over to testing, or you know the word. */
export function devAccessAllowed(header: string | string[] | undefined): boolean {
  return devRoutesEnabled() || hasDevKey(header);
}
