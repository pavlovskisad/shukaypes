// One switch for the affordances that exist to test the game, not to play
// it.
//
// Three URL parameters shipped in the public build: `?terrReset=1` wipes
// the caller's territory, `?terrRaid=1` spawns a raid on their newest
// mark, and `?sim=1` replaces GPS with a synthetic walker that drives real
// server writes — marks, claims, collected paws — from a desk. Each one is
// authenticated as the caller and touches only their own data, so none is
// a way in. They are a way for a beta tester who found a link in a chat to
// destroy their own progress and then, reasonably, report it as a bug.
//
// GATED, NOT DELETED. Every one of these is genuinely useful: the walk
// simulator is the only way to exercise movement mechanics without going
// outside, and it works precisely because it has no test-only branch past
// the hook — a simulated walk hits the real server code. Deleting them
// would mean rewriting them the next time the territory rules change.
//
// On in a dev server (`__DEV__`), and on in any build that sets
// EXPO_PUBLIC_DEV_TOOLS=1 — which is how to turn them back on for a Vercel
// preview without touching the production project's environment.
//
// Metro inlines both at build time, so this whole module compiles down to
// a single boolean literal and the guarded branches are plainly dead in a
// production bundle. Verified by grepping the export, not by reasoning
// about it: `e.DEV_TOOLS=!1` with the variable unset, `!0` with it set.
//
// LOCALLY, PASS `--clear`. Metro caches the transformed module, so a
// rebuild after changing the variable happily re-emits the old literal —
// the first check of this switch said it was broken when it was not.
// Vercel builds in a clean container and is unaffected.
declare const __DEV__: boolean;

export const DEV_TOOLS: boolean =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_DEV_TOOLS === '1';
