// Visual language for "the dog is talking right now" — every
// transient bubble that surfaces the companion's voice uses the same
// dark fill + white text so it reads consistently across the app:
//
//   - in-map speech bubble (SpeechBubble above the companion)
//   - off-screen bubble mirror next to the edge chip
//   - sniff "sniffing…" indicator during a long-press
//   - lore story bubble surfaced by sniff completion
//   - future ambient remarks, emergency bubbles, quest narration, etc.
//
// Static UI (StatusBar pills, off-screen chips, cluster discs, cancel
// pills, modals) stays white-on-dark-text so the visual split is
// "voice = dark bubble" vs "controls = light card."

import { SYSTEM_FONT } from './fonts';

export const VOICE = {
  background: '#1a1a1a',
  color: '#ffffff',
  // 2px to match the ink on every other surface, in the bubble's own
  // colour so a dark bubble stays a dark shape rather than gaining an
  // outline. It is the geometry that carries across, not the paint:
  // same weight, same corner (R.chip, now shared with R.card), so the
  // dog's voice is cut from the same material as the cards it sits
  // among.
  border: '2px solid #1a1a1a',
  shadow: '0 4px 14px rgba(0,0,0,0.22)',
  fontFamily: SYSTEM_FONT,
} as const;
