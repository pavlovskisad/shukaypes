// Shared button styles for modal CTAs. Two flavours (dark / light) +
// a disabled state, all on the same tight pill recipe:
//   - 10×18 padding, 13px text, 999 radius
//   - subtle drop shadow
//   - icon on the left at INLINE_ICON.cta sized to land ~1.6× the
//     label height
// The styles are flex-row friendly (flex:1) so two side-by-side
// buttons split width evenly — the layout LostDogModal uses for
// "i've seen them" + "start search" and SpotModal copies for
// "ходімо сюди" + "туди й назад".
//
// One file so a future tweak (radius, colour, shadow) ships to
// every modal in one diff.

import type { CSSProperties } from 'react';
import { SYSTEM_FONT } from './fonts';
import { R } from './radius';
import { S } from './spacing';
import { INK, SURFACE } from './surface';
import { TYPE } from './type';

export const MODAL_PILL_BASE: CSSProperties = {
  flex: 1,
  // Tighter inside padding (8×14) so the icon at INLINE_ICON.cta
  // (now 34) dominates the silhouette — the icon should be doing
  // most of the glance-weight, the label is a quiet confirmation.
  padding: '8px 14px',
  borderRadius: R.pill,
  border: 'none',
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.small,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: S.s,
  boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
};

export const MODAL_PILL_DARK: CSSProperties = {
  ...MODAL_PILL_BASE,
  background: INK,
  color: '#ffffff',
  // Ink on ink — invisible, and that is the point. The light pill
  // carries a 1.5px edge, and these two sit side by side in every
  // action row in the app; without the same border the dark one comes
  // out 3px shorter and the row stops lining up.
  border: SURFACE.hair,
};

// Light/white pill — the counterweight to the dark one, and the second
// half of the only two-colour button system the app has. Carries the
// ink edge so it still reads as a button on white paper, where a
// borderless white pill would be nothing but its own shadow.
export const MODAL_PILL_LIGHT: CSSProperties = {
  ...MODAL_PILL_BASE,
  background: '#ffffff',
  color: INK,
  border: SURFACE.hair,
  boxShadow: '0 4px 12px rgba(0,0,0,0.22)',
};

// There is no third colour. A blue pill used to be the "primary" for
// SpotModal's walk CTA and LostDogModal's start-search — but blue is
// spoken for elsewhere in this app: it is the colour of YOUR territory,
// of the sniff circle, of the walking route on the map. A button
// wearing it was borrowing a word that already meant something. Dark
// vs light now carries the whole weight of primary vs secondary, which
// is all the hierarchy a two-button row has ever needed.

export const MODAL_PILL_DISABLED: CSSProperties = {
  ...MODAL_PILL_BASE,
  background: '#f0f0f0',
  color: '#777',
  border: '1.5px solid #ddd',
  cursor: 'default',
  boxShadow: 'none',
};

// The floating pills that drop in under the HUD while something is
// running — cancel walk, abandon quest, the walk's stop-list toggle.
//
// A separate recipe from the modal pills on purpose: these sit on the
// MAP rather than inside a card, so they are white with a slightly
// stronger shadow to lift off the basemap, and a touch quieter in
// weight because they are ways OUT of a state rather than the primary
// action in it. `pointerEvents: auto` because the row they live in is
// pass-through, so the map underneath stays draggable between them.
export const HUD_OVERLAY_PILL: CSSProperties = {
  pointerEvents: 'auto',
  cursor: 'pointer',
  padding: '8px 16px',
  background: '#ffffff',
  color: '#1a1a1a',
  borderRadius: R.pill,
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.small,
  fontWeight: 600,
  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
  // The house hairline: 1px at 0.06 alpha.
  border: '1px solid rgba(0,0,0,0.06)',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};
