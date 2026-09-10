// Can this browser draw the map at all?
//
// MapLibre GL JS v5 requires WebGL2 — v5 dropped the WebGL1 path — and
// its constructor throws "Failed to initialize WebGL" when the context
// comes back null. Until now that throw was caught, logged to the
// console, and nothing else happened: the user sat on the "locating…"
// screen forever with no idea that their phone was the reason.
//
// The floor this sets, in device terms: iOS 15 or later (WebGL2 shipped
// on by default in Safari 15, so an iPhone 6s can get there and an
// iPhone 6 cannot), Android Chrome 56+ / a 2017-or-later WebView. A
// Telegram Mini App uses the same engine as the system browser, so the
// same floor applies inside Telegram.
//
// Asked ONCE and cached. A WebGL context is a scarce resource — iOS
// caps a page at a handful — so the probe context is released with
// WEBGL_lose_context immediately rather than left for the GC to find.
//
// `failIfMajorPerformanceCaveat` is deliberately NOT set: a software-
// rendered WebGL2 is a slow map, not no map, and the classic (non-
// three.js) render path already exists for exactly that device class.

let cached: boolean | null = null;

export function webgl2Supported(): boolean {
  if (cached !== null) return cached;
  if (typeof document === 'undefined') {
    // Off web (native) the map is not MapLibre GL JS, so the question
    // does not arise; answer yes so nothing downstream shows a warning.
    cached = true;
    return cached;
  }
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    cached = gl != null;
    if (gl) {
      try {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {
        /* the context is dropped with the canvas either way */
      }
    }
  } catch {
    cached = false;
  }
  return cached;
}
