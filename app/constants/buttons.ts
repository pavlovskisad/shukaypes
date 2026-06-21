// Shared button styles for modal CTAs. Two flavours (dark / blue) +
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

export const MODAL_PILL_BASE: CSSProperties = {
  flex: 1,
  // Tighter inside padding (8×14) so the icon at INLINE_ICON.cta
  // (now 34) dominates the silhouette — the icon should be doing
  // most of the glance-weight, the label is a quiet confirmation.
  padding: '8px 14px',
  borderRadius: 999,
  border: 'none',
  fontFamily: SYSTEM_FONT,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  boxShadow: '0 4px 12px rgba(0,0,0,0.10)',
};

export const MODAL_PILL_DARK: CSSProperties = {
  ...MODAL_PILL_BASE,
  background: '#1a1a1a',
  color: '#ffffff',
};

export const MODAL_PILL_BLUE: CSSProperties = {
  ...MODAL_PILL_BASE,
  background: 'rgb(0,60,255)',
  color: '#ffffff',
};

export const MODAL_PILL_DISABLED: CSSProperties = {
  ...MODAL_PILL_BASE,
  background: '#e8e8f2',
  color: '#777',
  cursor: 'default',
  boxShadow: 'none',
};
