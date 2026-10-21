import { pool } from '../config/db.js'
import { deleteR2ObjectByUrl } from '../utils/r2Cleanup.js'

const BASE_SELECT = `
  SELECT b.*, c.slug AS collection_slug, c.name AS collection_name,
         pc.slug AS placement_category_slug, pc.name AS placement_category_name
  FROM banners b
  LEFT JOIN collections c ON c.id = b.collection_id
  LEFT JOIN categories pc ON pc.id = b.placement_category_id
`

export async function listBanners(req, res, next) {
  try {
    const { includeInactive, placement, categorySlug } = req.query
    const where = []
    const params = []

    if (!includeInactive) where.push('b.is_active = 1')
    if (placement) {
      where.push('b.placement = ?')
      params.push(placement)
    }
    if (categorySlug) {
      where.push('pc.slug = ?')
      params.push(categorySlug)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [rows] = await pool.query(
      `${BASE_SELECT} ${whereSql} ORDER BY b.sort_order ASC, b.created_at ASC`,
      params
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

export async function createBanner(req, res, next) {
  try {
    const {
      kind = 'hero',
      placement = 'home_hero',
      placementCategoryId = null,
      imageUrl,
      badgeText = null,
      title = null,
      subtitle = null,
      ctaText = null,
      ctaLink = null,
      collectionId = null,
      isActive = true,
      sortOrder = 0,
      layoutJson = null,
      imageFocusX = 50,
      imageFocusY = 50,
      imageZoom = null,
      scrimOpacity = null,
      imageUrlMobile = null,
    } = req.body

    if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' })

    const [result] = await pool.query(
      `INSERT INTO banners (kind, placement, placement_category_id, image_url, badge_text, title, subtitle, cta_text, cta_link, collection_id, is_active, sort_order, layout_json, image_focus_x, image_focus_y, image_zoom, scrim_opacity, image_url_mobile)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        kind,
        placement,
        placementCategoryId,
        imageUrl,
        badgeText,
        title,
        subtitle,
        ctaText,
        ctaLink,
        collectionId,
        !!isActive,
        sortOrder,
        layoutJson ? JSON.stringify(layoutJson) : null,
        imageFocusX,
        imageFocusY,
        imageZoom,
        scrimOpacity,
        imageUrlMobile,
      ]
    )

    const [rows] = await pool.query(`${BASE_SELECT} WHERE b.id = ?`, [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function updateBanner(req, res, next) {
  try {
    const { id } = req.params
    const {
      kind,
      placement,
      placementCategoryId,
      imageUrl,
      badgeText,
      title,
      subtitle,
      ctaText,
      ctaLink,
      collectionId,
      isActive,
      sortOrder,
      layoutJson,
      imageFocusX,
      imageFocusY,
      imageZoom,
      scrimOpacity,
      imageUrlMobile,
    } = req.body

    // Read the old images before overwriting them, so a replaced banner
    // photo doesn't linger in R2 forever.
    let oldImageUrl = null
    let oldImageUrlMobile = null
    if (imageUrl !== undefined || imageUrlMobile !== undefined) {
      const [existing] = await pool.query('SELECT image_url, image_url_mobile FROM banners WHERE id = ?', [id])
      oldImageUrl = existing[0]?.image_url ?? null
      oldImageUrlMobile = existing[0]?.image_url_mobile ?? null
    }

    const fields = []
    const params = []

    if (kind !== undefined) { fields.push('kind = ?'); params.push(kind) }
    if (placement !== undefined) { fields.push('placement = ?'); params.push(placement) }
    if (placementCategoryId !== undefined) { fields.push('placement_category_id = ?'); params.push(placementCategoryId) }
    if (imageUrl !== undefined) { fields.push('image_url = ?'); params.push(imageUrl) }
    if (badgeText !== undefined) { fields.push('badge_text = ?'); params.push(badgeText) }
    if (title !== undefined) { fields.push('title = ?'); params.push(title) }
    if (subtitle !== undefined) { fields.push('subtitle = ?'); params.push(subtitle) }
    if (ctaText !== undefined) { fields.push('cta_text = ?'); params.push(ctaText) }
    if (ctaLink !== undefined) { fields.push('cta_link = ?'); params.push(ctaLink) }
    if (collectionId !== undefined) { fields.push('collection_id = ?'); params.push(collectionId) }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(!!isActive) }
    if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(sortOrder) }
    if (layoutJson !== undefined) { fields.push('layout_json = ?'); params.push(layoutJson ? JSON.stringify(layoutJson) : null) }
    if (imageFocusX !== undefined) { fields.push('image_focus_x = ?'); params.push(imageFocusX) }
    if (imageFocusY !== undefined) { fields.push('image_focus_y = ?'); params.push(imageFocusY) }
    if (imageZoom !== undefined) { fields.push('image_zoom = ?'); params.push(imageZoom) }
    if (scrimOpacity !== undefined) { fields.push('scrim_opacity = ?'); params.push(scrimOpacity) }
    if (imageUrlMobile !== undefined) { fields.push('image_url_mobile = ?'); params.push(imageUrlMobile) }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    params.push(id)
    const [result] = await pool.query(`UPDATE banners SET ${fields.join(', ')} WHERE id = ?`, params)

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Banner not found' })
    }

    if (oldImageUrl && oldImageUrl !== imageUrl) await deleteR2ObjectByUrl(oldImageUrl)
    if (oldImageUrlMobile && oldImageUrlMobile !== imageUrlMobile) await deleteR2ObjectByUrl(oldImageUrlMobile)

    const [rows] = await pool.query(`${BASE_SELECT} WHERE b.id = ?`, [id])
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function deleteBanner(req, res, next) {
  try {
    const { id } = req.params
    const [existing] = await pool.query('SELECT image_url FROM banners WHERE id = ?', [id])
    const [result] = await pool.query('DELETE FROM banners WHERE id = ?', [id])

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Banner not found' })
    }

    if (existing[0]?.image_url) await deleteR2ObjectByUrl(existing[0].image_url)

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

// Bulk sort_order update for drag-to-reorder — only reorders within
// whatever set of banners the admin is currently dragging (usually all
// banners sharing one placement), so it takes an explicit ordered id list
// rather than trying to infer scope from the ids themselves.
export async function reorderBanners(req, res, next) {
  try {
    const { orderedIds } = req.body
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ error: 'orderedIds array is required' })
    }

    await Promise.all(
      orderedIds.map((id, index) => pool.query('UPDATE banners SET sort_order = ? WHERE id = ?', [index, id]))
    )

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}
