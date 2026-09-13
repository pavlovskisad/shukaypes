// A picked photo → a downscaled JPEG data URL, ready to send as
// `photoBase64`. Shared by the lost-pet report and the pet's portrait.

// Longest side after downscale. 1600px keeps a dog recognisable on any
// screen this app renders while cutting a camera original ~30-fold.
const PHOTO_MAX_SIDE = 1600;
const PHOTO_JPEG_QUALITY = 0.82;

// createImageBitmap where the browser has it (it decodes off the main
// thread), <img> decode as fallback. Throws on a format the browser
// cannot decode — a HEIC off an iPhone is the ordinary way to get
// there — and the caller must say so, not drop the file on the floor.
export async function fileToJpegBase64(file: File, maxSide = PHOTO_MAX_SIDE): Promise<string> {
  let width: number;
  let height: number;
  let source: CanvasImageSource;
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    width = bmp.width;
    height = bmp.height;
    source = bmp;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      width = img.naturalWidth;
      height = img.naturalHeight;
      source = img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
}
