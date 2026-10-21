import { pool } from '../config/db.js'
import { createNotification } from '../controllers/notifications.controller.js'

const CHECK_INTERVAL_MS = 60_000

// variant_id -> 'low' | 'out' — tracked in memory only. A server restart
// just resets this, so the worst case is one possible re-notification for a
// variant that was already in a bad state before the restart — acceptable
// to avoid needing a persisted "last alerted level" column.
const lastLevelByVariant = new Map()

// The very first tick after boot only records the CURRENT state instead of
// notifying — otherwise every already-known low-stock product would fire a
// notification on every server restart, which (especially during
// development, where the server restarts on every file save) would be
// constant noise instead of a genuine "this just changed" alert.
let initialized = false

function levelFor(stock, threshold) {
  if (stock <= 0) return 'out'
  if (stock <= threshold) return 'low'
  return 'ok'
}

async function checkStockLevels() {
  try {
    const [[settings]] = await pool.query('SELECT low_stock_threshold FROM app_settings WHERE id = 1')
    const threshold = settings?.low_stock_threshold ?? 5

    const [variants] = await pool.query(
      `SELECT v.id, v.stock, v.size, v.color_name, p.id AS product_id, p.name AS product_name
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE p.is_active = 1`
    )

    const seenIds = new Set()
    for (const v of variants) {
      seenIds.add(v.id)
      const level = levelFor(v.stock, threshold)

      if (!initialized) {
        if (level !== 'ok') lastLevelByVariant.set(v.id, level)
        continue
      }

      const previous = lastLevelByVariant.get(v.id)
      if (level === previous) continue

      if (level === 'ok') {
        lastLevelByVariant.delete(v.id)
        continue
      }

      lastLevelByVariant.set(v.id, level)
      const variantLabel = `${v.size} · ${v.color_name}`
      if (level === 'out') {
        await createNotification({
          type: 'out_of_stock',
          title: `${v.product_name} agotado`,
          body: `${variantLabel} se quedó sin stock.`,
          productId: v.product_id,
        })
      } else {
        await createNotification({
          type: 'low_stock',
          title: `${v.product_name} con bajo stock`,
          body: `${variantLabel}: quedan ${v.stock} unidades.`,
          productId: v.product_id,
        })
      }
    }

    for (const id of lastLevelByVariant.keys()) {
      if (!seenIds.has(id)) lastLevelByVariant.delete(id)
    }
    initialized = true
  } catch (err) {
    console.error('[notificationScheduler] Error checking stock levels:', err)
  }
}

/** Started once at server boot, alongside the cash-cut scheduler. */
export function startNotificationScheduler() {
  checkStockLevels()
  setInterval(checkStockLevels, CHECK_INTERVAL_MS)
}
