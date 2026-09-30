// WHERE EVERY createPortal GOES (D17a, UX-12.11).
//
// Sheets, the pet card, the toast and the off-screen companion chip
// are portaled out of the React tree so their z-index lives at the page
// root instead of inside MapView's stacking contexts. (The splash is
// the exception: it covers the whole window, so it stays on <body>.)
// They used to portal straight to <body> — and on a desktop, where the
// app is a 430 px phone column in the middle of the screen, a
// `position: fixed; inset: 0` child of <body> is the whole WINDOW: the
// scrims dimmed the dark wings, the pet card and the sheets pinned to
// the window's edges, the chip docked 500 px to the right of the map it
// points across.
//
// #portal-root (public/index.html) is a sibling of #root. On a phone
// it carries no style at all, so a fixed child is placed against the
// viewport exactly as before. From the 900 px desktop breakpoint up it
// is sized and placed like #root's column and made the containing block
// for its fixed children (a transform), so "fixed, inset 0" means the
// column. The breakpoint is the column's own, unchanged.
//
// Falls back to <body> if the element is missing (a stale cached
// index.html), which is the old behaviour rather than a crash.
export function portalRoot(): HTMLElement {
  return document.getElementById('portal-root') ?? document.body;
}
