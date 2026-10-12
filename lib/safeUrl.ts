// Strict allow-list for anything rendered as <img src> / link target from stored data (audit S-05).
// Only inline raster images, same-origin file URLs and the configured storage origin are accepted – never javascript:, svg or html.
const DATA_IMG = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const LOCAL = /^\/api\/files\/[A-Za-z0-9._~\-/]+(\?[A-Za-z0-9=&_.\-%]*)?$/;

export function isSafeImageSrc(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 12_000_000) return false;
  if (v.includes('..')) return false; // no path traversal
  return DATA_IMG.test(v) || LOCAL.test(v);
}

/** Server-side validator for photo-like fields: empty, or a safe image reference. */
export function assertPhotoField(v: unknown): void {
  if (v === undefined || v === null || v === '') return;
  if (Array.isArray(v)) { v.forEach(assertPhotoField); return; }
  if (!isSafeImageSrc(v)) throw new Error('Photo must be an image');
}
