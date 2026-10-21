import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { pool } from '../config/db.js'
import { env } from '../config/env.js'
import { createNotification } from './notifications.controller.js'

/** Orders can be created by a guest or a logged-in customer — unlike
 * requireCustomer, a missing/invalid token here just means "guest", not a
 * rejected request. */
function tryGetCustomerId(req) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return null
  try {
    const payload = jwt.verify(token, env.jwt.secret)
    return payload.type === 'customer' ? payload.sub : null
  } catch {
    return null
  }
}

async function attachItems(orders) {
  if (orders.length === 0) return []
  const orderIds = orders.map((o) => o.id)
  const [items] = await pool.query(
    'SELECT * FROM order_items WHERE order_id IN (?) ORDER BY id ASC',
    [orderIds]
  )
  return orders.map((order) => ({ ...order, items: items.filter((i) => i.order_id === order.id) }))
}

/** (unit_price - discount_amount) * quantity, floored at 0 per unit — never
 * counts a gift line, since it was given away, not sold. */
function itemRevenue(item) {
  if (item.is_gift) return 0
  const net = Math.max(0, Number(item.unit_price) - Number(item.discount_amount))
  return net * item.quantity
}

function orderRevenue(order) {
  const gross = order.items.reduce((sum, item) => sum + itemRevenue(item), 0)
  return Math.max(0, gross - Number(order.discount_amount))
}

export async function createOrder(req, res, next) {
  try {
    const { items, notes = null } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items is required' })
    }

    const customerId = tryGetCustomerId(req)

    // A logged-in "cliente frecuente" gets their standing per-unit discount
    // applied automatically to every line, labeled so the admin can see WHY
    // (as opposed to a discount someone typed in manually while editing).
    let loyaltyDiscount = 0
    if (customerId) {
      const [customerRows] = await pool.query('SELECT discount_amount FROM customers WHERE id = ?', [customerId])
      loyaltyDiscount = Number(customerRows[0]?.discount_amount ?? 0)
    }

    const [orderResult] = await pool.query(
      'INSERT INTO orders (customer_id, notes) VALUES (?, ?)',
      [customerId, notes]
    )
    const orderId = orderResult.insertId

    for (const item of items) {
      let variantId = null
      if (item.productId && item.size && item.colorName) {
        const [variantRows] = await pool.query(
          'SELECT id FROM product_variants WHERE product_id = ? AND size = ? AND color_name = ? LIMIT 1',
          [item.productId, item.size, item.colorName]
        )
        variantId = variantRows[0]?.id ?? null
      }
      // A gift line (a combo/bundle "de regalo" slot, already priced at $0)
      // never gets the loyalty discount stacked on top of it too — same rule
      // createPosSale already applies for a POS sale's gift lines.
      const lineDiscount = item.isGift ? 0 : loyaltyDiscount
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, product_name, size, color_name, main_image_url, unit_price, quantity, collection_id, collection_name, tier_key, discount_amount, discount_reason, is_preorder, is_gift)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.productId ?? null,
          variantId,
          item.name,
          item.size ?? null,
          item.colorName ?? null,
          item.image ?? null,
          item.unitPrice,
          item.quantity,
          item.collectionId ?? null,
          item.collectionName ?? null,
          item.tierKey ?? null,
          lineDiscount,
          lineDiscount > 0 ? 'Cliente frecuente' : null,
          !!item.isPreorder,
          !!item.isGift,
        ]
      )
    }

    const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
    await createNotification({
      type: 'whatsapp_order',
      title: 'Nuevo pedido de WhatsApp',
      body: `${itemCount} artículo(s) en el pedido #${orderId}.`,
    }).catch((err) => console.error('[orders] notification failed', err))

    res.status(201).json({ id: orderId })
  } catch (err) {
    next(err)
  }
}

/** In-person sale rung up from the admin's Escáner/Punto de venta screen —
 * unlike createOrder (a pending WhatsApp request), this lands as 'confirmed'
 * immediately and deducts stock right away, since the item is already
 * physically handed over. */
export async function createPosSale(req, res, next) {
  try {
    const { items, notes = null, discountAmount = 0, paymentMethod = null, customerId = null } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items is required' })
    }

    // Same "cliente frecuente" standing discount a WhatsApp order already
    // gets (see createOrder's loyaltyDiscount) — applied per line, on top of
    // whatever manual per-line discount the cashier already typed in.
    let loyaltyDiscount = 0
    if (customerId) {
      const [customerRows] = await pool.query('SELECT discount_amount FROM customers WHERE id = ?', [customerId])
      loyaltyDiscount = Number(customerRows[0]?.discount_amount ?? 0)
    }

    const resolved = []
    for (const item of items) {
      let variantId = item.variantId ?? null
      if (!variantId && item.productId && item.size && item.colorName) {
        const [variantRows] = await pool.query(
          'SELECT id FROM product_variants WHERE product_id = ? AND size = ? AND color_name = ? LIMIT 1',
          [item.productId, item.size, item.colorName]
        )
        variantId = variantRows[0]?.id ?? null
      }
      resolved.push({ ...item, variantId })
    }

    // Validate stock BEFORE inserting anything, so a sale either fully goes
    // through or leaves inventory/records untouched — same guarantee as
    // confirming a pending order.
    const withVariant = resolved.filter((i) => i.variantId != null)
    const neededByVariant = new Map()
    for (const item of withVariant) {
      neededByVariant.set(item.variantId, (neededByVariant.get(item.variantId) ?? 0) + item.quantity)
    }
    let stockById = new Map()
    if (neededByVariant.size > 0) {
      const [variants] = await pool.query('SELECT id, stock FROM product_variants WHERE id IN (?)', [
        [...neededByVariant.keys()],
      ])
      stockById = new Map(variants.map((v) => [v.id, v.stock]))
      const insufficient = []
      for (const [variantId, needed] of neededByVariant) {
        const available = stockById.get(variantId) ?? 0
        if (needed > available) {
          const item = withVariant.find((i) => i.variantId === variantId)
          insufficient.push({ productName: item.name, size: item.size, colorName: item.colorName, needed, available })
        }
      }
      if (insufficient.length > 0) {
        const detail = insufficient
          .map((i) => `${i.productName} (${i.size}, ${i.colorName}): pide ${i.needed}, hay ${i.available}`)
          .join('; ')
        return res.status(400).json({ error: `Stock insuficiente — ${detail}`, insufficient })
      }
    }

    const [orderResult] = await pool.query(
      "INSERT INTO orders (customer_id, notes, status, source, discount_amount, payment_method, confirmed_at) VALUES (?, ?, 'confirmed', 'pos', ?, ?, NOW())",
      [customerId, notes, discountAmount, paymentMethod]
    )
    const orderId = orderResult.insertId

    for (const item of resolved) {
      const lineDiscount = item.isGift ? (item.discountAmount ?? 0) : (item.discountAmount ?? 0) + loyaltyDiscount
      await pool.query(
        `INSERT INTO order_items (order_id, product_id, variant_id, product_name, size, color_name, main_image_url, unit_price, quantity, collection_id, collection_name, discount_amount, discount_reason, is_gift)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          item.productId ?? null,
          item.variantId,
          item.name,
          item.size ?? null,
          item.colorName ?? null,
          item.image ?? null,
          item.unitPrice,
          item.quantity,
          item.collectionId ?? null,
          item.collectionName ?? null,
          lineDiscount,
          loyaltyDiscount > 0 && !item.isGift ? 'Cliente frecuente' : null,
          !!item.isGift,
        ]
      )
    }

    for (const [variantId, needed] of neededByVariant) {
      const nextStock = stockById.get(variantId) - needed
      await pool.query('UPDATE product_variants SET stock = ? WHERE id = ?', [nextStock, variantId])
      await pool.query(
        'INSERT INTO stock_movements (variant_id, delta, resulting_stock, admin_email, order_id) VALUES (?, ?, ?, ?, ?)',
        [variantId, -needed, nextStock, req.admin?.email ?? null, orderId]
      )
    }

    const [rows] = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [orderId]
    )
    const [order] = await attachItems(rows)
    res.status(201).json(order)
  } catch (err) {
    next(err)
  }
}

export async function listOrders(req, res, next) {
  try {
    const { from, to, status, source, confirmedFrom, confirmedTo } = req.query

    // source (whatsapp vs pos) scopes both the visible list and the summary
    // below, same as the date range — it's which sales channel to look at,
    // not a workflow state like status.
    const where = []
    const params = []
    // confirmedFrom/confirmedTo (exact datetimes, not just dates) reproduce
    // a specific cash cut's own membership rule exactly — see
    // summarizeConfirmedSales in cashCuts.controller.js, which this must
    // match bound-for-bound so the drill-down from a cut always adds up to
    // the same total the cut itself shows. Takes over from the day-level
    // from/to entirely (a cut's period can start/end mid-day) — a pending
    // or cancelled order has no confirmed_at, so it's naturally excluded,
    // which is correct: a cut only ever concerns confirmed sales.
    if (confirmedFrom || confirmedTo) {
      if (confirmedFrom) { where.push('o.confirmed_at > ?'); params.push(confirmedFrom) }
      if (confirmedTo) { where.push('o.confirmed_at <= ?'); params.push(confirmedTo) }
    } else {
      if (from) { where.push('o.created_at >= ?'); params.push(`${from} 00:00:00`) }
      if (to) { where.push('o.created_at <= ?'); params.push(`${to} 23:59:59`) }
    }
    if (source) { where.push('o.source = ?'); params.push(source) }
    const listWhere = [...where]
    const listParams = [...params]
    if (status) { listWhere.push('o.status = ?'); listParams.push(status) }

    const [orderRows] = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       ${listWhere.length > 0 ? `WHERE ${listWhere.join(' AND ')}` : ''}
       ORDER BY o.created_at DESC`,
      listParams
    )
    const orders = await attachItems(orderRows)

    // Order counts by status, scoped by date+source only (not the Estado
    // filter) — so the stat badges always show the full breakdown no matter
    // which single status the visible list below is currently filtered to.
    const [statusRows] = await pool.query(
      `SELECT status, COUNT(*) AS cnt FROM orders o
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY status`,
      params
    )
    const statusCounts = { pending: 0, confirmed: 0, cancelled: 0 }
    for (const r of statusRows) statusCounts[r.status] = r.cnt
    const totalCount = statusCounts.pending + statusCounts.confirmed + statusCounts.cancelled

    // The summary always reflects confirmed sales in the date range,
    // regardless of the status filter applied to the visible list above —
    // pending/cancelled rows were never real sales.
    const [confirmedRows] = await pool.query(
      `SELECT o.* FROM orders o
       WHERE o.status = 'confirmed' ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}`,
      params
    )
    const confirmedOrders = await attachItems(confirmedRows)

    // A later return/exchange nets out of "Total vendido" even though the
    // order_items themselves never change — same rule as netOrderTotal() in
    // admin/src/pages/Orders.tsx (charged_amount - refunded_amount per
    // return), just summed across the whole range instead of one order at a
    // time. Attributed to whichever period the ORIGINAL sale falls in,
    // regardless of when the return itself was recorded.
    const confirmedOrderIds = confirmedOrders.map((o) => o.id)
    const returnAdjustmentByOrder = new Map()
    if (confirmedOrderIds.length > 0) {
      const [returnRows] = await pool.query(
        'SELECT order_id, SUM(charged_amount - refunded_amount) AS net_diff FROM returns WHERE order_id IN (?) GROUP BY order_id',
        [confirmedOrderIds]
      )
      for (const r of returnRows) returnAdjustmentByOrder.set(r.order_id, Number(r.net_diff))
    }
    const revenue = confirmedOrders.reduce(
      (sum, o) => sum + Math.max(0, orderRevenue(o) + (returnAdjustmentByOrder.get(o.id) ?? 0)),
      0
    )
    const itemsSold = confirmedOrders.reduce(
      (sum, o) => sum + o.items.filter((i) => !i.is_gift).reduce((s, i) => s + i.quantity, 0),
      0
    )
    const giftsCount = confirmedOrders.reduce(
      (sum, o) => sum + o.items.filter((i) => i.is_gift).reduce((s, i) => s + i.quantity, 0),
      0
    )

    // Category breakdown for the same confirmed/date-range scope — joins
    // through the item's own product_id (a live lookup, not a snapshot), so
    // a product later moved to a different category or deleted won't match
    // its category at sale time; those fall under "Sin categoría".
    const [categoryRows] = await pool.query(
      `SELECT c.name AS category_name, SUM(oi.quantity) AS items_sold,
              SUM(CASE WHEN oi.is_gift THEN oi.quantity ELSE 0 END) AS gifts
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN products p ON p.id = oi.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE o.status = 'confirmed' ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
       GROUP BY c.id, c.name
       ORDER BY items_sold DESC`,
      params
    )
    const byCategory = categoryRows.map((r) => ({
      categoryName: r.category_name ?? 'Sin categoría',
      itemsSold: Number(r.items_sold),
      gifts: Number(r.gifts),
    }))

    // Per-product breakdown, grouped by the item's own snapshot name (so a
    // later renamed/deleted product still shows up under the name it
    // actually sold under) — drives "más vendidos" and the gifts list. Two
    // different catalog products can share the same display name (e.g. the
    // same shirt name reused across colorways as separate entries), so each
    // name group also carries its underlying product_id/color/size rows —
    // the admin can drill into "which ones" from there.
    const [productRows] = await pool.query(
      `SELECT oi.product_name, oi.product_id, oi.color_name, oi.size,
              MAX(oi.main_image_url) AS main_image_url, MAX(pv.color_hex) AS color_hex,
              SUM(CASE WHEN oi.is_gift THEN 0 ELSE oi.quantity END) AS sold_qty,
              SUM(CASE WHEN oi.is_gift THEN oi.quantity ELSE 0 END) AS gift_qty
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN product_variants pv ON pv.id = oi.variant_id
       WHERE o.status = 'confirmed' ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
       GROUP BY oi.product_name, oi.product_id, oi.color_name, oi.size
       ORDER BY sold_qty DESC`,
      params
    )
    const byProductMap = new Map()
    for (const r of productRows) {
      if (!byProductMap.has(r.product_name)) {
        byProductMap.set(r.product_name, { productName: r.product_name, quantity: 0, gifts: 0, variants: [] })
      }
      const group = byProductMap.get(r.product_name)
      group.quantity += Number(r.sold_qty)
      group.gifts += Number(r.gift_qty)
      group.variants.push({
        productId: r.product_id,
        colorName: r.color_name,
        colorHex: r.color_hex,
        size: r.size,
        mainImageUrl: r.main_image_url,
        quantity: Number(r.sold_qty),
        gifts: Number(r.gift_qty),
      })
    }
    const byProduct = Array.from(byProductMap.values()).sort((a, b) => b.quantity - a.quantity)

    // Package/collection breakdown — grouped by the snapshot collection_id
    // (collection_name just for display), so a later renamed/deleted
    // collection still shows up under the name it actually sold under.
    // Plain retail lines (collection_id NULL) don't belong to any package.
    const [packageRows] = await pool.query(
      `SELECT oi.collection_id, oi.collection_name,
              SUM(CASE WHEN oi.is_gift THEN 0 ELSE oi.quantity END) AS sold_qty
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'confirmed' AND oi.collection_id IS NOT NULL
             ${where.length > 0 ? `AND ${where.join(' AND ')}` : ''}
       GROUP BY oi.collection_id, oi.collection_name
       ORDER BY sold_qty DESC`,
      params
    )
    const byPackage = packageRows.map((r) => ({
      collectionId: r.collection_id,
      collectionName: r.collection_name,
      quantity: Number(r.sold_qty),
    }))

    res.json({
      orders,
      summary: {
        confirmedCount: confirmedOrders.length,
        pendingCount: statusCounts.pending,
        cancelledCount: statusCounts.cancelled,
        totalCount,
        revenue,
        itemsSold,
        giftsCount,
        byCategory,
        byProduct,
        byPackage,
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function getOrder(req, res, next) {
  try {
    const { id } = req.params
    const [rows] = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' })
    const [order] = await attachItems(rows)
    res.json(order)
  } catch (err) {
    next(err)
  }
}

export async function updateOrder(req, res, next) {
  try {
    const { id } = req.params
    const { notes, discountAmount, items } = req.body

    const [existing] = await pool.query('SELECT * FROM orders WHERE id = ?', [id])
    if (existing.length === 0) return res.status(404).json({ error: 'Order not found' })
    if (existing[0].status !== 'pending') {
      return res.status(400).json({ error: 'Solo se puede editar una venta pendiente' })
    }

    const fields = []
    const params = []
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes) }
    if (discountAmount !== undefined) { fields.push('discount_amount = ?'); params.push(discountAmount) }
    if (fields.length > 0) {
      params.push(id)
      await pool.query(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, params)
    }

    if (Array.isArray(items)) {
      await pool.query('DELETE FROM order_items WHERE order_id = ?', [id])
      for (const item of items) {
        await pool.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, size, color_name, main_image_url, unit_price, quantity, collection_id, collection_name, discount_amount, discount_reason, is_gift, is_preorder)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            item.productId ?? null,
            item.variantId ?? null,
            item.productName,
            item.size ?? null,
            item.colorName ?? null,
            item.mainImageUrl ?? null,
            item.unitPrice,
            item.quantity,
            item.collectionId ?? null,
            item.collectionName ?? null,
            item.discountAmount ?? 0,
            item.discountReason ?? null,
            !!item.isGift,
            !!item.isPreorder,
          ]
        )
      }
    }

    const [rows] = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [id]
    )
    const [order] = await attachItems(rows)
    res.json(order)
  } catch (err) {
    next(err)
  }
}

const VALID_PAYMENT_METHODS = ['cash', 'debit', 'credit', 'transfer']

export async function confirmOrder(req, res, next) {
  try {
    const { id } = req.params
    const { paymentMethod } = req.body
    if (paymentMethod !== undefined && paymentMethod !== null && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(400).json({ error: 'Forma de pago inválida' })
    }
    const [orderRows] = await pool.query('SELECT * FROM orders WHERE id = ?', [id])
    if (orderRows.length === 0) return res.status(404).json({ error: 'Order not found' })
    if (orderRows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Esta venta ya fue confirmada o cancelada' })
    }

    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [id])
    const withVariant = items.filter((i) => i.variant_id != null)

    if (withVariant.length > 0) {
      const [variants] = await pool.query(
        'SELECT id, stock FROM product_variants WHERE id IN (?)',
        [withVariant.map((i) => i.variant_id)]
      )
      const stockById = new Map(variants.map((v) => [v.id, v.stock]))

      // Validate every line has enough stock BEFORE touching anything, so a
      // confirm either fully succeeds or leaves inventory untouched.
      const insufficient = []
      const neededByVariant = new Map()
      for (const item of withVariant) {
        const needed = (neededByVariant.get(item.variant_id) ?? 0) + item.quantity
        neededByVariant.set(item.variant_id, needed)
      }
      for (const [variantId, needed] of neededByVariant) {
        const available = stockById.get(variantId) ?? 0
        if (needed > available) {
          const item = withVariant.find((i) => i.variant_id === variantId)
          insufficient.push({ productName: item.product_name, size: item.size, colorName: item.color_name, needed, available })
        }
      }
      if (insufficient.length > 0) {
        const detail = insufficient
          .map((i) => `${i.productName} (${i.size}, ${i.colorName}): pide ${i.needed}, hay ${i.available}`)
          .join('; ')
        return res.status(400).json({ error: `Stock insuficiente — ${detail}`, insufficient })
      }

      for (const [variantId, needed] of neededByVariant) {
        const nextStock = stockById.get(variantId) - needed
        await pool.query('UPDATE product_variants SET stock = ? WHERE id = ?', [nextStock, variantId])
        await pool.query(
          'INSERT INTO stock_movements (variant_id, delta, resulting_stock, admin_email, order_id) VALUES (?, ?, ?, ?, ?)',
          [variantId, -needed, nextStock, req.admin?.email ?? null, id]
        )
      }
    }

    if (paymentMethod) {
      await pool.query("UPDATE orders SET status = 'confirmed', confirmed_at = NOW(), payment_method = ? WHERE id = ?", [
        paymentMethod,
        id,
      ])
    } else {
      await pool.query("UPDATE orders SET status = 'confirmed', confirmed_at = NOW() WHERE id = ?", [id])
    }

    const [rows] = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [id]
    )
    const [order] = await attachItems(rows)
    res.json(order)
  } catch (err) {
    next(err)
  }
}

/** Independent of order status (unlike updateOrder, which only allows
 * editing a pending sale) — the customer's number is typically only learned
 * after seeing the incoming WhatsApp chat, which can be well after the sale
 * is already confirmed. */
export async function updateOrderPhone(req, res, next) {
  try {
    const { id } = req.params
    const { phone } = req.body
    const [result] = await pool.query('UPDATE orders SET guest_phone = ? WHERE id = ?', [phone || null, id])
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Order not found' })

    const [rows] = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [id]
    )
    const [order] = await attachItems(rows)
    res.json(order)
  } catch (err) {
    next(err)
  }
}

/** A packaging checklist flag, not a workflow state — can be ticked (or
 * unticked) at any order status, independent of updateOrder's pending-only
 * gate. */
export async function updateOrderPackaging(req, res, next) {
  try {
    const { id } = req.params
    const { isPackaged } = req.body
    const [result] = await pool.query(
      'UPDATE orders SET is_packaged = ?, packed_at = ? WHERE id = ?',
      [!!isPackaged, isPackaged ? new Date() : null, id]
    )
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Order not found' })

    const [rows] = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [id]
    )
    const [order] = await attachItems(rows)
    res.json(order)
  } catch (err) {
    next(err)
  }
}

export async function cancelOrder(req, res, next) {
  try {
    const { id } = req.params
    const [result] = await pool.query("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [id])
    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Solo se puede cancelar una venta pendiente' })
    }
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

/** Cancelling a CONFIRMED sale reverses real stock/revenue, unlike cancelling
 * a pending one — gated behind the admin re-typing their own password so it
 * can't happen from an idle, unlocked screen. */
export async function cancelConfirmedOrder(req, res, next) {
  try {
    const { id } = req.params
    const { password } = req.body
    if (!password) return res.status(400).json({ error: 'La contraseña es requerida' })

    const [adminRows] = await pool.query('SELECT password_hash FROM admins WHERE id = ?', [req.admin.sub])
    const admin = adminRows[0]
    const passwordMatches = admin && (await bcrypt.compare(password, admin.password_hash))
    // 403, not 401 — the admin's session token is fine (that's what 401 means
    // to the admin client, which logs out on it); this is just a failed
    // re-auth check for one destructive action.
    if (!passwordMatches) return res.status(403).json({ error: 'Contraseña incorrecta' })

    const [orderRows] = await pool.query('SELECT * FROM orders WHERE id = ?', [id])
    if (orderRows.length === 0) return res.status(404).json({ error: 'Order not found' })
    if (orderRows[0].status !== 'confirmed') {
      return res.status(400).json({ error: 'Solo se puede cancelar así una venta confirmada' })
    }

    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ?', [id])
    for (const item of items.filter((i) => i.variant_id != null)) {
      const [variantRows] = await pool.query('SELECT stock FROM product_variants WHERE id = ?', [item.variant_id])
      if (variantRows.length === 0) continue
      const nextStock = variantRows[0].stock + item.quantity
      await pool.query('UPDATE product_variants SET stock = ? WHERE id = ?', [nextStock, item.variant_id])
      await pool.query(
        'INSERT INTO stock_movements (variant_id, delta, resulting_stock, admin_email, order_id) VALUES (?, ?, ?, ?, ?)',
        [item.variant_id, item.quantity, nextStock, req.admin?.email ?? null, id]
      )
    }

    await pool.query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [id])

    const [rows] = await pool.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
       FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
      [id]
    )
    const [order] = await attachItems(rows)
    res.json(order)
  } catch (err) {
    next(err)
  }
}
