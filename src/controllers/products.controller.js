import { pool } from '../config/db.js'
import { slugify } from '../utils/slugify.js'
import { deleteR2ObjectByUrl } from '../utils/r2Cleanup.js'
import { deriveThumbUrl } from '../utils/imageVariants.js'

const BASE_SELECT = `
  SELECT p.*, c.name AS category_name, c.slug AS category_slug,
         b.name AS brand_name, b.slug AS brand_slug
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN brands b ON b.id = p.brand_id
`

// Fallbacks only for the unlikely case the app_settings row is missing —
// the real values live in the database (see admin/src/pages/Settings.tsx)
// so the shop can tune them without a redeploy.
const DEFAULT_BESTSELLER_MIN_QTY = 3
const DEFAULT_BESTSELLER_LIMIT = 10

/** Computed fresh from real sales every time — never stored — so the badge
 * always reflects current standing instead of a stale manual flag. A
 * product needs at least `bestseller_min_qty` confirmed, non-gift units
 * sold (all-time) to qualify — keeps a handful of one-off sales in a
 * young/low-volume shop from trivially badging half the catalog. Only the
 * top `bestseller_limit` products beyond that floor qualify. */
async function getBestsellerProductIds() {
  const [settingsRows] = await pool.query('SELECT bestseller_min_qty, bestseller_limit FROM app_settings WHERE id = 1')
  const minQty = Number(settingsRows[0]?.bestseller_min_qty) || DEFAULT_BESTSELLER_MIN_QTY
  const limit = Number(settingsRows[0]?.bestseller_limit) || DEFAULT_BESTSELLER_LIMIT

  const [rows] = await pool.query(
    `SELECT oi.product_id, SUM(oi.quantity) AS total_sold
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'confirmed' AND oi.is_gift = 0 AND oi.product_id IS NOT NULL
     GROUP BY oi.product_id
     HAVING total_sold >= ?
     ORDER BY total_sold DESC
     LIMIT ?`,
    [minQty, limit]
  )
  return new Set(rows.map((r) => r.product_id))
}

async function attachRelations(products) {
  if (products.length === 0) return []

  const productIds = products.map((p) => p.id)

  const [images] = await pool.query(
    `SELECT * FROM product_images WHERE product_id IN (?) ORDER BY sort_order ASC`,
    [productIds]
  )
  const [variants] = await pool.query(
    `SELECT * FROM product_variants WHERE product_id IN (?) ORDER BY sort_order ASC`,
    [productIds]
  )
  const [collections] = await pool.query(
    `SELECT cp.product_id, cp.discount_price, c.id, c.name, c.slug, c.pricing_mode, c.unit_price, c.unit_min_qty, c.bundle_qty, c.bundle_price
     FROM collection_products cp
     JOIN collections c ON c.id = cp.collection_id
     WHERE cp.product_id IN (?) AND c.is_active = 1
     ORDER BY c.sort_order ASC`,
    [productIds]
  )
  const bestsellerIds = await getBestsellerProductIds()

  return products.map((product) => ({
    ...product,
    is_bestseller: bestsellerIds.has(product.id),
    images: images.filter((img) => img.product_id === product.id),
    variants: variants.filter((v) => v.product_id === product.id),
    collections: collections
      .filter((c) => c.product_id === product.id)
      .map(({ product_id, discount_price, ...c }) => ({ ...c, discount_price })),
  }))
}

/** Keeps products.main_image_url mirroring the lowest-sort_order gallery
 * photo, so the "main image" is just whichever image sits first — dragging
 * the gallery order changes the cover photo, deleting it promotes the next one. */
async function syncMainImage(productId) {
  const [rows] = await pool.query(
    'SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC LIMIT 1',
    [productId]
  )
  const mainImageUrl = rows[0]?.image_url ?? null
  await pool.query('UPDATE products SET main_image_url = ?, main_thumb_url = ? WHERE id = ?', [
    mainImageUrl,
    deriveThumbUrl(mainImageUrl),
    productId,
  ])
}

export async function listProducts(req, res, next) {
  try {
    const { category, brand, search, isNew, isFeatured, discounted, includeInactive } = req.query

    const conditions = []
    const params = []

    if (!includeInactive) {
      conditions.push('p.is_active = 1')
    }

    if (category) {
      conditions.push('c.slug = ?')
      params.push(category)
    }

    if (brand) {
      conditions.push('b.slug = ?')
      params.push(brand)
    }

    if (search) {
      conditions.push(
        '(p.name LIKE ? OR p.description LIKE ? OR b.name LIKE ? OR p.id IN (SELECT product_id FROM product_variants WHERE barcode LIKE ?))'
      )
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
    }

    if (isNew === 'true') conditions.push('p.is_new = 1')
    if (isFeatured === 'true') conditions.push('p.is_featured = 1')
    if (discounted === 'true') conditions.push('p.discount_type IS NOT NULL')

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const [rows] = await pool.query(`${BASE_SELECT} ${where} ORDER BY p.created_at DESC`, params)

    const withRelations = await attachRelations(rows)
    res.json(withRelations)
  } catch (err) {
    next(err)
  }
}

export async function getProductBySlug(req, res, next) {
  try {
    const { slug } = req.params

    const [rows] = await pool.query(`${BASE_SELECT} WHERE p.slug = ? LIMIT 1`, [slug])

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const [withRelations] = await attachRelations(rows)
    res.json(withRelations)
  } catch (err) {
    next(err)
  }
}

export async function getProductById(req, res, next) {
  try {
    const { id } = req.params

    const [rows] = await pool.query(`${BASE_SELECT} WHERE p.id = ? LIMIT 1`, [id])

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const [withRelations] = await attachRelations(rows)
    res.json(withRelations)
  } catch (err) {
    next(err)
  }
}

export async function createProduct(req, res, next) {
  try {
    const {
      name,
      description = '',
      price,
      brandId = null,
      categoryId = null,
      mainImageUrl = null,
      isNew = false,
      isFeatured = false,
      discountType = null,
      discountValue = null,
      images = [],
    } = req.body

    if (!name || price === undefined) {
      return res.status(400).json({ error: 'name and price are required' })
    }

    const slug = slugify(name)

    const [result] = await pool.query(
      `INSERT INTO products (category_id, brand_id, name, slug, description, price, main_image_url, main_thumb_url, is_new, is_featured, discount_type, discount_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        categoryId,
        brandId,
        name,
        slug,
        description,
        price,
        mainImageUrl,
        deriveThumbUrl(mainImageUrl),
        !!isNew,
        !!isFeatured,
        discountType,
        discountValue,
      ]
    )

    const productId = result.insertId

    if (mainImageUrl) {
      await pool.query(
        'INSERT INTO product_images (product_id, image_url, thumb_url, sort_order) VALUES (?, ?, ?, -1)',
        [productId, mainImageUrl, deriveThumbUrl(mainImageUrl)]
      )
    }

    if (Array.isArray(images) && images.length > 0) {
      const values = images.map((url, index) => [productId, url, deriveThumbUrl(url), index])
      await pool.query(
        'INSERT INTO product_images (product_id, image_url, thumb_url, sort_order) VALUES ?',
        [values]
      )
    }

    const [rows] = await pool.query(`${BASE_SELECT} WHERE p.id = ?`, [productId])
    const [withRelations] = await attachRelations(rows)
    res.status(201).json(withRelations)
  } catch (err) {
    next(err)
  }
}

export async function updateProduct(req, res, next) {
  try {
    const { id } = req.params
    const {
      name,
      description,
      price,
      brandId,
      categoryId,
      mainImageUrl,
      isNew,
      isFeatured,
      isActive,
      discountType,
      discountValue,
    } = req.body

    const fields = []
    const params = []

    if (name !== undefined) {
      fields.push('name = ?', 'slug = ?')
      params.push(name, slugify(name))
    }
    if (description !== undefined) { fields.push('description = ?'); params.push(description) }
    if (price !== undefined) { fields.push('price = ?'); params.push(price) }
    if (brandId !== undefined) { fields.push('brand_id = ?'); params.push(brandId) }
    if (categoryId !== undefined) { fields.push('category_id = ?'); params.push(categoryId) }
    if (mainImageUrl !== undefined) {
      fields.push('main_image_url = ?', 'main_thumb_url = ?')
      params.push(mainImageUrl, deriveThumbUrl(mainImageUrl))
    }
    if (isNew !== undefined) { fields.push('is_new = ?'); params.push(!!isNew) }
    if (isFeatured !== undefined) { fields.push('is_featured = ?'); params.push(!!isFeatured) }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(!!isActive) }
    if (discountType !== undefined) { fields.push('discount_type = ?'); params.push(discountType) }
    if (discountValue !== undefined) { fields.push('discount_value = ?'); params.push(discountValue) }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    params.push(id)
    const [result] = await pool.query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = ?`,
      params
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }

    const [rows] = await pool.query(`${BASE_SELECT} WHERE p.id = ?`, [id])
    const [withRelations] = await attachRelations(rows)
    res.json(withRelations)
  } catch (err) {
    next(err)
  }
}

export async function deleteProduct(req, res, next) {
  try {
    const { id } = req.params
    const [images] = await pool.query('SELECT image_url FROM product_images WHERE product_id = ?', [id])
    const [result] = await pool.query('DELETE FROM products WHERE id = ?', [id])

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' })
    }

    await Promise.all(images.map((img) => deleteR2ObjectByUrl(img.image_url)))

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function bulkDeleteProducts(req, res, next) {
  try {
    const { productIds } = req.body
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'productIds array is required' })
    }

    const [images] = await pool.query('SELECT image_url FROM product_images WHERE product_id IN (?)', [productIds])
    await pool.query('DELETE FROM products WHERE id IN (?)', [productIds])
    await Promise.all(images.map((img) => deleteR2ObjectByUrl(img.image_url)))

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function addProductImages(req, res, next) {
  try {
    const { id } = req.params
    const { images = [] } = req.body

    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'images array is required' })
    }

    const [maxRows] = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM product_images WHERE product_id = ?',
      [id]
    )
    const maxOrder = maxRows[0].maxOrder

    const values = images.map((entry, index) => {
      const url = typeof entry === 'string' ? entry : entry.url
      const colorName = typeof entry === 'string' ? null : entry.colorName ?? null
      return [id, url, deriveThumbUrl(url), colorName, maxOrder + 1 + index]
    })
    await pool.query(
      'INSERT INTO product_images (product_id, image_url, thumb_url, color_name, sort_order) VALUES ?',
      [values]
    )
    await syncMainImage(id)

    const [rows] = await pool.query('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC', [id])
    res.status(201).json(rows)
  } catch (err) {
    next(err)
  }
}

export async function updateProductImage(req, res, next) {
  try {
    const { imageId } = req.params
    const { colorName } = req.body

    if (colorName === undefined) {
      return res.status(400).json({ error: 'colorName is required' })
    }

    const [result] = await pool.query('UPDATE product_images SET color_name = ? WHERE id = ?', [colorName, imageId])

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Image not found' })
    }

    const [rows] = await pool.query('SELECT * FROM product_images WHERE id = ?', [imageId])
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function reorderProductImages(req, res, next) {
  try {
    const { id } = req.params
    const { orderedIds } = req.body

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return res.status(400).json({ error: 'orderedIds array is required' })
    }

    await Promise.all(
      orderedIds.map((imageId, index) =>
        pool.query('UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?', [index, imageId, id])
      )
    )
    await syncMainImage(id)

    const [rows] = await pool.query('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC', [id])
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

export async function deleteProductImage(req, res, next) {
  try {
    const { imageId } = req.params
    const [existing] = await pool.query('SELECT product_id, image_url FROM product_images WHERE id = ?', [imageId])

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Image not found' })
    }

    await pool.query('DELETE FROM product_images WHERE id = ?', [imageId])
    await syncMainImage(existing[0].product_id)
    await deleteR2ObjectByUrl(existing[0].image_url)

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function bulkUpdateDiscount(req, res, next) {
  try {
    const { productIds, discountType = null, discountValue = null } = req.body

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ error: 'productIds array is required' })
    }

    await pool.query('UPDATE products SET discount_type = ?, discount_value = ? WHERE id IN (?)', [
      discountType,
      discountValue,
      productIds,
    ])

    const [rows] = await pool.query(`${BASE_SELECT} WHERE p.id IN (?)`, [productIds])
    const withRelations = await attachRelations(rows)
    res.json(withRelations)
  } catch (err) {
    next(err)
  }
}
