import { pool } from '../config/db.js'

/** Mirrors frontend/src/context/PackageBuilderContext.tsx's own
 * collectionMatchesProduct() — whether `productId` counts toward
 * `collectionId` at all (explicitly curated, wholesale's wildcard
 * category, or matching one of its category-wide bundle parts). Used only
 * to decide an exchange's pricing rule (see createReturn): swapping for
 * another product that still qualifies for the same package keeps the
 * price the customer already paid; swapping for one that doesn't breaks
 * the package and falls back to today's regular price. */
async function productQualifiesForCollection(collectionId, productId) {
  const [[collection]] = await pool.query(
    'SELECT pricing_mode, wholesale_any_product, wholesale_category_id FROM collections WHERE id = ?',
    [collectionId]
  )
  if (!collection) return false

  const [[curatedRow]] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM collection_products WHERE collection_id = ? AND product_id = ?',
    [collectionId, productId]
  )
  if (curatedRow.cnt > 0) return true

  const [[product]] = await pool.query('SELECT category_id FROM products WHERE id = ?', [productId])
  if (!product) return false

  if (collection.pricing_mode === 'wholesale' && collection.wholesale_any_product) {
    return collection.wholesale_category_id == null || collection.wholesale_category_id === product.category_id
  }

  if (['combo', 'unit', 'bundle'].includes(collection.pricing_mode)) {
    const [parts] = await pool.query(
      'SELECT category_id, is_specific FROM collection_bundle_parts WHERE collection_id = ?',
      [collectionId]
    )
    // A specific-only part only ever matches curated products, already
    // ruled out above — only a category-wide (non-specific) part can still
    // match here.
    return parts.some((part) => !part.is_specific && part.category_id === product.category_id)
  }

  return false
}

export async function listReturns(req, res, next) {
  try {
    const { from, to, orderId } = req.query
    const where = []
    const params = []
    if (from) { where.push('r.created_at >= ?'); params.push(`${from} 00:00:00`) }
    if (to) { where.push('r.created_at <= ?'); params.push(`${to} 23:59:59`) }
    if (orderId) { where.push('r.order_id = ?'); params.push(orderId) }

    const [rows] = await pool.query(
      `SELECT r.*, oi.product_name, oi.size, oi.color_name, oi.main_image_url, oi.unit_price,
              o.status AS order_status, c.name AS customer_name
       FROM returns r
       JOIN order_items oi ON oi.id = r.order_item_id
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.created_at DESC`,
      params
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

/** How many units of this order_item have already been returned/exchanged —
 * caps how many more can be, so the same line can't be returned twice over. */
async function alreadyReturnedQty(orderItemId) {
  const [[{ total }]] = await pool.query(
    'SELECT COALESCE(SUM(quantity), 0) AS total FROM returns WHERE order_item_id = ?',
    [orderItemId]
  )
  return total
}

export async function createReturn(req, res, next) {
  try {
    const { orderId, orderItemId, type, quantity, reason = null, newProductId = null, newVariantId = null } = req.body

    if (!orderId || !orderItemId || !type || !quantity || quantity < 1) {
      return res.status(400).json({ error: 'orderId, orderItemId, type y quantity son requeridos' })
    }
    if (type !== 'return' && type !== 'exchange') {
      return res.status(400).json({ error: "type debe ser 'return' o 'exchange'" })
    }
    if (type === 'exchange' && (!newProductId || !newVariantId)) {
      return res.status(400).json({ error: 'Un cambio necesita el producto y variante de reemplazo' })
    }

    const [orderRows] = await pool.query('SELECT * FROM orders WHERE id = ?', [orderId])
    if (orderRows.length === 0) return res.status(404).json({ error: 'Order not found' })
    if (orderRows[0].status !== 'confirmed') {
      return res.status(400).json({ error: 'Solo se pueden registrar devoluciones o cambios de una venta confirmada' })
    }

    const [itemRows] = await pool.query('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [orderItemId, orderId])
    if (itemRows.length === 0) return res.status(404).json({ error: 'Order item not found' })
    const item = itemRows[0]

    const already = await alreadyReturnedQty(orderItemId)
    const remaining = item.quantity - already
    if (quantity > remaining) {
      return res.status(400).json({ error: `Solo quedan ${remaining} unidad(es) de esta línea sin devolver/cambiar` })
    }

    let newProductName = null
    let newSize = null
    let newColorName = null
    let newMainImageUrl = null
    // refunded_amount is what the original line was actually worth — set
    // for both types, since the old item leaves the sale either way.
    // charged_amount (the replacement's value) only ever applies to an
    // exchange; their difference is the net money the customer owes/is owed.
    const refundedAmount = Math.max(0, Number(item.unit_price) - Number(item.discount_amount)) * quantity
    let chargedAmount = 0

    if (type === 'exchange') {
      const [variantRows] = await pool.query(
        `SELECT v.*, p.name AS product_name, p.main_image_url, p.price
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = ? AND v.product_id = ?`,
        [newVariantId, newProductId]
      )
      if (variantRows.length === 0) return res.status(404).json({ error: 'Producto/variante de reemplazo no encontrado' })
      const newVariant = variantRows[0]
      if (newVariant.stock < quantity) {
        return res.status(400).json({
          error: `Stock insuficiente del producto de reemplazo — pide ${quantity}, hay ${newVariant.stock}`,
        })
      }
      newProductName = newVariant.product_name
      newSize = newVariant.size
      newColorName = newVariant.color_name
      newMainImageUrl = newVariant.main_image_url
      chargedAmount = Number(newVariant.price) * quantity

      // The original line came from a package deal (collection_id set) —
      // swapping for another product that still qualifies for that same
      // package (same model/talla change, still within it) keeps the exact
      // amount already paid, no matter what that product's own regular
      // price is. Swapping for something that breaks the package (outside
      // its categories/curation) falls back to charging today's regular
      // price for the replacement instead.
      if (item.collection_id && (await productQualifiesForCollection(item.collection_id, newProductId))) {
        chargedAmount = refundedAmount
      }

      // Deduct stock for the replacement.
      const nextStock = newVariant.stock - quantity
      await pool.query('UPDATE product_variants SET stock = ? WHERE id = ?', [nextStock, newVariantId])
      await pool.query(
        'INSERT INTO stock_movements (variant_id, delta, resulting_stock, admin_email, order_id) VALUES (?, ?, ?, ?, ?)',
        [newVariantId, -quantity, nextStock, req.admin?.email ?? null, orderId]
      )
    }

    // Restore stock for the original line, whether it's a plain return or
    // the "old side" of an exchange.
    if (item.variant_id != null) {
      const [[variant]] = await pool.query('SELECT stock FROM product_variants WHERE id = ?', [item.variant_id])
      if (variant) {
        const nextStock = variant.stock + quantity
        await pool.query('UPDATE product_variants SET stock = ? WHERE id = ?', [nextStock, item.variant_id])
        await pool.query(
          'INSERT INTO stock_movements (variant_id, delta, resulting_stock, admin_email, order_id) VALUES (?, ?, ?, ?, ?)',
          [item.variant_id, quantity, nextStock, req.admin?.email ?? null, orderId]
        )
      }
    }

    const [result] = await pool.query(
      `INSERT INTO returns (order_id, order_item_id, type, quantity, reason, new_product_id, new_variant_id, new_product_name, new_size, new_color_name, new_main_image_url, refunded_amount, charged_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        orderItemId,
        type,
        quantity,
        reason,
        newProductId,
        newVariantId,
        newProductName,
        newSize,
        newColorName,
        newMainImageUrl,
        refundedAmount,
        chargedAmount,
      ]
    )

    const [rows] = await pool.query(
      `SELECT r.*, oi.product_name, oi.size, oi.color_name, oi.main_image_url, oi.unit_price,
              o.status AS order_status, c.name AS customer_name
       FROM returns r
       JOIN order_items oi ON oi.id = r.order_item_id
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE r.id = ?`,
      [result.insertId]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
}

/** Toggles whether the money/replacement side of a return/exchange has
 * actually been handed over in person — the record itself is created the
 * moment the return happens (adjusting stock right away), independently of
 * when the cash/replacement physically changes hands. `settled` true sets
 * settled_at to now; false clears it back to unconfirmed. */
export async function updateReturn(req, res, next) {
  try {
    const { id } = req.params
    const { settled } = req.body
    const [result] = await pool.query(
      `UPDATE returns SET settled_at = ${settled ? 'NOW()' : 'NULL'} WHERE id = ?`,
      [id]
    )
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Return not found' })

    const [rows] = await pool.query(
      `SELECT r.*, oi.product_name, oi.size, oi.color_name, oi.main_image_url, oi.unit_price,
              o.status AS order_status, c.name AS customer_name
       FROM returns r
       JOIN order_items oi ON oi.id = r.order_item_id
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE r.id = ?`,
      [id]
    )
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}
