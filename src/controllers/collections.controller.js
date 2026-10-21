import { pool } from '../config/db.js'
import { slugify } from '../utils/slugify.js'
import { deleteR2ObjectByUrl } from '../utils/r2Cleanup.js'

async function attachProducts(collections) {
  if (collections.length === 0) return []

  const collectionIds = collections.map((c) => c.id)

  const [rows] = await pool.query(
    `SELECT cp.collection_id, cp.discount_price, p.*, c.name AS category_name, c.slug AS category_slug,
            b.name AS brand_name, b.slug AS brand_slug
     FROM collection_products cp
     JOIN products p ON p.id = cp.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     WHERE cp.collection_id IN (?) AND p.is_active = 1
     ORDER BY cp.sort_order ASC`,
    [collectionIds]
  )

  const productIds = [...new Set(rows.map((r) => r.id))]
  let images = []
  let variants = []
  let memberships = []

  if (productIds.length > 0) {
    ;[images] = await pool.query(
      'SELECT * FROM product_images WHERE product_id IN (?) ORDER BY sort_order ASC',
      [productIds]
    )
    ;[variants] = await pool.query(
      'SELECT * FROM product_variants WHERE product_id IN (?) ORDER BY sort_order ASC',
      [productIds]
    )
    ;[memberships] = await pool.query(
      `SELECT cp.product_id, cp.discount_price, c.id, c.name, c.slug, c.pricing_mode, c.unit_price, c.bundle_qty, c.bundle_price
       FROM collection_products cp
       JOIN collections c ON c.id = cp.collection_id
       WHERE cp.product_id IN (?) AND c.is_active = 1
       ORDER BY c.sort_order ASC`,
      [productIds]
    )
  }

  return collections.map((collection) => ({
    ...collection,
    products: rows
      .filter((r) => r.collection_id === collection.id)
      .map(({ collection_id, discount_price, ...p }) => ({
        ...p,
        collection_discount_price: discount_price,
        images: images.filter((img) => img.product_id === p.id),
        variants: variants.filter((v) => v.product_id === p.id),
        collections: memberships
          .filter((m) => m.product_id === p.id)
          .map(({ product_id, discount_price: d, ...m }) => ({ ...m, discount_price: d })),
      })),
  }))
}

async function attachBundleParts(collections) {
  if (collections.length === 0) return []

  const collectionIds = collections.map((c) => c.id)
  const [rows] = await pool.query(
    `SELECT bp.*, c.name AS category_name, c.slug AS category_slug, p.name AS product_name
     FROM collection_bundle_parts bp
     JOIN categories c ON c.id = bp.category_id
     LEFT JOIN products p ON p.id = bp.product_id
     WHERE bp.collection_id IN (?)
     ORDER BY bp.sort_order ASC`,
    [collectionIds]
  )

  return collections.map((collection) => ({
    ...collection,
    bundle_parts: rows.filter((r) => r.collection_id === collection.id),
  }))
}

async function attachComboTiers(collections) {
  if (collections.length === 0) return []

  const collectionIds = collections.map((c) => c.id)
  const [rows] = await pool.query(
    'SELECT * FROM collection_combo_tiers WHERE collection_id IN (?) ORDER BY sort_order ASC',
    [collectionIds]
  )

  return collections.map((collection) => ({
    ...collection,
    combo_tiers: rows.filter((r) => r.collection_id === collection.id),
  }))
}

/** Which tier (bundle part / combo tier / wholesale range) actually got
 * picked most often in real confirmed sales — see order_items.tier_key.
 * Null until the collection has any sale with a resolved tier (a brand-new
 * collection, or one only ever bought at its flat/unit price). */
async function attachMostChosenTier(collections) {
  if (collections.length === 0) return []

  const collectionIds = collections.map((c) => c.id)
  const [rows] = await pool.query(
    `SELECT oi.collection_id, oi.tier_key, SUM(oi.quantity) AS qty
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'confirmed' AND oi.collection_id IN (?) AND oi.tier_key IS NOT NULL
     GROUP BY oi.collection_id, oi.tier_key
     ORDER BY qty DESC`,
    [collectionIds]
  )
  const bestByCollection = new Map()
  for (const r of rows) {
    if (!bestByCollection.has(r.collection_id)) bestByCollection.set(r.collection_id, r.tier_key)
  }

  return collections.map((collection) => ({
    ...collection,
    most_chosen_tier_key: bestByCollection.get(collection.id) ?? null,
  }))
}

async function attachRelations(collections) {
  const withProducts = await attachProducts(collections)
  const withParts = await attachBundleParts(withProducts)
  const withCombo = await attachComboTiers(withParts)
  return attachMostChosenTier(withCombo)
}

// Used for 'bundle'/'unit' parts (never tiered) — also clears any leftover
// combo tiers for this collection, so switching away from 'combo' doesn't
// leave orphaned tier rows behind.
async function replaceBundleParts(collectionId, parts) {
  await pool.query('DELETE FROM collection_combo_tiers WHERE collection_id = ?', [collectionId])
  await pool.query('DELETE FROM collection_bundle_parts WHERE collection_id = ?', [collectionId])
  if (!Array.isArray(parts) || parts.length === 0) return

  const values = parts.map((part, index) => [
    collectionId,
    part.categoryId,
    part.productId ?? null,
    !!part.isSpecific,
    part.requiredQty,
    part.price ?? null,
    !!part.isGift,
    index,
  ])
  await pool.query(
    'INSERT INTO collection_bundle_parts (collection_id, category_id, product_id, is_specific, required_qty, price, is_gift, sort_order) VALUES ?',
    [values]
  )
}

// Used only for 'combo' — replaces every tier (variant) and its parts in one
// go. Each tier owns its own price and its own set of category quotas; a
// single tier means the customer picks products directly, more than one
// means they choose a tier first (tier-cards), like wholesale's ranges.
async function replaceComboTiers(collectionId, tiers) {
  // Deleting the tiers cascades (ON DELETE CASCADE) to their own parts; this
  // second delete only catches legacy untiered combo parts, if any remain.
  await pool.query('DELETE FROM collection_combo_tiers WHERE collection_id = ?', [collectionId])
  await pool.query('DELETE FROM collection_bundle_parts WHERE collection_id = ? AND combo_tier_id IS NULL', [collectionId])
  if (!Array.isArray(tiers) || tiers.length === 0) return

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]
    const [result] = await pool.query(
      'INSERT INTO collection_combo_tiers (collection_id, price, sort_order) VALUES (?, ?, ?)',
      [collectionId, tier.price, i]
    )
    const tierId = result.insertId
    const parts = Array.isArray(tier.parts) ? tier.parts : []
    if (parts.length === 0) continue

    const values = parts.map((part, index) => [
      collectionId,
      part.categoryId,
      null,
      !!part.isSpecific,
      part.requiredQty,
      null,
      !!part.isGift,
      index,
      tierId,
    ])
    await pool.query(
      'INSERT INTO collection_bundle_parts (collection_id, category_id, product_id, is_specific, required_qty, price, is_gift, sort_order, combo_tier_id) VALUES ?',
      [values]
    )
  }
}

export async function listCollections(req, res, next) {
  try {
    const { includeInactive } = req.query
    const where = includeInactive ? '' : 'WHERE is_active = 1'

    const [rows] = await pool.query(
      `SELECT * FROM collections ${where} ORDER BY sort_order ASC, created_at DESC`
    )

    const withProducts = await attachRelations(rows)
    res.json(withProducts)
  } catch (err) {
    next(err)
  }
}

export async function getCollection(req, res, next) {
  try {
    const { id } = req.params
    const [rows] = await pool.query('SELECT * FROM collections WHERE id = ?', [id])

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    const [withProducts] = await attachRelations(rows)
    res.json(withProducts)
  } catch (err) {
    next(err)
  }
}

export async function createCollection(req, res, next) {
  try {
    const {
      name,
      adminTag = null,
      description = '',
      bannerImageUrl = null,
      isActive = true,
      showOnHome = true,
      limitedTime = false,
      limitedTimeStartsAt = null,
      limitedTimeEndsAt = null,
      sortOrder = 0,
      pricingMode = 'none',
      unitPrice = null,
      unitMinQty = null,
      bundleQty = null,
      bundlePrice = null,
      wholesaleCategoryId = null,
      wholesaleAnyProduct = false,
      allowAddAllToCart = false,
      promoText = null,
      bundleParts = null,
      comboTiers = null,
      layoutJson = null,
      imageFocusX = 50,
      imageFocusY = 50,
    } = req.body

    if (!name) return res.status(400).json({ error: 'name is required' })

    const slug = slugify(adminTag ? `${name}-${adminTag}` : name)
    const [result] = await pool.query(
      `INSERT INTO collections
         (name, slug, admin_tag, description, banner_image_url, layout_json, image_focus_x, image_focus_y, is_active, show_on_home, limited_time, limited_time_starts_at, limited_time_ends_at, sort_order, pricing_mode, unit_price, unit_min_qty, bundle_qty, bundle_price, wholesale_category_id, wholesale_any_product, allow_add_all_to_cart, promo_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, slug, adminTag || null, description, bannerImageUrl, layoutJson ? JSON.stringify(layoutJson) : null, imageFocusX, imageFocusY, !!isActive, !!showOnHome, !!limitedTime, limitedTimeStartsAt, limitedTimeEndsAt, sortOrder, pricingMode, unitPrice, unitMinQty, bundleQty, bundlePrice, wholesaleCategoryId, !!wholesaleAnyProduct, !!allowAddAllToCart, promoText]
    )

    if (pricingMode === 'combo') {
      await replaceComboTiers(result.insertId, comboTiers ?? [])
    } else if (bundleParts) {
      await replaceBundleParts(result.insertId, bundleParts)
    }

    const [rows] = await pool.query('SELECT * FROM collections WHERE id = ?', [result.insertId])
    const [withProducts] = await attachRelations(rows)
    res.status(201).json(withProducts)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe una colección con este título — agrega una etiqueta para diferenciarla.' })
    }
    next(err)
  }
}

export async function updateCollection(req, res, next) {
  try {
    const { id } = req.params
    const {
      name,
      adminTag,
      description,
      bannerImageUrl,
      isActive,
      showOnHome,
      limitedTime,
      limitedTimeStartsAt,
      limitedTimeEndsAt,
      sortOrder,
      pricingMode,
      unitPrice,
      unitMinQty,
      bundleQty,
      bundlePrice,
      wholesaleCategoryId,
      wholesaleAnyProduct,
      allowAddAllToCart,
      promoText,
      bundleParts,
      comboTiers,
      layoutJson,
      imageFocusX,
      imageFocusY,
    } = req.body

    // Read the old banner before overwriting it, so a replaced/removed one
    // doesn't linger in R2 forever.
    let oldBannerUrl = null
    if (bannerImageUrl !== undefined) {
      const [existing] = await pool.query('SELECT banner_image_url FROM collections WHERE id = ?', [id])
      oldBannerUrl = existing[0]?.banner_image_url ?? null
    }

    const fields = []
    const params = []

    // slug is regenerated whenever EITHER name or adminTag changes (not just
    // name) — whichever one isn't in this request gets fetched so the slug
    // always reflects the final name+tag combination, not a stale half.
    if (name !== undefined || adminTag !== undefined) {
      let finalName = name
      let finalTag = adminTag
      if (finalName === undefined || finalTag === undefined) {
        const [existing] = await pool.query('SELECT name, admin_tag FROM collections WHERE id = ?', [id])
        if (finalName === undefined) finalName = existing[0]?.name
        if (finalTag === undefined) finalTag = existing[0]?.admin_tag
      }
      fields.push('slug = ?')
      params.push(slugify(finalTag ? `${finalName}-${finalTag}` : finalName))
      if (name !== undefined) { fields.push('name = ?'); params.push(name) }
      if (adminTag !== undefined) { fields.push('admin_tag = ?'); params.push(adminTag || null) }
    }
    if (description !== undefined) { fields.push('description = ?'); params.push(description) }
    if (bannerImageUrl !== undefined) { fields.push('banner_image_url = ?'); params.push(bannerImageUrl) }
    if (isActive !== undefined) { fields.push('is_active = ?'); params.push(!!isActive) }
    if (showOnHome !== undefined) { fields.push('show_on_home = ?'); params.push(!!showOnHome) }
    if (limitedTime !== undefined) { fields.push('limited_time = ?'); params.push(!!limitedTime) }
    if (limitedTimeStartsAt !== undefined) { fields.push('limited_time_starts_at = ?'); params.push(limitedTimeStartsAt) }
    if (limitedTimeEndsAt !== undefined) { fields.push('limited_time_ends_at = ?'); params.push(limitedTimeEndsAt) }
    if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(sortOrder) }
    if (pricingMode !== undefined) { fields.push('pricing_mode = ?'); params.push(pricingMode) }
    if (unitPrice !== undefined) { fields.push('unit_price = ?'); params.push(unitPrice) }
    if (unitMinQty !== undefined) { fields.push('unit_min_qty = ?'); params.push(unitMinQty) }
    if (bundleQty !== undefined) { fields.push('bundle_qty = ?'); params.push(bundleQty) }
    if (bundlePrice !== undefined) { fields.push('bundle_price = ?'); params.push(bundlePrice) }
    if (wholesaleCategoryId !== undefined) { fields.push('wholesale_category_id = ?'); params.push(wholesaleCategoryId) }
    if (wholesaleAnyProduct !== undefined) { fields.push('wholesale_any_product = ?'); params.push(!!wholesaleAnyProduct) }
    if (allowAddAllToCart !== undefined) { fields.push('allow_add_all_to_cart = ?'); params.push(!!allowAddAllToCart) }
    if (promoText !== undefined) { fields.push('promo_text = ?'); params.push(promoText) }
    if (layoutJson !== undefined) { fields.push('layout_json = ?'); params.push(layoutJson ? JSON.stringify(layoutJson) : null) }
    if (imageFocusX !== undefined) { fields.push('image_focus_x = ?'); params.push(imageFocusX) }
    if (imageFocusY !== undefined) { fields.push('image_focus_y = ?'); params.push(imageFocusY) }

    if (fields.length > 0) {
      params.push(id)
      const [result] = await pool.query(`UPDATE collections SET ${fields.join(', ')} WHERE id = ?`, params)
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Collection not found' })
      }
    }

    if (pricingMode === 'combo') {
      if (comboTiers !== undefined) await replaceComboTiers(id, comboTiers)
    } else if (bundleParts !== undefined) {
      await replaceBundleParts(id, bundleParts)
    }

    if (oldBannerUrl && oldBannerUrl !== bannerImageUrl) await deleteR2ObjectByUrl(oldBannerUrl)

    const [rows] = await pool.query('SELECT * FROM collections WHERE id = ?', [id])
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Collection not found' })
    }
    const [withProducts] = await attachRelations(rows)
    res.json(withProducts)
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe una colección con este título — agrega una etiqueta para diferenciarla.' })
    }
    next(err)
  }
}

export async function deleteCollection(req, res, next) {
  try {
    const { id } = req.params
    const [existing] = await pool.query('SELECT banner_image_url FROM collections WHERE id = ?', [id])
    const [result] = await pool.query('DELETE FROM collections WHERE id = ?', [id])

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Collection not found' })
    }

    if (existing[0]?.banner_image_url) await deleteR2ObjectByUrl(existing[0].banner_image_url)

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function addCollectionProduct(req, res, next) {
  try {
    const { id } = req.params
    const { productId, productIds, discountPrice = null } = req.body

    const ids = Array.isArray(productIds) ? productIds : productId ? [productId] : []
    if (ids.length === 0) return res.status(400).json({ error: 'productId or productIds is required' })

    const [[{ maxOrder }]] = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM collection_products WHERE collection_id = ?',
      [id]
    )

    const values = ids.map((pid, index) => [id, pid, maxOrder + 1 + index, discountPrice])
    await pool.query(
      `INSERT INTO collection_products (collection_id, product_id, sort_order, discount_price) VALUES ?
       ON DUPLICATE KEY UPDATE discount_price = VALUES(discount_price)`,
      [values]
    )

    const [rows] = await pool.query('SELECT * FROM collections WHERE id = ?', [id])
    const [withProducts] = await attachRelations(rows)
    res.status(201).json(withProducts)
  } catch (err) {
    next(err)
  }
}

export async function reorderCollectionProducts(req, res, next) {
  try {
    const { id } = req.params
    const { orderedProductIds } = req.body

    if (!Array.isArray(orderedProductIds) || orderedProductIds.length === 0) {
      return res.status(400).json({ error: 'orderedProductIds array is required' })
    }

    await Promise.all(
      orderedProductIds.map((productId, index) =>
        pool.query(
          'UPDATE collection_products SET sort_order = ? WHERE collection_id = ? AND product_id = ?',
          [index, id, productId]
        )
      )
    )

    const [rows] = await pool.query('SELECT * FROM collections WHERE id = ?', [id])
    const [withProducts] = await attachRelations(rows)
    res.json(withProducts)
  } catch (err) {
    next(err)
  }
}

export async function updateCollectionProductDiscount(req, res, next) {
  try {
    const { id, productId } = req.params
    const { discountPrice = null } = req.body

    const [result] = await pool.query(
      'UPDATE collection_products SET discount_price = ? WHERE collection_id = ? AND product_id = ?',
      [discountPrice, id, productId]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Not found in this collection' })
    }

    const [rows] = await pool.query('SELECT * FROM collections WHERE id = ?', [id])
    const [withProducts] = await attachRelations(rows)
    res.json(withProducts)
  } catch (err) {
    next(err)
  }
}

export async function removeCollectionProduct(req, res, next) {
  try {
    const { id, productId } = req.params
    await pool.query(
      'DELETE FROM collection_products WHERE collection_id = ? AND product_id = ?',
      [id, productId]
    )

    const [rows] = await pool.query('SELECT * FROM collections WHERE id = ?', [id])
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Collection not found' })
    }
    const [withProducts] = await attachRelations(rows)
    res.json(withProducts)
  } catch (err) {
    next(err)
  }
}
