// Type scale. Six sizes covering caption → display. Values are
// plain numbers — write `fontSize: TYPE.title` at the call site
// and keep fontWeight / letterSpacing / color / lineHeight local
// to the style. That way the scale rename never silently changes
// a screen's weight or kerning, and we keep the door open for a
// dedicated weight scale layered on top later if it proves
// worth it.
//
// Naming follows visual weight, not pixel size — that way a future
// retune of the actual numbers doesn't force a rename pass across
// the codebase. If you find yourself reaching for a 7th size, first
// check whether one of these adapted with a one-line override would
// do the job.
//
// WEIGHTS: two, 400 and 700. Only Annex Regular ships, so anything
// from 600 up is the browser's synthetic bold and 600 / 700 / 800
// all render as the same smeared stroke (UX-11.2). The code used to
// ask for all three as if they differed; it now asks for 700 only,
// so what the style says is what the screen shows. Below 600 the
// browser draws the regular face, so 500 is just 400 spelled
// differently — use 400. If a real Annex Bold file is ever added
// (a weight-700 @font-face in public/index.html), every bold in
// the app picks it up without a call-site pass.

import { colors } from './colors';

export const TYPE = {
  // Chip labels, badges, distance pills, small counts.
  caption: 11,
  // Row meta lines ("ago", "completed · +25 pts"), secondary
  // text in cards, address lines, place names on the map.
  small: 13,
  // Default body — row labels, regular paragraph text, modal
  // copy, status pills.
  body: 15,
  // Card and section titles ("кав'ярні", "щоденні квести"),
  // chat header pill, and the heading of a FORM sheet (account
  // edit, the post reader) — a sheet you fill in or read through
  // leads with the task, not with a name.
  title: 17,
  // Big card names — spot name on a SpotCardView, pet name on the
  // LostDog card and its map bubble, a favourite's title, marker
  // name pop.
  hero: 22,
  // Hero-sheet heading — the top sheets that open ON a thing and
  // are about it: SpotModal's name, About, the lost-pet report's
  // opener (D16a, UX-11.4).
  display: 26,
} as const;

// THE ERROR LINE. A bare "that didn't work" under a form or a screen
// was styled four ways (#a33, #A2452F, colors.red at 700, colors.red at
// 800), so the same failure looked like a different kind of problem on
// each screen (UX-10.2). One colour, one size, one weight. Spread it
// and add only the margin the call site needs.
//
// fontWeight is the string '700' so the same object works in an RN
// StyleSheet and in an inline web style alike.
//
// Form errors that sit in a box (LostFlowModal's redBg callout) keep
// their box: that is a different element, not a different error text.
export const ERROR_TEXT = {
  color: colors.red,
  fontSize: TYPE.small,
  fontWeight: '700',
} as const;
