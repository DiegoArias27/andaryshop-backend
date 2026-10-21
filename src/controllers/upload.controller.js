import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2Client } from '../config/r2.js'
import { env } from '../config/env.js'
import { pool } from '../config/db.js'
import { THUMB_MAX_DIMENSION, THUMB_QUALITY, deriveThumbUrl } from '../utils/imageVariants.js'
import { deleteR2ObjectByUrl } from '../utils/r2Cleanup.js'

// The longest side a stored photo ever needs — comfortably larger than any
// spot it's displayed at on the site, so nothing looks soft, but it stops a
// 12MP+ phone photo from eating multiple MB for no visible benefit.
const MAX_DIMENSION = 2000
// WebP at this quality is visually indistinguishable from the source for
// photography in side-by-side comparisons, while typically landing at
// 10-30% of the original JPEG/PNG's size.
const WEBP_QUALITY = 82

export async function uploadImage(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded (field name: "image")' })
    }

    // GIFs pass through untouched — re-encoding would drop the animation.
    // Everything else gets auto-oriented, capped to MAX_DIMENSION and
    // re-encoded as WebP, which is what actually shrinks the file.
    let body = req.file.buffer
    let contentType = req.file.mimetype
    let ext = 'bin'
    if (req.file.mimetype === 'image/gif') {
      ext = 'gif'
    } else {
      body = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer()
      contentType = 'image/webp'
      ext = 'webp'
    }

    const key = `products/${randomUUID()}.${ext}`

    await r2Client.send(
      new PutObjectCommand({
        Bucket: env.r2.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    )

    const url = `${env.r2.publicUrl}/${key}`

    // A small catalog/list-grid companion, generated alongside the full
    // photo so the catalog, cart and favorites never have to pull the full
    // up-to-2000px version just to show a thumbnail. GIFs skip this (see
    // deriveThumbUrl) — thumbUrl just points back at the original file.
    const thumbUrl = deriveThumbUrl(url)
    if (thumbUrl && thumbUrl !== url) {
      const thumbBody = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: THUMB_MAX_DIMENSION, height: THUMB_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer()
      const thumbKey = thumbUrl.slice(env.r2.publicUrl.length + 1)
      await r2Client.send(
        new PutObjectCommand({
          Bucket: env.r2.bucketName,
          Key: thumbKey,
          Body: thumbBody,
          ContentType: 'image/webp',
        })
      )
    }

    // Best-effort — the upload itself already succeeded, so a logging
    // failure here shouldn't fail the request (the image just won't show up
    // in the "elegir de la galería" picker later).
    pool.query('INSERT INTO media_library (url) VALUES (?)', [url]).catch(() => {})
    res.status(201).json({ url, thumbUrl, key })
  } catch (err) {
    next(err)
  }
}

export async function listMedia(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT id, url, created_at FROM media_library ORDER BY id DESC LIMIT 300')
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

export async function deleteImage(req, res, next) {
  try {
    const { url } = req.body
    // Restrict deletes to URLs this endpoint itself could have generated,
    // so an arbitrary URL can't be used to reach outside our own bucket.
    if (!url || typeof url !== 'string' || !/^products\/[\w-]+\.\w+$/.test(url.slice(env.r2.publicUrl.length + 1))) {
      return res.status(400).json({ error: 'Invalid url' })
    }

    // Shared with every other "delete this image" call site (product/
    // category/collection/banner deletes) — checks nothing else in the
    // database still references this exact URL before actually removing it,
    // and cleans up the catalog-thumbnail companion + media_library row in
    // the same step. Safe to call even for an image that was never attached
    // to anything (a draft product's photo removed/replaced before saving).
    await deleteR2ObjectByUrl(url)

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}
