// Brand font for the whole UI. Annex Regular is loaded via @font-face
// in app/public/index.html with font-display: swap, so the system
// stack acts as the fallback during the brief window before the TTF
// lands. Same face for heading + body — weight/size does hierarchy.
const SYSTEM =
  "'Annex Regular', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const fonts = {
  heading: SYSTEM,
  body: SYSTEM,
} as const;

// Convenience for inline-web styles that used to reference 'Caveat'.
export const SYSTEM_FONT = SYSTEM;
