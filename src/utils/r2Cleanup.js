import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2Client } from '../config/r2.js'
import { env } from '../config/env.js'
import { pool } from '../config/db.js'
import { deriveThumbUrl } from './imageVariants.js'

// Every place a media_library URL can still be in use — checked before an
// actual R2 delete, since the "elegir de la galería" picker lets the same
// uploaded photo be reused across several of these at once (e.g. a category
// tile and a hero slide sharing one image). Each entry is queried with the
// URL about to be deleted still present in the OTHER rows (the caller's own
// row has usually already been updated/removed by the time this runs).
const REFERENCE_QUERIES = [
  'SELECT 1 FROM products WHERE main_image_url = ? LIMIT 1',
  'SELECT 1 FROM product_images WHERE image_url = ? LIMIT 1',
  'SELECT 1 FROM categories WHERE image_url = ? LIMIT 1',
  'SELECT 1 FROM collections WHERE banner_image_url = ? LIMIT 1',
  'SELECT 1 FROM banners WHERE image_url = ? LIMIT 1',
  'SELECT 1 FROM banners WHERE image_url_mobile = ? LIMIT 1',
  'SELECT 1 FROM packages_tile WHERE image_url = ? LIMIT 1',
]

async function isStillReferenced(url) {
  for (const sql of REFERENCE_QUERIES) {
    const [rows] = await pool.query(sql, [url])
    if (rows.length > 0) return true
  }
  return false
}

/** Deletes the R2 object a stored public URL points to, if any — but only
 * once nothing else in the database still points at it (the same uploaded
 * photo can now be picked for several different places via "elegir de la
 * galería", so losing one reference doesn't mean the file is actually
 * orphaned). Silently no-ops for null/undefined or any URL that isn't
 * actually under our own R2_PUBLIC_URL, so it's always safe to call
 * speculatively whenever a product/collection/hero-slide/category is
 * deleted or its image is replaced, without checking first. Best-effort —
 * logs and swallows failures instead of throwing, since a stray orphaned
 * file in R2 is far less bad than losing the actual delete/update the
 * caller was doing. */
export async function deleteR2ObjectByUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith(`${env.r2.publicUrl}/`)) return
  try {
    if (await isStillReferenced(url)) return
  } catch (err) {
    // If the reference check itself fails, err on the side of NOT deleting —
    // an orphaned file is recoverable, a wrongly-deleted still-in-use one isn't.
    console.error('Failed to check remaining references for', url, err)
    return
  }
  const key = url.slice(env.r2.publicUrl.length + 1)
  try {
    await r2Client.send(new DeleteObjectCommand({ Bucket: env.r2.bucketName, Key: key }))
    await pool.query('DELETE FROM media_library WHERE url = ?', [url])
  } catch (err) {
    console.error('Failed to delete R2 object for', key, err)
  }

  // The small catalog-thumbnail companion this upload created alongside the
  // full photo (see imageVariants.js) — same 1:1 lifecycle as the main file,
  // so once the main file is confirmed unreferenced and gone, its thumbnail
  // is safe to remove too without a reference check of its own. Silently
  // no-ops for a pre-thumbnail-feature upload that never had one.
  const thumbUrl = deriveThumbUrl(url)
  if (thumbUrl && thumbUrl !== url) {
    const thumbKey = thumbUrl.slice(env.r2.publicUrl.length + 1)
    try {
      await r2Client.send(new DeleteObjectCommand({ Bucket: env.r2.bucketName, Key: thumbKey }))
    } catch {
      // Nothing to clean up if it never existed.
    }
  }
}
