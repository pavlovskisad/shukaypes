// Minimalist system-ui font stack — clean, readable, no handwriting.
// Same face for heading + body; weight/size does the hierarchy.
const SYSTEM =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const fonts = {
  heading: SYSTEM,
  body: SYSTEM,
} as const;

// Convenience for inline-web styles that used to reference 'Caveat'.
export const SYSTEM_FONT = SYSTEM;
