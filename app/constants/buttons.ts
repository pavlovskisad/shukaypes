// Shared button styles for modal CTAs. Two flavours (dark / light) +
// a disabled state, all on the same tight pill recipe:
//   - 10×18 padding, 13px text, 999 radius
//   - the chip shadow (SURFACE.chip), the same on dark and light
//   - icon on the left at INLINE_ICON.cta sized to land ~1.6× the
//     label height
// The styles are flex-row friendly (flex:1) so two side-by-side
// buttons split width evenly — the layout LostDogModal uses for
// "i've seen them" + "start search" and SpotModal copies for
// "ходімо сюди" + "туди й назад".
//
// One file so a future tweak (radius, colour, shadow) ships to
// every modal in one diff.
//
// ORDER (D10): in a two-button row the dark primary is on the LEFT,
// the light one on the right — on every sheet, and on every step of a
// multi-step sheet. That was already the majority (SpotModal, PostModal,
// the report form); the pet card and the report flow's pin step had it
// the other way round, so the same thumb found the opposite answer
// depending on which sheet was open.
//
// SEGMENTED TOGGLES (D11) reuse these two as well: selected is the
// filled dark pill, unselected the light one. Deliberately no third
// "segment" style — filled-for-selected is the pattern people already
// read, and a toggle row never shares a line with an action row.

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
  // A 44px floor (UX-9.4). With an icon the pill is taller than this
  // anyway; a text-only one ("close", "no", the species toggles) came
  // out ~36, under the touch minimum. border-box so the 2px edges are
  // inside the 44, and a dark and a light pill still line up.
  minHeight: 44,
  boxSizing: 'border-box',
  borderRadius: R.button,
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
  // The chip shadow, on dark and light alike (UX-9.14). The two used to
  // be written out separately — 0.10 here, 0.22 on the light pill — so
  // the white half of every action row cast twice the shadow of the
  // dark half sat beside it.
  boxShadow: SURFACE.chip,
};

export const MODAL_PILL_DARK: CSSProperties = {
  ...MODAL_PILL_BASE,
  background: INK,
  color: '#ffffff',
  // Ink on ink — invisible, and that is the point. The light pill
  // carries a 2px edge, and these two sit side by side in every
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
  // The edge is DRAWN, by a HandDrawnFrame the call site puts inside
  // the button — but the 2px still has to be here, transparent, or the
  // light pill comes out 4px smaller than the dark one it sits beside
  // and the action row stops lining up. Same reason the dark pill
  // carries an ink-on-ink border it cannot show.
  border: '2px solid transparent',
  position: 'relative',
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
  border: '2px solid #ddd',
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
  boxShadow: SURFACE.chip,
  // Drawn, like the modal pills — see MODAL_PILL_LIGHT.
  border: '2px solid transparent',
  position: 'relative',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  // A 40px floor, centred (UX-9.7). Bare padding on 13px text came out
  // ~36, and these are the ways OUT of a running walk.
  minHeight: 40,
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

// THE CLOSE BUTTON (D9). One shape for every "close this" in the app:
// a 44px white circle with the drawn ink ring and a × in Annex, on the
// chip shadow. It used to come in five-plus versions — a 36px circle
// with a × on the sheets, a 44px one with ✕ (a glyph Annex doesn't
// have, so it fell back to whatever the phone had) on the nav HUD, a
// 52px rounded square on the dog's answers, a text link on the player
// card — and a way out that changes shape between screens is one people
// have to look for.
//
// THE GLYPH IS × AND NOT <Icon name="close">, although D9 picked the
// icon. `close.svg` is not a cross: it is the radial menu's "walk
// somewhere CLOSE BY" pin (a dotted line into a map pin, the short twin
// of `far.svg`). Checked by rendering it, not by its name. Shipping it
// here would put a map pin where every close button is. × is in
// Annex's own character set (checked against the font's cmap; ✕ is
// not), so it renders in the brand face everywhere. If the icon set
// gains a real cross, swap it in inside CloseButton and DogPrompt.
//
// 44 rather than the sheets' old 36 because that is the touch floor,
// and the nav HUD's copy is pressed outdoors while walking. The
// component is `components/ui/CloseButton.tsx`; DogPrompt spreads the
// recipe directly because its answers carry their own pop-in and
// disabled handling.
export const CLOSE_SIZE = 44;
export const CLOSE_GLYPH = '×';
// Distance from a sheet's top and right edges to the button. The
// sheets had drifted to two pairs (12/12 and 14/18); one number now.
export const CLOSE_INSET = 12;

export const CLOSE_CHIP: CSSProperties = {
  appearance: 'none',
  width: CLOSE_SIZE,
  height: CLOSE_SIZE,
  minHeight: CLOSE_SIZE,
  flexShrink: 0,
  boxSizing: 'border-box',
  padding: 0,
  borderRadius: R.pill,
  // Drawn, like MODAL_PILL_LIGHT: the call site puts a HandDrawnFrame
  // inside, and the transparent 2px keeps the box the same size either
  // way.
  border: '2px solid transparent',
  position: 'relative',
  background: SURFACE.fill,
  color: INK,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  boxShadow: SURFACE.chip,
  // The glyph: Annex named outright (a <button> takes the UA font
  // otherwise), at the size the sheets' × already had.
  fontFamily: SYSTEM_FONT,
  fontSize: TYPE.display,
  fontWeight: 400,
  lineHeight: 1,
};
