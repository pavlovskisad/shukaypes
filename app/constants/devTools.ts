// One switch for the affordances that exist to test the game, not to play
// it.
//
// Three URL parameters shipped in the public build: `?terrReset=1` wipes
// the caller's territory, `?terrRaid=1` spawns a raid on their newest
// mark, and `?sim=1` replaces GPS with a synthetic walker that drives real
// server writes — marks, claims, collected paws — from a desk. Each one is
// authenticated as the caller and touches only their own data, so none is
// a way in. They are a way for a beta tester who found a link in a chat to
// destroy their own progress, or to mark ground they never walked onto a
// map other people compete on, and then reasonably report it as a bug.
//
// GATED, NOT DELETED. Every one of these is genuinely useful: the walk
// simulator is the only way to exercise movement mechanics without going
// outside, and it works precisely because it has no test-only branch past
// the hook — a simulated walk hits the real server code. Deleting them
// would mean rewriting them the next time the territory rules change.
//
// THREE WAYS ON:
//
//   __DEV__                      a local dev server
//   EXPO_PUBLIC_DEV_TOOLS=1      a build made for testing (e.g. a preview
//                                deployment), set in that project's env
//   a password typed at /dev     the production build, on a real phone
//
// The third is the one that makes this usable in the field, and it is a
// TYPED password rather than a fourth build flag on purpose: EXPO_PUBLIC_*
// values are inlined into the bundle, so a secret shipped that way is
// readable by anyone who opens the JavaScript. See services/devUnlock.ts
// for what that gate does and does not protect.
//
// Read ONCE at module init, not per call. A flag that could change halfway
// through a session would mean the simulator switching on under a running
// map; unlocking reloads the app instead.
//
// Metro inlines the first two at build time. Before the /dev unlock
// existed this module folded to a single boolean literal and every guarded
// branch was plainly dead code in the production bundle; with a runtime
// third source they are live code behind a false flag instead. That is the
// honest cost of wanting the simulator on a real phone, and it is why the
// two DESTRUCTIVE affordances are additionally checked server-side rather
// than trusting this boolean on its own.
//
// LOCALLY, PASS `--clear` when changing the env variable. Metro caches the
// transformed module and will happily re-emit the old literal — the first
// check of this switch reported it broken when it was not. Vercel builds
// in a clean container and is unaffected.

import { isDevUnlocked } from '../services/devUnlock';

declare const __DEV__: boolean;

export const DEV_TOOLS: boolean =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_DEV_TOOLS === '1' ||
  isDevUnlocked();
