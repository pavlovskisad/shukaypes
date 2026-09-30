// Brand font for the whole UI. Annex Regular is loaded via @font-face
// in app/public/index.html with font-display: swap; the system stack
// acts as the fallback during the brief window before the WOFF2
// lands. Every <Text> on RN-Web inherits this via the patch in
// utils/patchTextDefaults.ts (which was the missing piece that made
// the cascade actually reach every component). Inline web styles and
// <button>s name it directly as SYSTEM_FONT.
//
// Only the regular face ships, so bold is the browser's synthetic
// bold — see the WEIGHTS note in constants/type.ts. The map's labels
// are a separate thing: MapLibre draws them from PBF glyphs, named by
// MAP_FONT in components/map/crayonStyle.ts.
//
// (There used to be `fonts.heading` / `fonts.body` tokens here, both
// the same stack and read by nothing, and a comment about Caveat, a
// face the app no longer uses anywhere — UX-11.15.)
export const SYSTEM_FONT =
  "'Annex Regular', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
