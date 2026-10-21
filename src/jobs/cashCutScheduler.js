import { pool } from '../config/db.js'
import { runCashCut } from '../controllers/cashCuts.controller.js'
import { createNotification } from '../controllers/notifications.controller.js'

const CHECK_INTERVAL_MS = 60_000

/** The most recent daily hour:00 slot at or before `now`. */
function mostRecentDailySlot(hour, now) {
  const slot = new Date(now)
  slot.setHours(hour, 0, 0, 0)
  if (slot > now) slot.setDate(slot.getDate() - 1)
  return slot
}

/** The most recent weekly weekday+hour:00 slot at or before `now`. Matches
 * JS's Date#getDay() convention (0 = Sunday .. 6 = Saturday). */
function mostRecentWeeklySlot(hour, weekday, now) {
  const slot = new Date(now)
  slot.setHours(hour, 0, 0, 0)
  const diff = (slot.getDay() - weekday + 7) % 7
  slot.setDate(slot.getDate() - diff)
  if (slot > now) slot.setDate(slot.getDate() - 7)
  return slot
}

/** Computed independent of how often this checker actually ticks — so a
 * missed tick (server restart, a slow query) still fires exactly once on
 * the next check after the slot, instead of needing to land on the exact
 * minute. Firing is gated by comparing against the last cut's own
 * timestamp, not by tracking "did we already fire this tick" in memory. */
async function checkAndRun() {
  try {
    const [settingsRows] = await pool.query('SELECT * FROM cash_cut_settings WHERE id = 1')
    const settings = settingsRows[0]
    if (!settings || !settings.enabled) return

    const now = new Date()
    const slot =
      settings.frequency === 'weekly'
        ? mostRecentWeeklySlot(settings.hour, settings.weekday ?? 0, now)
        : mostRecentDailySlot(settings.hour, now)

    const [lastCutRows] = await pool.query('SELECT created_at FROM cash_cuts ORDER BY id DESC LIMIT 1')
    const lastCutAt = lastCutRows[0]?.created_at ?? null
    if (lastCutAt && new Date(lastCutAt) >= slot) return

    const cut = await runCashCut('Automático')
    const total = Number(cut.total_amount).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
    await createNotification({
      type: 'cash_cut',
      title: 'Corte de caja automático',
      body: `Se generó el corte #${cut.id} por ${total} (${cut.sales_count} ventas).`,
    }).catch((err) => console.error('[cashCutScheduler] notification failed', err))
    console.log(`[cashCutScheduler] Corte automático generado (slot: ${slot.toISOString()})`)
  } catch (err) {
    console.error('[cashCutScheduler] Error checking/running scheduled cut:', err)
  }
}

/** Started once at server boot — a single in-process interval is plenty for
 * this app's scale, no external cron/queue needed. */
export function startCashCutScheduler() {
  checkAndRun()
  setInterval(checkAndRun, CHECK_INTERVAL_MS)
}
