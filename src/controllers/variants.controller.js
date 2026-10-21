import { pool } from '../config/db.js'

// Last-resort fallback if a blank barcode ever reaches the server (the
// admin UI already auto-suggests one for every new/cleared row) — the
// column is UNIQUE NOT NULL, so this must never collide and never be blank.
function generateFallbackBarcode(productId) {
  return `V${productId}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2)
    .toString(36)
    .toUpperCase()
    .padStart(2, '0')}`
}

export async function addVariant(req, res, next) {
  try {
    const { id: productId } = req.params
    const { size, colorName, colorHex = '#000000', barcode, stock = 0 } = req.body

    if (!size || !colorName) {
      return res.status(400).json({ error: 'size and colorName are required' })
    }
    const finalBarcode = barcode?.trim() || generateFallbackBarcode(productId)

    const [[{ nextOrder }]] = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM product_variants WHERE product_id = ?',
      [productId]
    )

    const [result] = await pool.query(
      `INSERT INTO product_variants (product_id, size, color_name, color_hex, barcode, stock, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [productId, size, colorName, colorHex, finalBarcode, stock, nextOrder]
    )

    const [rows] = await pool.query('SELECT * FROM product_variants WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function updateVariant(req, res, next) {
  try {
    const { variantId } = req.params
    const { size, colorName, colorHex, barcode, stock, sortOrder } = req.body

    const fields = []
    const params = []

    if (size !== undefined) { fields.push('size = ?'); params.push(size) }
    if (colorName !== undefined) { fields.push('color_name = ?'); params.push(colorName) }
    if (colorHex !== undefined) { fields.push('color_hex = ?'); params.push(colorHex) }
    if (barcode !== undefined) {
      fields.push('barcode = ?')
      params.push(barcode.trim() || generateFallbackBarcode(req.params.variantId))
    }
    if (stock !== undefined) { fields.push('stock = ?'); params.push(stock) }
    if (sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(sortOrder) }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    params.push(variantId)
    const [result] = await pool.query(
      `UPDATE product_variants SET ${fields.join(', ')} WHERE id = ?`,
      params
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Variant not found' })
    }

    const [rows] = await pool.query('SELECT * FROM product_variants WHERE id = ?', [variantId])
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function deleteVariant(req, res, next) {
  try {
    const { variantId } = req.params
    const [result] = await pool.query('DELETE FROM product_variants WHERE id = ?', [variantId])

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Variant not found' })
    }

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function getVariantByBarcode(req, res, next) {
  try {
    const { barcode } = req.params

    const [rows] = await pool.query(
      `SELECT v.*, p.name AS product_name, p.slug AS product_slug, p.main_image_url
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.barcode = ?
       LIMIT 1`,
      [barcode]
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No variant found for this barcode' })
    }

    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function adjustStockByBarcode(req, res, next) {
  try {
    const { barcode } = req.params
    const { delta, stock } = req.body

    if (delta === undefined && stock === undefined) {
      return res.status(400).json({ error: 'Provide either delta or stock' })
    }

    const [existingRows] = await pool.query(
      'SELECT * FROM product_variants WHERE barcode = ? LIMIT 1',
      [barcode]
    )

    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'No variant found for this barcode' })
    }

    const previousStock = existingRows[0].stock
    const appliedDelta = stock !== undefined ? stock - previousStock : delta
    const nextStock = previousStock + appliedDelta

    if (nextStock < 0) {
      return res.status(400).json({ error: 'Stock cannot go below zero' })
    }

    await pool.query('UPDATE product_variants SET stock = ? WHERE barcode = ?', [nextStock, barcode])

    if (appliedDelta !== 0) {
      await pool.query(
        'INSERT INTO stock_movements (variant_id, delta, resulting_stock, admin_email) VALUES (?, ?, ?, ?)',
        [existingRows[0].id, appliedDelta, nextStock, req.admin?.email ?? null]
      )
    }

    const [rows] = await pool.query('SELECT * FROM product_variants WHERE barcode = ?', [barcode])
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

/** Restocks specifically (not every stock_movements row) — a positive delta
 * with no order_id attached is exactly the signature `adjustStockByBarcode`
 * (the POS "Reabastecer" flow) writes; every other source of a movement
 * (confirming a sale, cancelling one, a return/exchange) always sets
 * order_id, so this pairing cleanly isolates manual restocks with no extra
 * "reason" column needed. */
export async function getRestockHistory(req, res, next) {
  try {
    const { from, to, productId, adminEmail, q } = req.query
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const offset = Math.max(Number(req.query.offset) || 0, 0)

    const where = ['m.delta > 0', 'm.order_id IS NULL']
    const params = []
    if (from) { where.push('m.created_at >= ?'); params.push(`${from} 00:00:00`) }
    if (to) { where.push('m.created_at <= ?'); params.push(`${to} 23:59:59`) }
    if (productId) { where.push('p.id = ?'); params.push(productId) }
    if (adminEmail) { where.push('m.admin_email = ?'); params.push(adminEmail) }
    if (q) {
      where.push('(p.name LIKE ? OR v.barcode LIKE ?)')
      params.push(`%${q}%`, `%${q}%`)
    }
    const whereSql = `WHERE ${where.join(' AND ')}`

    const [rows] = await pool.query(
      `SELECT m.*, v.size, v.color_name, v.barcode, p.id AS product_id, p.name AS product_name, p.main_image_url
       FROM stock_movements m
       JOIN product_variants v ON v.id = m.variant_id
       JOIN products p ON p.id = v.product_id
       ${whereSql}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM stock_movements m
       JOIN product_variants v ON v.id = m.variant_id
       JOIN products p ON p.id = v.product_id
       ${whereSql}`,
      params
    )

    res.json({ rows, total })
  } catch (err) {
    next(err)
  }
}
