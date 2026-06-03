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
  border: '1px solid rgba(255,255,255,0.06)',
  shadow: '0 4px 14px rgba(0,0,0,0.22)',
  fontFamily: SYSTEM_FONT,
} as const;
