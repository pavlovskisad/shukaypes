// DIAGNOSTIC: leading with 'Pixelify Sans' (loaded via Google Fonts in
// index.html) so we can definitively see whether the UI font cascade
// actually reaches every component. Pixel-art look — if it shows up
// anywhere, that surface is fed by SYSTEM_FONT / VOICE / body inherit
// correctly. If a surface still looks like SF Pro, that's a real bug
// to chase. Revert to 'Annex Regular' once the diagnosis is done.
const SYSTEM =
  "'Pixelify Sans', 'Annex Regular', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const fonts = {
  heading: SYSTEM,
  body: SYSTEM,
} as const;

// Convenience for inline-web styles that used to reference 'Caveat'.
export const SYSTEM_FONT = SYSTEM;
