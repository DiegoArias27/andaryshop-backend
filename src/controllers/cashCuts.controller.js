import { pool } from '../config/db.js'

/** Every confirmed sale in the window — WhatsApp and mostrador alike —
 * broken down by source too, so a cut still shows how much of it came from
 * each channel even though both count toward the same total. */
async function summarizeConfirmedSales(periodFrom, periodTo) {
  const [orderStats] = await pool.query(
    `SELECT source, COUNT(*) AS sales_count
     FROM orders
     WHERE status = 'confirmed' AND confirmed_at > ? AND confirmed_at <= ?
     GROUP BY source`,
    [periodFrom, periodTo]
  )

  const [itemStats] = await pool.query(
    `SELECT o.source,
       COALESCE(SUM(CASE WHEN oi.is_gift THEN 0 ELSE oi.quantity END), 0) AS items_sold,
       COALESCE(SUM(CASE WHEN oi.is_gift THEN 0 ELSE GREATEST(oi.unit_price - oi.discount_amount, 0) * oi.quantity END), 0) AS gross
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'confirmed' AND o.confirmed_at > ? AND o.confirmed_at <= ?
     GROUP BY o.source`,
    [periodFrom, periodTo]
  )

  const [discountStats] = await pool.query(
    `SELECT source, COALESCE(SUM(discount_amount), 0) AS total_discount
     FROM orders
     WHERE status = 'confirmed' AND confirmed_at > ? AND confirmed_at <= ?
     GROUP BY source`,
    [periodFrom, periodTo]
  )

  const bySource = {}
  for (const source of ['whatsapp', 'pos']) {
    const sales = orderStats.find((r) => r.source === source)?.sales_count ?? 0
    const items = itemStats.find((r) => r.source === source)
    const gross = Number(items?.gross ?? 0)
    const discount = Number(discountStats.find((r) => r.source === source)?.total_discount ?? 0)
    bySource[source] = {
      salesCount: sales,
      itemsSold: Number(items?.items_sold ?? 0),
      totalAmount: Math.max(0, gross - discount),
    }
  }

  return {
    salesCount: bySource.whatsapp.salesCount + bySource.pos.salesCount,
    itemsSold: bySource.whatsapp.itemsSold + bySource.pos.itemsSold,
    totalAmount: bySource.whatsapp.totalAmount + bySource.pos.totalAmount,
    bySource,
  }
}

async function getLastCutPeriodTo() {
  const [rows] = await pool.query('SELECT period_to FROM cash_cuts ORDER BY id DESC LIMIT 1')
  // A plain pre-launch constant, not epoch zero — new Date(0) shifted to
  // local time can underflow MySQL's TIMESTAMP range (starts 1970-01-01
  // 00:00:01 UTC) and get rejected outright.
  return rows[0]?.period_to ?? '2000-01-01 00:00:00'
}

/** by_source comes back from mysql2 already parsed for a JSON column on
 * recent driver versions, but as a raw string on older ones — handle both. */
function parseBySource(row) {
  if (!row.by_source) return row
  const bySource = typeof row.by_source === 'string' ? JSON.parse(row.by_source) : row.by_source
  return { ...row, by_source: bySource }
}

export async function listCashCuts(req, res, next) {
  try {
    const { from, to } = req.query
    const where = []
    const params = []
    if (from) { where.push('created_at >= ?'); params.push(`${from} 00:00:00`) }
    if (to) { where.push('created_at <= ?'); params.push(`${to} 23:59:59`) }

    const [cutRows] = await pool.query(
      `SELECT * FROM cash_cuts ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`,
      params
    )
    const cuts = cutRows.map(parseBySource)

    const periodFrom = await getLastCutPeriodTo()
    const periodTo = new Date()
    const pending = await summarizeConfirmedSales(periodFrom, periodTo)

    res.json({ cuts, pending: { ...pending, since: periodFrom } })
  } catch (err) {
    next(err)
  }
}

/** The actual "make a cut" logic, shared by the manual endpoint below and
 * the unattended scheduler (backend/src/jobs/cashCutScheduler.js) — a cut
 * here is purely computed from confirmed sales, so nothing about it
 * requires a human in the loop. `adminEmail` is just an attribution label
 * ("admin@shop.com" for a manual one, "Automático" for a scheduled one). */
export async function runCashCut(adminEmail) {
  const periodFrom = await getLastCutPeriodTo()
  const periodTo = new Date()
  const summary = await summarizeConfirmedSales(periodFrom, periodTo)

  const [result] = await pool.query(
    `INSERT INTO cash_cuts (period_from, period_to, sales_count, items_sold, total_amount, by_source, admin_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [periodFrom, periodTo, summary.salesCount, summary.itemsSold, summary.totalAmount, JSON.stringify(summary.bySource), adminEmail]
  )

  const [rows] = await pool.query('SELECT * FROM cash_cuts WHERE id = ?', [result.insertId])
  return parseBySource(rows[0])
}

export async function createCashCut(req, res, next) {
  try {
    const cut = await runCashCut(req.admin?.email ?? null)
    res.status(201).json(cut)
  } catch (err) {
    next(err)
  }
}

const VALID_FREQUENCIES = ['daily', 'weekly']

export async function getCashCutSettings(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM cash_cut_settings WHERE id = 1')
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function updateCashCutSettings(req, res, next) {
  try {
    const { enabled, frequency, hour, weekday } = req.body

    if (frequency !== undefined && !VALID_FREQUENCIES.includes(frequency)) {
      return res.status(400).json({ error: 'frequency inválida' })
    }
    if (hour !== undefined && (!Number.isInteger(hour) || hour < 0 || hour > 23)) {
      return res.status(400).json({ error: 'hour debe ser un entero entre 0 y 23' })
    }
    if (weekday !== undefined && weekday !== null && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
      return res.status(400).json({ error: 'weekday debe ser un entero entre 0 y 6' })
    }

    const fields = []
    const params = []
    if (enabled !== undefined) { fields.push('enabled = ?'); params.push(!!enabled) }
    if (frequency !== undefined) { fields.push('frequency = ?'); params.push(frequency) }
    if (hour !== undefined) { fields.push('hour = ?'); params.push(hour) }
    if (weekday !== undefined) { fields.push('weekday = ?'); params.push(weekday) }

    if (fields.length > 0) {
      await pool.query(`UPDATE cash_cut_settings SET ${fields.join(', ')} WHERE id = 1`, params)
    }

    const [rows] = await pool.query('SELECT * FROM cash_cut_settings WHERE id = 1')
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}
