import { pool } from '../config/db.js'

export async function listTiers(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT t.*, c.name AS category_name FROM wholesale_tiers t
       LEFT JOIN categories c ON c.id = t.category_id
       ORDER BY t.category_id IS NULL, c.name ASC, t.min_qty ASC`
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

export async function createTier(req, res, next) {
  try {
    const { categoryId = null, minQty, maxQty = null, pricePerUnit, sortOrder = 0, isFeatured = false } = req.body

    if (minQty === undefined || pricePerUnit === undefined) {
      return res.status(400).json({ error: 'minQty and pricePerUnit are required' })
    }

    // At most one "most chosen" tier per category group — marking a new one
    // unmarks whichever else was flagged, so the storefront never shows two
    // "Más elegido" ribbons in the same tier list. `<=>` (MySQL's null-safe
    // equals) is needed since categoryId can be NULL (the shared fallback
    // group).
    if (isFeatured) {
      await pool.query('UPDATE wholesale_tiers SET is_featured = 0 WHERE category_id <=> ?', [categoryId])
    }

    const [result] = await pool.query(
      'INSERT INTO wholesale_tiers (category_id, min_qty, max_qty, price_per_unit, sort_order, is_featured) VALUES (?, ?, ?, ?, ?, ?)',
      [categoryId, minQty, maxQty, pricePerUnit, sortOrder, !!isFeatured]
    )

    const [rows] = await pool.query(
      `SELECT t.*, c.name AS category_name FROM wholesale_tiers t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id = ?`,
      [result.insertId]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function updateTier(req, res, next) {
  try {
    const { id } = req.params
    const { categoryId, minQty, maxQty, pricePerUnit, sortOrder, isFeatured } = req.body

    const fields = []
    const params = []

    if (categoryId !== undefined) { fields.push('category_id = ?'); params.push(categoryId) }
    if (minQty !== undefined) { fields.push('min_qty = ?'); params.push(minQty) }
    if (maxQty !== undefined) { fields.push('max_qty = ?'); params.push(maxQty) }
    if (pricePerUnit !== undefined) { fields.push('price_per_unit = ?'); params.push(pricePerUnit) }
    if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(sortOrder) }
    if (isFeatured !== undefined) {
      fields.push('is_featured = ?')
      params.push(!!isFeatured)
      if (isFeatured) {
        // Scope the exclusivity to whichever category this tier ends up in
        // (the one being set in this same request, or its current one).
        let scopeCategoryId = categoryId
        if (scopeCategoryId === undefined) {
          const [existing] = await pool.query('SELECT category_id FROM wholesale_tiers WHERE id = ?', [id])
          scopeCategoryId = existing[0]?.category_id ?? null
        }
        await pool.query('UPDATE wholesale_tiers SET is_featured = 0 WHERE category_id <=> ? AND id != ?', [scopeCategoryId, id])
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    params.push(id)
    const [result] = await pool.query(`UPDATE wholesale_tiers SET ${fields.join(', ')} WHERE id = ?`, params)

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Tier not found' })
    }

    const [rows] = await pool.query(
      `SELECT t.*, c.name AS category_name FROM wholesale_tiers t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id = ?`,
      [id]
    )
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function deleteTier(req, res, next) {
  try {
    const { id } = req.params
    const [result] = await pool.query('DELETE FROM wholesale_tiers WHERE id = ?', [id])

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Tier not found' })
    }

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}
