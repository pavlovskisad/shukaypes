// Ask OLX's CDN for a pet photo at the size it will be drawn.
//
// MEASURED, 12 Sep, two real pets from production (F-5 in
// 12-beta-perf-compat.md). The stored URL ends in `;s=1200x0` — a
// 1200px-wide render — and that is what every surface fetched, from the
// pet card down to a 54px marker disc:
//
//   ;s=1200x0   65–122 KB       ;s=480x0   42–58 KB
//   ;s=240x0    16–20 KB        ;s=120x0    6–7 KB
//
// With 184 photographed pets active, the marker layer alone could pull
// ~17 MB where ~1.5 MB would do, and the card stack's neighbour preload
// did the same at full size. The CDN resizes on request, so the fix is
// to ask for the right width per surface. Tiers rather than exact pixel
// widths, so every phone with the same rough density hits the same
// cached variant. (600 and 800 were measured too: the CDN's
// recompression made them no smaller than 1200 for one of the two pets,
// so they are not tiers.)
//
// Anything that is not an OLX CDN URL — our own /photos proxy for
// Telegram-ingested pets, an owner's upload — is returned untouched.

const OLX_PHOTO =
  /^(https?:\/\/[a-z0-9.-]*olxcdn\.com(?::\d+)?\/v1\/files\/[^/;?]+\/image)(?:;s=\d+x\d+)?$/i;

const TIERS = [120, 240, 480, 1200] as const;

/**
 * @param url    the photo URL as stored (buildPhotoUrl on the server)
 * @param cssPx  the width it will be drawn at, in CSS pixels
 */
export function petPhotoAt(url: string | null | undefined, cssPx: number): string | null {
  if (!url) return null;
  const m = OLX_PHOTO.exec(url);
  if (!m) return url;
  const dpr =
    typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
      ? Math.min(3, Math.max(1, window.devicePixelRatio))
      : 1;
  const want = Math.ceil(cssPx * dpr);
  const tier = TIERS.find((t) => t >= want) ?? TIERS[TIERS.length - 1];
  return `${m[1]};s=${tier}x0`;
}
