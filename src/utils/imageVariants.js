// The longest side a generated catalog/list-grid thumbnail ever needs —
// comfortably larger than any card/thumbnail spot on the site (even at 2x
// retina), while staying a fraction of the full photo's size.
export const THUMB_MAX_DIMENSION = 480
export const THUMB_QUALITY = 78

/** Same-bucket companion key/URL for a full-size upload's small catalog
 * thumbnail — deterministic from the full URL alone, so any row that stores
 * an `image_url`/`main_image_url` from our own upload endpoint can derive
 * its thumbnail without a separate value having to be threaded through
 * every caller between the upload and wherever the URL ends up saved. GIFs
 * keep their own animation and just point their "thumbnail" at themselves
 * (a thumb-sized WebP would lose the animation, and GIFs are rare/small
 * uploads here anyway). */
export function deriveThumbUrl(url) {
  if (!url || typeof url !== 'string') return null
  if (url.toLowerCase().endsWith('.gif')) return url
  return url.replace(/\.\w+$/, '-thumb.webp')
}
