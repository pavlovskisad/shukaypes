// Minimalist system-ui font stack — clean, readable, no handwriting.
// Same face for heading + body; weight/size does the hierarchy.
//
// 'OpenMoji' sits in the chain after the system Latin fonts but
// before the implicit emoji fallback so emoji codepoints render
// from our CC-BY-SA web font (loaded in app/+html.tsx) instead of
// the device's native set. unicode-range on the @font-face keeps
// Latin text on system fonts — OpenMoji is only consulted for
// emoji glyphs.
const SYSTEM =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'OpenMoji', sans-serif";

export const fonts = {
  heading: SYSTEM,
  body: SYSTEM,
} as const;

// Convenience for inline-web styles that used to reference 'Caveat'.
export const SYSTEM_FONT = SYSTEM;
